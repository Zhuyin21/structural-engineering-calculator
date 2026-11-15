// Solver validation against closed-form results from mechanics of materials.
// Signs are checked, not just magnitudes. Run with:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveBeam } from '../src/beam/solver.js';

const E = 200e9, G = 77e9, A = 0.02, Iz = 6e-5, Iy = 2e-5, J = 5e-5;
const props = { E, G, A, Iz, Iy, J };
const PIN = { ux: true, uy: true, uz: true };
const ROLLER = { uy: true, uz: true };
const FIXED = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

function close(actual, expected, rel = 1e-9, msg = '') {
  const scale = Math.max(Math.abs(expected), 1e-12);
  assert.ok(Math.abs(actual - expected) <= rel * scale + 1e-9 * 0,
    `${msg} expected ${expected}, got ${actual}`);
}
function near0(actual, scale, msg = '') {
  assert.ok(Math.abs(actual) <= 1e-9 * scale, `${msg} expected ~0, got ${actual}`);
}
function solve(input) {
  const r = solveBeam({ ...props, ...input });
  assert.ok(r.ok, r.errors && r.errors.join(' '));
  // Every internal force must close to zero past the right end.
  const big = Math.max(...Object.values(r.extremes).filter(Boolean).map((e) => e.abs), 1);
  for (const [k, v] of Object.entries(r.checks)) assert.ok(Math.abs(v) < 1e-7 * big, `closure ${k} = ${v}`);
  return r;
}

test('simply supported, point load: reactions, moment, deflection', () => {
  const L = 6, a = 2, b = 4, P = 12e3;
  const r = solve({ L, supports: [{ x: 0, ...PIN }, { x: L, ...ROLLER }], pointLoads: [{ x: a, Fy: -P }] });
  close(r.reactions[0].Fy, P * b / L);
  close(r.reactions[1].Fy, P * a / L);
  close(r.at(a - 1e-9, 'left').Vy, P * b / L, 1e-6);      // shear positive left of a downward load
  close(r.at(a, 'left').Vy, P * b / L);
  close(r.at(a, 'right').Vy, -P * a / L);
  close(r.extremes.Mz.max, P * a * b / L);                // sagging is positive
  close(r.extremes.Mz.xMax, a);
  close(r.at(a).v, -P * a * a * b * b / (3 * E * Iz * L));
  const xm = L - Math.sqrt((L * L - a * a) / 3);
  close(r.extremes.v.xMin, xm, 1e-8);
  close(r.extremes.v.min, -P * a * (L * L - a * a) ** 1.5 / (9 * Math.sqrt(3) * L * E * Iz), 1e-9);
  close(r.at(0).slopeXY, -P * a * b * (L + b) / (6 * E * Iz * L));
  close(r.at(L).slopeXY, P * a * b * (L + a) / (6 * E * Iz * L));
});

test('cantilever, uniform load: hogging wall moment, tip deflection and slope', () => {
  const L = 3, w = 5e3;
  const r = solve({ L, supports: [{ x: 0, ...FIXED }], distLoads: [{ x1: 0, x2: L, dir: 'y', w1: -w, w2: -w }] });
  close(r.reactions[0].Fy, w * L);
  close(r.reactions[0].Mz, w * L * L / 2);                // counter-clockwise reaction
  close(r.at(0).Vy, w * L);
  close(r.at(0).Mz, -w * L * L / 2);                      // hogging is negative
  close(r.at(L).v, -w * L ** 4 / (8 * E * Iz));
  close(r.at(L).slopeXY, -w * L ** 3 / (6 * E * Iz));
  close(r.at(L / 2).Mz, -w * (L / 2) ** 2 / 2);
});

test('cantilever, end couple: constant moment and circular-arc deflection', () => {
  const L = 2, M0 = 4e3;
  const r = solve({ L, supports: [{ x: 0, ...FIXED }], moments: [{ x: L, Mz: M0 }] });
  close(r.reactions[0].Mz, -M0);
  near0(r.reactions[0].Fy, M0);
  close(r.at(1).Mz, M0);                                  // +Mz couple bends the beam concave up
  close(r.at(L).v, M0 * L * L / (2 * E * Iz));
  close(r.at(L).slopeXY, M0 * L / (E * Iz));
});

