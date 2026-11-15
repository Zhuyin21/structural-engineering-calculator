// Bar and column calculators, the materials library, and beam stresses,
// checked against Shigley's Mechanical Engineering Design, 11th ed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveBarModel } from '../src/bar/solver.js';
import { criticalLoad, transitionSlenderness, secantStress, secantLoad, solveColumn, END_CONDITIONS, unitLoadCurve } from '../src/column/solver.js';
import { MATERIALS } from '../src/core/materials.js';
import { materialPreset, materialSI, sectionSI, convertMaterial } from '../src/core/inputs.js';
import { UNIT_PRESETS } from '../src/core/units.js';
import { EXAMPLES, toSolverInput, stressSeries, convertModel, emptyModel } from '../src/beam/model.js';
import { solveBeam } from '../src/beam/solver.js';

const close = (a, b, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(b), 1e-300), `expected ${b}, got ${a}`);
const circ = (d) => ({ A: Math.PI * d * d / 4, I: Math.PI * d ** 4 / 64 });

test('bar: stepped, one end fixed (N L / A E per segment)', () => {
  const E = 207e9, r = solveBarModel({ segments: [{ L: 0.5, A: 4e-4, E }, { L: 0.3, A: 2e-4, E }], fixedLeft: true, fixedRight: false,
    pointLoads: [{ x: 0.5, Fx: 10e3 }, { x: 0.8, Fx: 20e3 }] });
  assert.ok(r.ok);
  close(r.reactions.left, -30e3);
  close(r.segments[0].N1, 30e3); close(r.segments[1].N1, 20e3);
  close(r.segments[0].sigma, 75e6); close(r.segments[1].sigma, 100e6);
  close(r.segments[1].strain, 100e6 / E);
  close(r.segments[0].elongation, 30e3 * 0.5 / (E * 4e-4));
  close(r.elongation, 30e3 * 0.5 / (E * 4e-4) + 20e3 * 0.3 / (E * 2e-4));
  close(r.at(0.5, 'left').sigma, 75e6); close(r.at(0.5, 'right').sigma, 100e6);   // stress jumps at the step
  assert.ok(Math.abs(r.checks.N) < 1e-6);
});

test('bar: held at both ends, two materials (load shared by stiffness)', () => {
  const k1 = 207e9 * 4e-4 / 0.5, k2 = 70e9 * 2e-4 / 0.3, P = 10e3;
  const r = solveBarModel({ segments: [{ L: 0.5, A: 4e-4, E: 207e9 }, { L: 0.3, A: 2e-4, E: 70e9 }], fixedLeft: true, fixedRight: true, pointLoads: [{ x: 0.5, Fx: P }] });
  close(r.reactions.left, -P * k1 / (k1 + k2)); close(r.reactions.right, -P * k2 / (k1 + k2));
  close(r.segments[0].N1, P * k1 / (k1 + k2));             // left part in tension
  close(r.segments[1].N1, -P * k2 / (k1 + k2));            // right part in compression
  assert.ok(Math.abs(r.elongation) < 1e-15);
  close(r.at(0.5).u, P / (k1 + k2));
});

test('bar: distributed load, compression, and input checks', () => {
  const E = 200e9, A = 1e-4, L = 2, w = 1500;
  let r = solveBarModel({ segments: [{ L, A, E }], fixedLeft: true, fixedRight: false, distLoads: [{ x1: 0, x2: L, w1: w, w2: w }] });
  close(r.at(0).N, w * L); close(r.at(1).N, w * 1); close(r.at(L).u, w * L * L / (2 * E * A));
  r = solveBarModel({ segments: [{ L, A, E }], fixedLeft: false, fixedRight: true, pointLoads: [{ x: 0, Fx: 5e3 }] });
  close(r.segments[0].sigma, -5e3 / A);                    // pushed against the right wall: compression
  close(r.reactions.right, -5e3);
  assert.equal(solveBarModel({ segments: [{ L, A, E }], fixedLeft: false, fixedRight: false }).ok, false);
  assert.match(solveBarModel({ segments: [{ L, A: null, E }], fixedLeft: true }).errors[0], /Segment 1/);
  assert.match(solveBarModel({ segments: [{ L, A, E: null }], fixedLeft: true, fixedRight: true }).errors[0], /both ends/);
  r = solveBarModel({ segments: [{ L, A, E: null }], fixedLeft: true, fixedRight: false, pointLoads: [{ x: L, Fx: 1e3 }] });
  assert.ok(r.ok); close(r.segments[0].sigma, 1e7); assert.equal(r.u, null);
});

