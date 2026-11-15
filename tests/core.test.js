import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaussLegendre, integrate, cauchyIntegrals, solveScaled, bisect } from '../src/core/numeric.js';
import { compile } from '../src/core/expr.js';
import { toSI, fromSI, convert, unitTable, fmt, STRESS, UNIT_PRESETS } from '../src/core/units.js';
import { sectionProps, peakStress } from '../src/core/sections.js';
import { EXAMPLES, toSolverInput, convertModel, stressSummary, emptyModel } from '../src/beam/model.js';
import { solveBeam } from '../src/beam/solver.js';

const close = (a, b, rel = 1e-10) => assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(b), 1e-300), `expected ${b}, got ${a}`);

test('numeric: quadrature, repeated integrals, solver, root finder', () => {
  const g = gaussLegendre(5);
  close(g.w.reduce((s, v) => s + v, 0), 2);
  close(integrate((x) => x ** 7 - 3 * x * x, 0, 2), 2 ** 8 / 8 - 8);
  close(integrate(Math.sin, 0, Math.PI), 2);
  const I = cauchyIntegrals(() => 1, 5, 2);
  [2, 2, 8 / 6, 16 / 24].forEach((v, k) => close(I[k], v));
  const I2 = cauchyIntegrals((x) => x, 0, 3);              // w = t
  [9 / 2, 27 / 6, 81 / 24, 243 / 120].forEach((v, k) => close(I2[k], v));
  const s = solveScaled([[4, 1], [1, 3]], [1, 2]);
  close(s.x[0], 1 / 11); close(s.x[1], 7 / 11);
  assert.equal(solveScaled([[1, 1], [1, 1]], [1, 1]).singular, true);
  close(bisect((x) => x * x - 2, 0, 2), Math.SQRT2, 1e-12);
});

test('formula parser', () => {
  const ev = (s, x = 2, L = 4) => compile(s)({ x, L });
  close(ev('-5*sin(pi*x/L)'), -5);
  close(ev('2x^2 + 3(x - 1)'), 11);
  close(ev('-x^2'), -4);
  close(ev('2^-1'), 0.5);
  close(ev('2**3'), 8);
  close(ev('max(x, L) - min(x, L)'), 2);
  close(ev('1.5e3*step(x - 1)'), 1500);
  close(ev('sqrt(abs(-16)) + ln(e)'), 5);
  assert.throws(() => compile('2 +'), /too early/);
  assert.throws(() => compile('foo(x)'), /Unknown name/);
  assert.throws(() => compile('x $ 2'), /Unexpected character/);
  assert.throws(() => compile('log(x)'), /ln\(x\)/);
  assert.throws(() => compile('(x'), /Missing/);
  assert.throws(() => compile(''), /empty/);
  assert.throws(() => compile('constructor'), /Unknown name/);
});

test('units: factors and round trips', () => {
  const us = UNIT_PRESETS['kip, ft'], si = UNIT_PRESETS['kN, m'];
  close(STRESS.psi, 6894.757293168361, 1e-12);
  close(toSI(1, 'moment', us), 4448.2216152605 * 0.3048);
  close(toSI(1, 'distForce', us), 4448.2216152605 / 0.3048);
  close(toSI(1, 'inertia', us), 0.0254 ** 4);
  close(toSI(29000, 'modulus', us), 29000 * 6894757.293168361);
  close(fromSI(toSI(3.7, 'kTrans', us), 'kTrans', us), 3.7);
  close(convert(1, 'length', us, si), 0.3048);
  close(convert(200, 'modulus', si, UNIT_PRESETS['lbf, in']), 200e9 / 6894757.293168361, 1e-9);
  assert.equal(unitTable(si).moment.label, 'kN·m');
  assert.equal(unitTable(si).inertia.label, 'mm⁴');
  assert.equal(fmt(0), '0');
  assert.equal(fmt(-12.3456789), '−12.346');
  assert.equal(fmt(1.5e-7), '150e−9');
  assert.equal(fmt(79990000), '79.99e6');
  assert.equal(fmt(157020), '157020');
  assert.equal(fmt(null), '—');
});

test('sections: formulas against independent sums', () => {
  let p = sectionProps('rect', { b: 0.1, h: 0.2 });
  close(p.Iz, 0.1 * 0.2 ** 3 / 12); close(p.Iy, 0.2 * 0.1 ** 3 / 12);
  close(p.J, 0.2287 * 0.2 * 0.1 ** 3, 5e-4);              // tabulated beta = 0.229 for 2:1
  close(sectionProps('rect', { b: 0.1, h: 0.1 }).J, 0.1406 * 0.1 ** 4, 2e-4);   // square, tabulated 0.1406
  p = sectionProps('circle', { d: 0.04 });
  close(p.J, Math.PI * 0.04 ** 4 / 32); close(p.Iz, p.J / 2);
  p = sectionProps('tube', { do: 0.06, di: 0.05 });
  close(p.A, Math.PI * (0.06 ** 2 - 0.05 ** 2) / 4);
  // I-beam as three rectangles with the parallel-axis theorem
  const d = { h: 0.3, bf: 0.15, tf: 0.012, tw: 0.008 };
  p = sectionProps('ibeam', d);
  const hw = d.h - 2 * d.tf, yf = (d.h - d.tf) / 2;
  close(p.Iz, 2 * (d.bf * d.tf ** 3 / 12 + d.bf * d.tf * yf * yf) + d.tw * hw ** 3 / 12);
  close(p.Iy, 2 * d.tf * d.bf ** 3 / 12 + hw * d.tw ** 3 / 12);
  p = sectionProps('box', { b: 0.1, h: 0.15, t: 0.006 });
  close(p.A, 0.1 * 0.15 - 0.088 * 0.138);
  assert.ok(sectionProps('tube', { do: 0.05, di: 0.06 }).error);
  assert.ok(sectionProps('rect', { b: 0, h: 1 }).error);
});