test('simply supported, couple at midspan: moment jump', () => {
  const L = 4, M0 = 8e3;
  const r = solve({ L, supports: [{ x: 0, ...PIN }, { x: L, ...ROLLER }], moments: [{ x: 2, Mz: M0 }] });
  close(r.reactions[0].Fy, M0 / L);
  close(r.reactions[1].Fy, -M0 / L);
  close(r.at(2, 'left').Mz, M0 / 2);
  close(r.at(2, 'right').Mz, -M0 / 2);                    // counter-clockwise couple drops M
  near0(r.at(2).v, 1e-3);
});

test('fixed-fixed, uniform load (statically indeterminate)', () => {
  const L = 5, w = 3e3;
  const r = solve({ L, supports: [{ x: 0, ...FIXED }, { x: L, ...FIXED }], distLoads: [{ x1: 0, x2: L, dir: 'y', w1: -w, w2: -w }] });
  close(r.at(0).Mz, -w * L * L / 12);
  close(r.at(L).Mz, -w * L * L / 12);
  close(r.at(L / 2).Mz, w * L * L / 24);
  close(r.at(L / 2).v, -w * L ** 4 / (384 * E * Iz));
  close(r.reactions[0].Fy, w * L / 2);
  close(r.reactions[1].Mz, -w * L * L / 12);
});

test('propped cantilever, uniform load', () => {
  const L = 4, w = 2e3;
  const r = solve({ L, supports: [{ x: 0, ...FIXED }, { x: L, ...ROLLER }], distLoads: [{ x1: 0, x2: L, dir: 'y', w1: -w, w2: -w }] });
  close(r.reactions[1].Fy, 3 * w * L / 8);
  close(r.reactions[0].Fy, 5 * w * L / 8);
  close(r.at(0).Mz, -w * L * L / 8);
  close(r.extremes.Mz.max, 9 * w * L * L / 128);
  close(r.extremes.Mz.xMax, 5 * L / 8, 1e-8);
});

test('two-span continuous beam, uniform load', () => {
  const L = 4, w = 6e3;
  const r = solve({ L: 2 * L, supports: [{ x: 0, ...PIN }, { x: L, ...ROLLER }, { x: 2 * L, ...ROLLER }],
    distLoads: [{ x1: 0, x2: 2 * L, dir: 'y', w1: -w, w2: -w }] });
  close(r.reactions[0].Fy, 0.375 * w * L);
  close(r.reactions[1].Fy, 1.25 * w * L);
  close(r.at(L).Mz, -w * L * L / 8);
  near0(r.at(L).slopeXY, 1e-3);
});

test('simply supported, triangular load', () => {
  const L = 6, w0 = 9e3;
  const r = solve({ L, supports: [{ x: 0, ...PIN }, { x: L, ...ROLLER }], distLoads: [{ x1: 0, x2: L, dir: 'y', w1: 0, w2: -w0 }] });
  close(r.reactions[0].Fy, w0 * L / 6);
  close(r.reactions[1].Fy, w0 * L / 3);
  close(r.extremes.Mz.max, w0 * L * L / (9 * Math.sqrt(3)));
  close(r.extremes.Mz.xMax, L / Math.sqrt(3), 1e-8);
  // maximum deflection 0.00652 w0 L^4 / EI at x = 0.5193 L
  close(r.extremes.v.xMin / L, Math.sqrt(1 - Math.sqrt(8 / 15)), 1e-8);
  close(r.extremes.v.min, -0.006522 * w0 * L ** 4 / (E * Iz), 1e-3);
});

test('partial uniform load: peak moment where shear is zero', () => {
  const L = 10, w = 4e3;                                  // load on 2 <= x <= 6
  const r = solve({ L, supports: [{ x: 0, ...PIN }, { x: L, ...ROLLER }], distLoads: [{ x1: 2, x2: 6, dir: 'y', w1: -w, w2: -w }] });
  const Ra = w * 4 * 6 / L;
  close(r.reactions[0].Fy, Ra);
  const x0 = 2 + Ra / w;
  close(r.extremes.Mz.xMax, x0, 1e-9);
  close(r.extremes.Mz.max, Ra * x0 - w * (x0 - 2) ** 2 / 2);
});