test('column: Shigley Example 4-16 (Euler, round, pinned ends)', () => {
  // l = 1.5 m, Pcr = 88 kN, C = 1, E = 207 GPa, Sy = 500 MPa -> d = 37.5 mm; with d = 40 mm, l/k = 150; (l/k)1 = 90.4
  const E = 207e9, Sy = 500e6;
  const d = (64 * 88e3 * 1.5 ** 2 / (Math.PI ** 3 * 1 * E)) ** 0.25;          // Eq. (4-46)
  close(d, 0.0375, 2e-3);
  const r = criticalLoad({ E, Sy, ...circ(d), L: 1.5, C: 1 });
  assert.equal(r.regime, 'euler'); close(r.Pcr, 88e3, 1e-9);
  close(transitionSlenderness(1, E, Sy), 90.4, 1e-3);
  close(criticalLoad({ E, Sy, ...circ(0.04), L: 1.5, C: 1 }).slenderness, 150);
});

test('column: Shigley Example 4-18 (Johnson, l = 375 mm)', () => {
  const E = 207e9, Sy = 500e6, l = 0.375, Pcr = 88e3;
  const d = 2 * Math.sqrt(Pcr / (Math.PI * Sy) + Sy * l * l / (Math.PI ** 2 * 1 * E));   // Eq. (4-49)
  close(d, 0.0190, 2e-3);
  const r = criticalLoad({ E, Sy, ...circ(d), L: l, C: 1 });
  assert.equal(r.regime, 'johnson'); close(r.Pcr, Pcr, 1e-9);
  close(criticalLoad({ E, Sy, ...circ(0.02), L: l, C: 1 }).slenderness, 75);
});

test('column: Shigley Examples 4-17 and 4-19, and Table 4-2', () => {
  close(transitionSlenderness(1.2, 207e9, 500e6), 90.4 * Math.sqrt(1.2), 1e-3);          // Ex. 4-17 uses C = 1.2
  const h = (12 * 88e3 * 1.5 ** 2 / (Math.PI ** 2 * 1.2 * 207e9 * 4)) ** 0.25;           // Eq. (4-47), b = 4h
  close(h, 0.0222, 2e-3);
  close(transitionSlenderness(1, 30e6, 75e3), 88.9, 1e-3);                               // Ex. 4-19, in psi
  assert.deepEqual([END_CONDITIONS['fixed-free'].recommended, END_CONDITIONS['rounded-rounded'].recommended,
    END_CONDITIONS['fixed-rounded'].recommended, END_CONDITIONS['fixed-fixed'].recommended], [0.25, 1, 1.2, 1.2]);
  assert.deepEqual([END_CONDITIONS['fixed-rounded'].theoretical, END_CONDITIONS['fixed-fixed'].theoretical, END_CONDITIONS['fixed-fixed'].conservative], [2, 4, 1]);
});