test('stresses: bending, transverse shear, torsion', () => {
  const dims = { b: 0.1, h: 0.2 }, p = sectionProps('rect', dims);
  let s = peakStress('rect', dims, p, { Mz: 16e3, Vy: 8e3 });
  close(s.sigma, 6 * 16e3 / (0.1 * 0.2 ** 2)); close(s.tauVy, 1.5 * 8e3 / 0.02);
  s = peakStress('rect', dims, p, { Mz: 16e3, My: 4e3, N: 10e3 });
  close(s.sigma, 6 * 16e3 / (0.1 * 0.04) + 6 * 4e3 / (0.2 * 0.01) + 10e3 / 0.02);
  const dc = { d: 0.04 }, pc = sectionProps('circle', dc);
  s = peakStress('circle', dc, pc, { Mz: 300, My: 400, T: 200, Vy: 1e3 });
  close(s.sigma, 32 * 500 / (Math.PI * 0.04 ** 3)); close(s.tauT, 16 * 200 / (Math.PI * 0.04 ** 3));
  close(s.tauVy, 4 * 1e3 / (3 * pc.A));
});

test('model: every worked example solves and closes', () => {
  for (const ex of EXAMPLES) {
    const { input, section, errors } = toSolverInput(ex);
    assert.deepEqual(errors, [], ex.title);
    const r = solveBeam(input);
    assert.ok(r.ok, `${ex.title}: ${r.errors}`);
    assert.ok(stressSummary(r, section).sigma.value > 0, ex.title);
  }
});

test('model: the answer does not depend on the units used to enter it', () => {
  for (const ex of EXAMPLES) {
    const ref = solveBeam(toSolverInput(ex).input);
    for (const name of ['N, mm', 'lbf, in', 'kip, ft']) {
      const conv = convertModel(ex, UNIT_PRESETS[name]);
      if (conv.distLoads.some((q) => q.profile === 'formula')) continue;   // formula text is not converted
      const { input, errors } = toSolverInput(conv);
      assert.deepEqual(errors, []);
      const r = solveBeam(input);
      for (const k of ['Mz', 'Vy', 'v', 'Mtotal', 'T']) {
        if (!ref.extremes[k]) continue;
        const a = r.extremes[k].atAbs, b = ref.extremes[k].atAbs;
        assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(Math.abs(b), 1e-9), `${ex.title} in ${name}: ${k} ${a} vs ${b}`);
      }
    }
  }
});

test('model: US customary textbook case', () => {
  // W-shape style check in kip, ft: simply supported, 20 ft, 2 kip/ft, E = 29000 ksi, I = 800 in^4
  const m = { ...emptyModel(UNIT_PRESETS['kip, ft']), length: 20,
    section: { shape: 'custom', dims: {}, custom: { Iz: 800 } }, material: { id: 'custom', E: 29000, G: '' },
    supports: [{ type: 'pin', x: 0 }, { type: 'roller', x: 20 }],
    distLoads: [{ x1: 0, x2: 20, dir: 'y', profile: 'uniform', w1: -2, w2: '', expr: '' }] };
  const { input, errors } = toSolverInput(m);
  assert.deepEqual(errors, []);
  const r = solveBeam(input);
  close(fromSI(r.extremes.Mz.max, 'moment', m.units), 100, 1e-9);                 // wL^2/8 = 100 kip-ft
  const dIn = 5 * (2 / 12) * 240 ** 4 / (384 * 29000 * 800);                      // inches
  close(fromSI(-r.extremes.v.min, 'deflection', m.units), dIn, 1e-9);
});

test('model: helpful input errors and blank rows', () => {
  const m = emptyModel();
  assert.match(toSolverInput(m).errors[0], /length/);
  m.length = 5;
  m.pointLoads = [{ x: '', Fx: '', Fy: '', Fz: '' }, { x: '', Fx: '', Fy: -3, Fz: '' }];
  m.distLoads = [{ x1: 0, x2: 5, dir: 'y', profile: 'formula', expr: '2*(' }];
  m.supports = [{ type: 'spring', x: 0, ky: '', kz: '' }];
  const { errors, input } = toSolverInput(m);
  assert.equal(input.pointLoads.length, 1);
  assert.ok(errors.some((e) => /Point load 2: enter a position/.test(e)));
  assert.ok(errors.some((e) => /Distributed load 1/.test(e)));
  assert.ok(errors.some((e) => /spring stiffness/.test(e)));
});