test('formula load matches the equivalent linear load', () => {
  const L = 5, sup = [{ x: 0, ...FIXED }, { x: L, ...ROLLER }];
  const lin = solve({ L, supports: sup, distLoads: [{ x1: 1, x2: 4, dir: 'y', w1: -2e3, w2: -8e3 }] });
  const fn = solve({ L, supports: sup, distLoads: [{ x1: 1, x2: 4, dir: 'y', w: (x) => -2e3 - 2e3 * (x - 1) }] });
  for (const x of [0, 0.7, 1, 2.3, 4, 4.6]) {
    for (const k of ['Vy', 'Mz', 'v', 'slopeXY']) close(fn.at(x)[k], lin.at(x)[k], 1e-9, `${k} at ${x}`);
  }
});

test('sinusoidal formula load on a simply supported beam', () => {
  const L = 4, w0 = 5e3;
  const r = solve({ L, supports: [{ x: 0, ...PIN }, { x: L, ...ROLLER }], distLoads: [{ x1: 0, x2: L, dir: 'y', w: (x) => -w0 * Math.sin(Math.PI * x / L) }] });
  close(r.reactions[0].Fy, w0 * L / Math.PI);
  close(r.extremes.Mz.max, w0 * L * L / Math.PI ** 2);
  close(r.extremes.v.min, -w0 * L ** 4 / (Math.PI ** 4 * E * Iz));
  close(r.at(1).v, -w0 * L ** 4 / (Math.PI ** 4 * E * Iz) * Math.sin(Math.PI / 4));
});

test('overhanging beam: negative moment over the support', () => {
  const r = solve({ L: 8, supports: [{ x: 0, ...PIN }, { x: 6, ...ROLLER }], pointLoads: [{ x: 8, Fy: -10e3 }] });
  close(r.reactions[1].Fy, 10e3 * 8 / 6);
  close(r.reactions[0].Fy, -10e3 * 2 / 6);
  close(r.at(6).Mz, -20e3);
  close(r.at(8).v, -10e3 * 2 * 2 * (6 + 2) / (3 * E * Iz));   // P a^2 (L + a) / 3EI
});

test('spring support shares load with beam stiffness', () => {
  const L = 2, P = 1e3, k = 4e5;
  const r = solve({ L, supports: [{ x: 0, ...FIXED }, { x: L, kuy: k }], pointLoads: [{ x: L, Fy: -P }] });
  const kb = 3 * E * Iz / L ** 3;
  close(r.at(L).v, -P / (k + kb));
  close(r.reactions[1].Fy, P * k / (k + kb));
  close(r.reactions[0].Fy, P * kb / (k + kb));
});

test('rotational spring at a pinned end', () => {
  // Beam pinned at both ends, end couple M0 at the left; a rotational spring there takes part of it.
  const L = 3, M0 = 2e3, kr = 5e6;
  const r = solve({ L, supports: [{ x: 0, ...PIN, krz: kr }, { x: L, ...ROLLER }], moments: [{ x: 0, Mz: M0 }] });
  const kb = 3 * E * Iz / L;                              // end rotational stiffness, far end pinned
  close(r.at(0).slopeXY, M0 / (kr + kb));
  close(r.reactions[0].Mz, -M0 * kr / (kr + kb));
});

test('XZ plane mirrors XY and uses Iy', () => {
  const L = 6, a = 2, b = 4, P = 12e3;
  const r = solve({ L, supports: [{ x: 0, ...PIN }, { x: L, ...ROLLER }], pointLoads: [{ x: a, Fz: -P }] });
  close(r.reactions[0].Fz, P * b / L);
  close(r.extremes.My.max, P * a * b / L);                // sagging in the XZ view is positive
  close(r.at(a).w, -P * a * a * b * b / (3 * E * Iy * L));
  assert.equal(r.extremes.Mz.abs, 0);
  close(r.at(a).Mtotal, P * a * b / L);
});