test('column: the two formulas meet at Sy/2, and the secant formula behaves', () => {
  const E = 207e9, Sy = 500e6, tr = transitionSlenderness(1, E, Sy);
  close(unitLoadCurve(E, Sy, tr), Sy / 2, 1e-9);
  close(unitLoadCurve(E, Sy, tr * (1 - 1e-7)), unitLoadCurve(E, Sy, tr * (1 + 1e-7)), 1e-6);
  const d = 0.04, base = { E, Sy, ...circ(d), c: d / 2, L: 1.5, C: 1 };
  const euler = Math.PI ** 2 * E * base.I / 1.5 ** 2;
  close(secantLoad({ ...base, e: 1e-12 }), euler, 1e-6);          // no eccentricity: yield load -> Euler load for this slender column
  const Py = secantLoad({ ...base, e: 0.005 });
  assert.ok(Py < euler && Py > 0);
  close(secantStress({ ...base, e: 0.005, P: Py }), Sy, 1e-9);
  // direct evaluation of Eq. (4-53)
  const k2 = base.I / base.A, P = 40e3;
  close(secantStress({ ...base, e: 0.005, P }), (P / base.A) * (1 + (0.005 * 0.02 / k2) / Math.cos((1.5 / (2 * Math.sqrt(k2))) * Math.sqrt(P / (base.A * E)))));
  assert.equal(secantStress({ ...base, e: 0.005, P: euler * 1.01 }), Infinity);
});

test('column: weak axis governs, per-plane end conditions, safety factor', () => {
  const b = 0.012, h = 0.030, A = b * h, Iz = b * h ** 3 / 12, Iy = h * b ** 3 / 12;
  let r = solveColumn({ L: 0.8, E: 207e9, Sy: 210e6, A, Iz, Iy, cy: h / 2, cz: b / 2, Cxy: 1, Cxz: 1, P: 8e3 });
  assert.equal(r.governing.id, 'xz');                       // bends about y, the thin direction
  close(r.safety, r.governing.Pcr / 8e3);
  r = solveColumn({ L: 0.8, E: 207e9, Sy: 210e6, A, Iz, Iy, cy: h / 2, cz: b / 2, Cxy: 0.25, Cxz: 4 });
  assert.equal(r.governing.id, 'xy');                       // a free end in XY now governs
  assert.match(solveColumn({ L: 1, E: 207e9, A, Iz, Iy, Cxy: 1, Cxz: 1 }).warnings[0], /yield strength/);
  assert.equal(solveColumn({ L: 0, E: 207e9, A, Iz, Iy, Cxy: 1, Cxz: 1 }).ok, false);
});

test('materials: values from Shigley Tables A-5 and A-20', () => {
  const m = (id) => MATERIALS.find((x) => x.id === id);
  assert.deepEqual([m('aisi-1020-hr').Sut, m('aisi-1020-hr').Sy], [380e6, 210e6]);
  assert.deepEqual([m('aisi-1020-cd').Sut, m('aisi-1020-cd').Sy], [470e6, 390e6]);
  assert.deepEqual([m('aisi-1006-hr').Sut, m('aisi-1006-hr').Sy], [300e6, 170e6]);
  assert.deepEqual([m('aisi-1050-cd').Sut, m('aisi-1050-cd').Sy], [690e6, 580e6]);
  assert.deepEqual([m('aisi-1045-hr').E, m('aisi-1045-hr').G, m('aisi-1045-hr').nu], [207e9, 79.3e9, 0.292]);
  assert.deepEqual([m('aluminum').E, m('aluminum').G, m('aluminum').nu], [71.7e9, 26.9e9, 0.333]);
  assert.equal(MATERIALS.filter((x) => x.id.startsWith('aisi-')).length, 20);
  assert.equal(new Set(MATERIALS.map((x) => x.id)).size, MATERIALS.length);
  // presets land in the student's units and convert back
  const us = UNIT_PRESETS['kip, ft'], si = UNIT_PRESETS['kN, m'];
  const p = materialPreset('aisi-1018-cd', us);
  close(p.Sy, 53.664, 1e-4);                                // 370 MPa in ksi (the book rounds to 54)
  close(materialSI(us, p).Sy, 370e6, 1e-4);
  close(convertMaterial(materialPreset('aisi-1018-cd', si), si, us).Sut, 440e6 / 6894757.293, 1e-6);
  assert.equal(sectionSI(si, { shape: 'none' }).none, true);
});

test('beam stresses: extreme fibre, neutral axis, von Mises (Shigley Secs. 3-10, 3-11, 5-5)', () => {
  const s = toSolverInput(EXAMPLES[0]);                      // 100 x 200 mm rectangle, 12 kN at 2 m on a 6 m span
  const r = solveBeam(s.input), st = stressSeries(r, s.section);
  close(st.peak.sigma.value, 16e3 * 0.1 / (0.1 * 0.2 ** 3 / 12));        // Mc/I = 24 MPa
  close(st.peak.tauVy.value, 1.5 * 8e3 / 0.02);                          // 3V/2A = 0.6 MPa
  close(st.peak.vonMises.value, 24e6, 1e-9);
  close(st.peak.vonMises.x, 2);
  const i0 = 1;                                                           // near the left support: no moment, shear only
  close(st.vonMises[0], Math.sqrt(3) * 0.6e6, 1e-9);                      // sqrt(3) tau
  assert.ok(st.sigmaMax[i0] >= 0 && st.sigmaMin[i0] <= 0);
  // both planes plus axial on a round bar: resultant moment and resultant shear
  const m = { ...emptyModel(UNIT_PRESETS['kN, m']), length: 1, section: { shape: 'circle', dims: { d: 40 }, custom: {} },
    supports: [{ type: 'pin', x: 0 }, { type: 'roller', x: 1 }], pointLoads: [{ x: 0.5, Fx: '', Fy: -3, Fz: 4 }, { x: 1, Fx: 10, Fy: '', Fz: '' }] };
  const q = toSolverInput(m), rq = solveBeam(q.input), sq = stressSeries(rq, q.section);
  const A = Math.PI * 0.04 ** 2 / 4, Z = Math.PI * 0.04 ** 3 / 32;
  close(sq.peak.sigma.value, 10e3 / A + 1250 / Z);                        // N/A + M_total c / I
  close(sq.sigmaMin[sq.x.findIndex((x) => x === 0.5)], 10e3 / A - 1250 / Z);
  close(sq.peak.tau.value, (4 / 3) * 2.5e3 / A);                          // resultant shear 2.5 kN
  assert.equal(stressSeries(rq, { shape: 'none', none: true }), null);
});

test('formula loads are read in the units they were written in', () => {
  const ex = EXAMPLES.find((e) => e.distLoads.some((q) => q.profile === 'formula'));
  const ref = solveBeam(toSolverInput(ex).input);
  for (const name of ['N, mm', 'lbf, in', 'kip, ft']) {
    const conv = convertModel(ex, UNIT_PRESETS[name]);
    assert.deepEqual(conv.distLoads[0].exprUnits, { force: 'kN', length: 'm' });
    assert.equal(conv.distLoads[0].expr, ex.distLoads[0].expr);
    const r = solveBeam(toSolverInput(conv).input);
    close(r.extremes.Mz.max, ref.extremes.Mz.max, 1e-9);
    close(r.extremes.v.min, ref.extremes.v.min, 1e-9);
  }
  // once the student opts into the current units, the same text means a different load
  const conv = convertModel(ex, UNIT_PRESETS['lbf, in']);
  conv.distLoads[0].exprUnits = { force: 'lbf', length: 'in' };
  const r = solveBeam(toSolverInput(conv).input);
  assert.ok(Math.abs(r.extremes.Mz.max - ref.extremes.Mz.max) > 0.5 * ref.extremes.Mz.max);
});

// ---------------------------------------------------------------------------
// Stress concentration: Shigley Table A-15
// ---------------------------------------------------------------------------
import { readChart, solveKt, chartCurve, GEOMETRIES } from '../src/kt/solver.js';
import { CHARTS } from '../src/kt/chartdata.js';