test('moment about +y follows the right-hand rule', () => {
  const L = 2, M0 = 3e3;
  const r = solve({ L, supports: [{ x: 0, ...FIXED }], moments: [{ x: L, My: M0 }] });
  close(r.at(L).w, -M0 * L * L / (2 * E * Iy));           // +My turns +x toward -z
  close(r.reactions[0].My, -M0);
  close(r.at(L).slopeXZ, -M0 * L / (E * Iy));
});

test('both planes at once: resultant moment', () => {
  const L = 1;
  const r = solve({ L, supports: [{ x: 0, ...PIN }, { x: L, ...ROLLER }], pointLoads: [{ x: 0.5, Fy: -3e3, Fz: 4e3 }] });
  close(r.at(0.5).Mz, 750);
  close(r.at(0.5).My, -1000);
  close(r.at(0.5).Mtotal, 1250);
  close(r.extremes.Mtotal.max, 1250);
});

test('axial: tension positive, fixed-free and fixed-fixed', () => {
  const L = 2, P = 5e3;
  let r = solve({ L, supports: [{ x: 0, ...FIXED }], pointLoads: [{ x: L, Fx: P }] });
  close(r.at(1).N, P);
  close(r.at(L).u, P * L / (E * A));
  close(r.reactions[0].Fx, -P);
  r = solve({ L, supports: [{ x: 0, ...FIXED }, { x: L, ...FIXED }], pointLoads: [{ x: 0.5, Fx: P }] });
  close(r.at(0.25).N, P * 1.5 / L);
  close(r.at(1).N, -P * 0.5 / L);
  r = solve({ L, supports: [{ x: 0, ...FIXED }], distLoads: [{ x1: 0, x2: L, dir: 'x', w1: 1e3, w2: 1e3 }] });
  close(r.at(0).N, 1e3 * L);
  close(r.at(L).u, 1e3 * L * L / (2 * E * A));
});

test('torsion: fixed-free, fixed-fixed, and balanced free shaft', () => {
  const L = 2, T0 = 800;
  let r = solve({ L, supports: [{ x: 0, ...FIXED }], moments: [{ x: L, Mx: T0 }] });
  close(r.at(1).T, T0);
  close(r.at(L).twist, T0 * L / (G * J));
  close(r.reactions[0].Mx, -T0);
  r = solve({ L, supports: [{ x: 0, ...FIXED }, { x: L, ...FIXED }], moments: [{ x: 0.5, Mx: T0 }] });
  close(r.at(0.25).T, T0 * 1.5 / L);
  close(r.at(1).T, -T0 * 0.5 / L);
  r = solve({ L, supports: [{ x: 0, ...PIN }, { x: L, ...ROLLER }], moments: [{ x: 0.5, Mx: T0 }, { x: 1.5, Mx: -T0 }] });
  close(r.at(1).T, -T0);                                  // the left part carries +T0, so the cut face carries -T0
  near0(r.at(0.25).T, T0);
  near0(r.at(1.75).T, T0);
  close(r.at(L).twist, -T0 * 1 / (G * J));
  assert.equal(r.notes.length, 1);
  r = solve({ L, supports: [{ x: 0, ...FIXED }], distLoads: [{ x1: 0, x2: L, dir: 't', w1: 100, w2: 100 }] });
  close(r.at(0).T, 100 * L);
  close(r.at(L).twist, 100 * L * L / (2 * G * J));
});

test('unbalanced torque with nothing to resist it is an error', () => {
  const r = solveBeam({ ...props, L: 2, supports: [{ x: 0, ...PIN }, { x: 2, ...ROLLER }], moments: [{ x: 1, Mx: 100 }] });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /torque/i);
});

test('unstable supports are reported in plain language', () => {
  let r = solveBeam({ ...props, L: 2, supports: [{ x: 0, ...ROLLER }], pointLoads: [{ x: 1, Fy: -1 }] });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /rotate/);
  r = solveBeam({ ...props, L: 2, supports: [], pointLoads: [{ x: 1, Fy: -1 }] });
  assert.match(r.errors[0], /Nothing holds/);
  r = solveBeam({ ...props, L: 2, supports: [{ x: 0, ...ROLLER }, { x: 2, ...ROLLER }], pointLoads: [{ x: 1, Fx: 5 }] });
  assert.match(r.errors[0], /axial/);
  // A plane with no load in it does not need supports.
  r = solveBeam({ ...props, L: 2, supports: [{ x: 0, uy: true }, { x: 2, uy: true }], pointLoads: [{ x: 1, Fy: -1 }] });
  assert.equal(r.ok, true);
});