test('Kt charts: every value the book itself reads from Table A-15', () => {
  // [figure, x, size ratio, the book's reading, where]. The book reads these by eye to two or three figures.
  const book = [
    ['A-15-1', 0.1, null, 2.7, 'Example 3-13'], ['A-15-1', 0.25, null, 2.45, 'Example 6-10'],
    ['A-15-5', 0.026, 1.18, 2.5, 'Example 3-13'],
    ['A-15-9', 0.09375, 1.1875, 1.65, 'Examples 6-6 and 6-7'], ['A-15-9', 0.1, 3, 1.8, 'Chapter 6'],
    ['A-15-9', 0.10, 1.5, 1.68, 'Example 7-1'], ['A-15-9', 0.1, 1.23, 1.6, 'Example 7-2'],
    ['A-15-8', 0.10, 1.5, 1.42, 'Example 7-1'], ['A-15-8', 0.1, 1.23, 1.35, 'Example 7-2'],
    ['A-15-6', 0.15, 3, 1.68, 'Chapter 14'],
  ];
  for (const [fig, x, p, want, where] of book) {
    const r = readChart(fig, x, p);
    assert.ok(!r.error, `${fig}: ${r.error}`);
    assert.ok(Math.abs(r.k / want - 1) < 0.025, `${fig} at ${x}, ${p} (${where}): book ${want}, tool ${r.k.toFixed(3)}`);
  }
  // Table 7-1's first-iteration estimates are rounded, typical values: looser agreement.
  for (const [fig, x, p, want] of [['A-15-9', 0.02, 1.5, 2.7], ['A-15-8', 0.02, 1.33, 2.2], ['A-15-9', 0.1, 1.5, 1.7], ['A-15-7', 0.1, 1.5, 1.9]]) {
    assert.ok(Math.abs(readChart(fig, x, p).k / want - 1) < 0.04, `${fig}: ${readChart(fig, x, p).k}`);
  }
});

test('Kt charts: data and interpolation behave', () => {
  assert.equal(Object.keys(CHARTS).length, 12);
  for (const [name, chart] of Object.entries(CHARTS)) {
    for (const c of chart.curves) {
      assert.equal(c.x.length, c.k.length);
      for (let i = 1; i < c.x.length; i++) assert.ok(c.x[i] > c.x[i - 1], `${name}: x not increasing`);
      assert.ok(Math.min(...c.k) >= 1 && Math.max(...c.k) <= 3.02, `${name}: Kt outside 1 to 3`);
    }
  }
  close(readChart('A-15-1', 0, null).k, 3.0, 2e-3);                       // small hole in a wide plate
  close(readChart('A-15-2', 0, 0).k, 3.0, 3e-3);
  // on a printed curve the value is that curve; between two curves it lies between them
  const on = readChart('A-15-9', 0.1, 1.5).k, lo = readChart('A-15-9', 0.1, 1.1).k, mid = readChart('A-15-9', 0.1, 1.25).k;
  assert.ok(mid > lo && mid < on);
  assert.ok(readChart('A-15-9', 0.1, 1.2).k < readChart('A-15-9', 0.1, 1.3).k);
  // larger fillet radius, lower factor
  assert.ok(readChart('A-15-8', 0.05, 1.33).k > readChart('A-15-8', 0.15, 1.33).k);
  // flags and limits
  assert.deepEqual(readChart('A-15-7', 0.1, 4).flags, ['above']);
  assert.ok(readChart('A-15-7', 0.1, 1.01).flags.includes('below'));
  assert.ok(readChart('A-15-7', 0.1, 1.01).k > 1 && readChart('A-15-7', 0.1, 1.01).k < readChart('A-15-7', 0.1, 1.02).k);
  assert.ok(readChart('A-15-5', 0.026, 1.18).flags.includes('offtop'));
  assert.match(readChart('A-15-7', 0.5, 1.5).error, /off Figure A-15-7/);
  assert.match(readChart('A-15-13', 0.005, 1.5).error, /off Figure/);
  const curve = chartCurve('A-15-9', 1.25, 0.1);
  assert.ok(curve.length > 20);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i][1] <= curve[i - 1][1] + 1e-9, 'interpolated curve should fall steadily');
});

test('Kt: Shigley Example 3-13 (bar with a hole, bar with a shoulder)', () => {
  // 40 mm wide, 2 mm thick, 4 mm hole, F = 10 kN: sigma_0 = 139 MPa, sigma_max = 380 MPa
  let r = solveKt({ geometry: 'bar-hole', dims: { w: 0.04, d: 0.004, t: 0.002 }, loads: { F: 10e3 } });
  const f = r.cases.find((c) => c.load === 'F');
  close(f.nominal, 10e3 / (0.036 * 0.002)); close(f.nominal, 139e6, 2e-3);
  assert.ok(Math.abs(f.peak / 380e6 - 1) < 0.02, `${f.peak}`);
  // D = 40, d = 34, r = 1 mm: sigma_0 = 147 MPa, sigma_max = 368 MPa
  r = solveKt({ geometry: 'bar-fillet', dims: { D: 0.04, d: 0.034, r: 0.001, t: 0.002 }, loads: { F: 10e3 } });
  const g = r.cases.find((c) => c.load === 'F');
  close(g.nominal, 147e6, 1e-3);
  // The book reads Kt = 2.5 at "r/d = 1/34 = 0.026"; 1/34 is in fact 0.0294, where the chart gives a little
  // less. Here the D/d = 1.5 curve has also left the top of the chart, which the tool reports.
  close(g.x, 1 / 34); assert.ok(g.flags.includes('offtop'));
  assert.ok(Math.abs(g.peak / 368e6 - 1) < 0.07, `${g.peak}`);
});

test('Kt: nominal stresses, combination and von Mises on a shaft', () => {
  const d = 0.025, D = 0.03, rr = 0.0025, F = 5e3, M = 60, T = 80;
  const r = solveKt({ geometry: 'shaft-groove', dims: { D, d, r: rr }, loads: { F, M, T }, Sy: 390e6 });
  const by = Object.fromEntries(r.cases.map((c) => [c.load, c]));
  assert.deepEqual([by.F.figure, by.M.figure, by.T.figure], ['A-15-13', 'A-15-14', 'A-15-15']);
  close(by.F.nominal, 4 * F / (Math.PI * d * d)); close(by.M.nominal, 32 * M / (Math.PI * d ** 3)); close(by.T.nominal, 16 * T / (Math.PI * d ** 3));
  close(by.F.x, 0.1); close(by.F.p, 1.2);
  close(r.sigmaMax, by.F.K * by.F.nominal + by.M.K * by.M.nominal);
  close(r.tauMax, by.T.K * by.T.nominal);
  close(r.vonMises, Math.hypot(r.sigmaMax, Math.sqrt(3) * r.tauMax));
  close(r.safety, 390e6 / r.vonMises);
  // no loads: factors still given, stresses zero
  const z = solveKt({ geometry: 'shaft-fillet', dims: { D: 0.038, d: 0.032, r: 0.003 }, loads: {} });
  assert.ok(Math.abs(z.cases.find((c) => c.load === 'M').K / 1.65 - 1) < 0.01);
  assert.equal(z.vonMises, 0); assert.equal(z.safety, null);
  // every geometry solves with sensible dimensions; bad geometry is refused
  for (const [id, geo] of Object.entries(GEOMETRIES)) {
    const dims = { w: 0.06, D: 0.06, d: id === 'bar-hole' ? 0.012 : 0.05, r: 0.005, t: 0.01 };
    const q = solveKt({ geometry: id, dims, loads: { F: 1e3, M: 10, T: 10 } });
    assert.ok(q.ok && q.cases.length === Object.keys(geo.loads).length && q.cases.every((c) => c.K > 1), id);
  }
  assert.match(solveKt({ geometry: 'shaft-fillet', dims: { D: 0.03, d: 0.03, r: 0.001 }, loads: {} }).errors[0], /smaller diameter/);
  assert.match(solveKt({ geometry: 'shaft-fillet', dims: { D: 0.032, d: 0.03, r: 0.003 }, loads: {} }).errors[0], /fillet radius/);
});