test('input checks', () => {
  assert.equal(solveBeam({ L: 0 }).ok, false);
  assert.match(solveBeam({ L: 2, supports: [{ x: 3, ...FIXED }] }).errors[0], /Support 1/);
  assert.match(solveBeam({ L: 2, distLoads: [{ x1: 1, x2: 1, dir: 'y', w1: 1, w2: 1 }] }).errors[0], /end after/);
  assert.match(solveBeam({ L: 2, supports: [{ x: 0, ...FIXED }], distLoads: [{ x1: 0, x2: 2, dir: 'y', w: (x) => 1 / (x - 1) }] }).errors[0], /formula/);
});

test('without E and I: reactions and force diagrams only', () => {
  const r = solveBeam({ L: 5, supports: [{ x: 0, ...FIXED }, { x: 5, ...ROLLER }], distLoads: [{ x1: 0, x2: 5, dir: 'y', w1: -2e3, w2: -2e3 }] });
  assert.ok(r.ok);
  close(r.reactions[1].Fy, 3 * 2e3 * 5 / 8);
  assert.equal(r.v, null);
  assert.equal(r.at(2).v, null);
  assert.equal(r.warnings.length, 1);
  const s = solveBeam({ L: 5, supports: [{ x: 0, ...FIXED }, { x: 5, kuy: 1e5 }], pointLoads: [{ x: 5, Fy: -1 }] });
  assert.equal(s.ok, false);
  assert.match(s.errors[0], /spring/i);
});

test('deflection and slope are continuous across every load and support', () => {
  const r = solve({ L: 9, supports: [{ x: 0, ...PIN }, { x: 3.5, ...ROLLER }, { x: 9, ...FIXED }],
    pointLoads: [{ x: 1.2, Fy: -4e3, Fz: 2e3 }, { x: 6, Fy: 3e3 }], moments: [{ x: 2, Mz: 1500, My: -700 }],
    distLoads: [{ x1: 4, x2: 8, dir: 'y', w1: -1e3, w2: -5e3 }, { x1: 0.5, x2: 7, dir: 'z', w: (x) => 800 * Math.cos(x) }] });
  for (const xn of r.nodes.slice(1, -1)) {
    const l = r.at(xn, 'left'), rt = r.at(xn, 'right');
    for (const k of ['v', 'slopeXY', 'w', 'slopeXZ']) {
      assert.ok(Math.abs(l[k] - rt[k]) < 1e-12, `${k} jumps at x = ${xn}: ${l[k]} vs ${rt[k]}`);
    }
  }
  near0(r.at(3.5).v, 1e-3); near0(r.at(9).v, 1e-3); near0(r.at(9).slopeXY, 1e-3); near0(r.at(9).slopeXZ, 1e-3);
  // Global equilibrium in y from the reactions.
  const sumFy = r.reactions.reduce((s, q) => s + q.Fy, 0);
  close(sumFy, 4e3 - 3e3 + (1e3 + 5e3) / 2 * 4);
});

test('superposition holds', () => {
  const sup = [{ x: 0, ...FIXED }, { x: 4, ...ROLLER }, { x: 7, ...ROLLER }];
  const a = { pointLoads: [{ x: 2, Fy: -5e3 }] }, b = { distLoads: [{ x1: 3, x2: 7, dir: 'y', w1: -2e3, w2: 0 }] };
  const ra = solve({ L: 7, supports: sup, ...a }), rb = solve({ L: 7, supports: sup, ...b });
  const rab = solve({ L: 7, supports: sup, ...a, ...b });
  for (const x of [0.5, 2, 3.3, 5.9]) for (const k of ['Vy', 'Mz', 'v']) close(rab.at(x)[k], ra.at(x)[k] + rb.at(x)[k], 1e-8);
});
