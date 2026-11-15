// Shaft analysis, checked against Shigley's Mechanical Engineering Design,
// 11th ed., Chapters 6 and 7, and against the beam solver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  solveShaft, surfaceFactor, sizeFactor, enduranceLimitPrime, notchSensitivity, fatigueSafety, fatigueStrengthCoefficient, RELIABILITY,
} from '../src/shaft/solver.js';
import { SHAFT_EXAMPLES, shaftInput, normalizeShaft, convertShaft, emptyShaft, loadRows } from '../src/shaft/model.js';
import { solveBeam } from '../src/beam/solver.js';
import { UNIT_PRESETS } from '../src/core/units.js';

const IN = 0.0254, LBF = 4.4482216152605, PSI = LBF / (IN * IN), KPSI = 1e3 * PSI, LBIN = LBF * IN, DEG = Math.PI / 180;
const near = (a, b, rel, what = '') => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${what} expected ${b}, got ${a}`);

test('shaft: Marin factors and notch sensitivity of Example 7-1', () => {
  const Sut = 105 * KPSI;
  near(enduranceLimitPrime(Sut, true), 52.5 * KPSI, 1e-12);
  near(surfaceFactor('machined', Sut, true), 0.729, 1e-3, 'ka');
  near(sizeFactor(1.1 * IN, true).kb, 0.870, 1e-3, 'kb');
  assert.equal(RELIABILITY[99], 0.814);
  near(notchSensitivity(0.11 * IN, Sut, false, true).q, 0.85, 0.01, 'q');
  near(notchSensitivity(0.11 * IN, Sut, true, true).q, 0.88, 0.01, 'q shear');
  near(fatigueStrengthCoefficient(Sut, true), 155 * KPSI, 1e-12);
  // The four answers of the example from its own stresses and strengths.
  const n = fatigueSafety({ sigA: 15235, sigM: 9988, Se: 27100, Sut: 105000, sigF: 155000 });
  near(n.goodman, 1.52, 0.004); near(n.morrow, 1.60, 0.004); near(n.gerber, 1.73, 0.004);
});

test('shaft: SI and U.S. customary fits agree', () => {
  for (const Sut of [400e6, 690e6, 1000e6]) {
    for (const finish of ['ground', 'machined', 'hotrolled', 'forged']) near(surfaceFactor(finish, Sut, false), surfaceFactor(finish, Sut, true), 0.012, finish);
    for (const r of [0.5e-3, 2e-3, 3e-3]) for (const tors of [false, true]) near(notchSensitivity(r, Sut, tors, false).q, notchSensitivity(r, Sut, tors, true).q, 0.01, 'q');
  }
  for (const d of [10e-3, 30e-3, 50e-3, 80e-3, 200e-3]) near(sizeFactor(d, false).kb, sizeFactor(d, true).kb, 0.005, 'kb');
  // Example 6-7: Sut = 690 MPa, r = 3 mm, Kt = 1.65 gives Kf = 1.55.
  near(1 + notchSensitivity(3e-3, 690e6, false, false).q * 0.65, 1.55, 0.004);
  assert.equal(sizeFactor(5e-3, false).kb, 1);
  assert.equal(notchSensitivity(1e-3, 300e6, false, false).clamped, true);
});

test('shaft: fatigue criteria limits', () => {
  const base = { Se: 200e6, Sut: 600e6, sigF: 945e6 };
  const rev = fatigueSafety({ ...base, sigA: 100e6, sigM: 0 });
  near(rev.goodman, 2, 1e-12); near(rev.morrow, 2, 1e-12); near(rev.gerber, 2, 1e-12);
  const steady = fatigueSafety({ ...base, sigA: 0, sigM: 300e6 });
  near(steady.goodman, 2, 1e-12); near(steady.gerber, 2, 1e-12); near(steady.morrow, 3.15, 1e-12);
  const none = fatigueSafety({ ...base, sigA: 0, sigM: 0 });
  assert.equal(none.goodman, Infinity); assert.equal(none.gerber, Infinity);
  // Gerber satisfies its own parabola, and lies above Goodman.
  const mix = fatigueSafety({ ...base, sigA: 80e6, sigM: 150e6 });
  near(mix.gerber * 80e6 / 200e6 + (mix.gerber * 150e6 / 600e6) ** 2, 1, 1e-12);
  assert.ok(mix.gerber > mix.morrow && mix.morrow > mix.goodman);
});

// The countershaft of Examples 7-2 and 7-3 (Figure 7-10), in SI.
function countershaft(material, extra = {}) {
  const D = [1.0, 1.4, 1.625, 2.0, 1.625, 1.4, 1.0], X = [0, 1.25, 1.75, 3.5, 7.5, 9.75, 10.25, 11.5], T = 3240 * LBIN;
  return { sections: D.map((d, i) => ({ L: (X[i + 1] - X[i]) * IN, d: d * IN })),
    shoulders: [{ type: 'bearing', width: 1.0 * IN }, { type: 'none', r: 0.05 * IN },
      { type: 'gear', width: 1.5 * IN, key: true, Fy: -197 * LBF, Fz: 540 * LBF, T },
      { type: 'gear', width: 2.0 * IN, key: true, Fy: -885 * LBF, Fz: -2431 * LBF, T: -T },
      { type: 'none', r: 0.05 * IN }, { type: 'bearing', width: 1.0 * IN }],
    material, criterion: 'goodman', finish: 'machined', ke: 1, us: true, ...extra };
}

test('shaft: Example 7-2 reactions, moments and torque', () => {
  const r = solveShaft(countershaft({ E: 30e6 * PSI, G: 11.5e6 * PSI, Sut: 68 * KPSI, Sy: 57 * KPSI }));
  assert.ok(r.ok, r.errors?.join(' '));
  const [A, B] = r.reactions;
  near(A.x, 0.75 * IN, 1e-12); near(B.x, 10.75 * IN, 1e-12);
  near(Math.abs(A.Fy), 356.7 * LBF, 5e-4); near(Math.abs(A.Fz), 115.0 * LBF, 5e-4);
  near(Math.abs(B.Fy), 725.3 * LBF, 5e-4); near(Math.abs(B.Fz), 1776.0 * LBF, 5e-4);
  for (const [x, M] of [[2.75, 749], [7.5, 3651], [8.5, 4316], [9.5, 2398], [10.25, 959]]) near(r.at(x * IN).Mtotal, M * LBIN, 1.5e-3, `M at ${x}`);
  near(Math.abs(r.at(5 * IN).T), 3240 * LBIN, 1e-12);
  assert.equal(r.at(1 * IN).T, 0); assert.equal(r.at(9.6 * IN).T, 0);
  for (const k of ['V', 'M', 'T']) assert.ok(r.checks[k] < 1e-12);
});

test('shaft: Example 7-2 fatigue at shoulder I and at the keyseat', () => {
  const r = solveShaft(countershaft({ E: 30e6 * PSI, Sut: 68 * KPSI, Sy: 57 * KPSI }));
  const I = r.locations.find((l) => l.kind === 'shoulder' && Math.abs(l.x - 7.5 * IN) < 1e-9);
  near(I.d, 1.625 * IN, 1e-12); near(I.D / I.d, 1.23, 0.005);
  near(I.Kt, 1.6, 0.03, 'Kt'); near(I.Kts, 1.35, 0.03, 'Kts');
  near(I.Kf, 1.49, 0.03, 'Kf'); near(I.Kfs, 1.30, 0.03, 'Kfs');
  near(I.kb, 0.835, 1e-3); near(I.Se, 22.7 * KPSI, 3e-3, 'Se');
  near(I.sigA, 12910 * PSI, 0.03, 'sigma a'); near(I.sigM, 8659 * PSI, 0.03, 'sigma m');
  near(I.n, 1.44, 0.03, 'n');
  // Keyseat: Table 7-1 factors and r = 0.02 d give the book's Kf = 1.74, Kfs = 2.42.
  const key = r.locations.find((l) => l.kind === 'keyseat' && l.x > 8 * IN);
  near(key.Kf, 1.74, 0.01, 'keyseat Kf'); near(key.Kfs, 2.42, 0.01, 'keyseat Kfs');
  near(key.sigM, 16120 * PSI, 2e-3, 'keyseat sigma m');
  // The book takes M = 3750 at the end of the keyseat; here it is checked under the gear, M = 4316.
  near(key.sigA, 15490 * PSI * 4316 / 3750, 5e-3, 'keyseat sigma a');
  assert.equal(r.fatigue.critical, key);
  // Bearing seat M with the 1050 CD steel: Kt near the 2.7 estimate, q = 0.7.
  const r2 = solveShaft(countershaft({ Sut: 100 * KPSI, Sy: 84 * KPSI }));
  const M = r2.locations.find((l) => Math.abs(l.x - 10.25 * IN) < 1e-9);
  near(M.Kt, 2.7, 0.03); near(M.q, 0.7, 0.03); near(M.M, 959 * LBIN, 1e-3);
  assert.equal(r2.v, null);                         // no E: forces and fatigue only
});

test('shaft: Example 7-3 slopes and deflections of the stepped shaft (Table 7-3)', () => {
  const r = solveShaft(countershaft({ E: 30e6 * PSI }));
  const [A, G3, G4, B] = r.points;
  assert.deepEqual(r.points.map((p) => p.type), ['bearing', 'gear', 'gear', 'bearing']);
  const rows = [[A, 'slopeXZ', 0.02263], [A, 'slopeXY', 0.01770], [A, 'slope', 0.02872], [B, 'slopeXZ', 0.05711], [B, 'slopeXY', 0.02599], [B, 'slope', 0.06274],
    [G3, 'slopeXZ', 0.02067], [G3, 'slopeXY', 0.01162], [G3, 'slope', 0.02371], [G4, 'slopeXZ', 0.02155], [G4, 'slopeXY', 0.01149], [G4, 'slope', 0.02442]];
  for (const [p, k, deg] of rows) near(Math.abs(p[k]), deg * DEG, 1.5e-3, `${p.label} ${k}`);
  for (const [p, k, inch] of [[G3, 'w', 0.0007568], [G3, 'v', 0.0005153], [G3, 'deflection', 0.0009155], [G4, 'w', 0.0015870], [G4, 'v', 0.0007535], [G4, 'deflection', 0.0017567]]) {
    near(Math.abs(p[k]), inch * IN, 1e-3, `${p.label} ${k}`);
  }
  assert.ok(Math.abs(A.v) + Math.abs(A.w) + Math.abs(B.v) + Math.abs(B.w) < 1e-18);
});

test('shaft: Example 7-1 shoulder inside a complete shaft', () => {
  // The shoulder of Example 7-1 (d = 1.100, D = 1.65, r = 0.11 in) between a
  // pulley that brings in 1100 lbf in and a gear that takes it out. The gear
  // force is chosen so that M = 1260 lbf in at the shoulder.
  const d = [0.8, 1.0, 1.1, 1.65, 1.2, 0.8], len = [1, 2, 3, 2, 3, 1];
  const xA = 1, xB = 11, xS = 6, xG = 8, P = 1260 / ((xS - xA) * (xB - xG) / (xB - xA));
  const input = { sections: d.map((v, i) => ({ L: len[i] * IN, d: v * IN })),
    shoulders: [{ type: 'bearing' }, { type: 'pulley', T: 1100 * LBIN }, { type: 'none', r: 0.11 * IN }, { type: 'gear', Fy: -P * LBF, T: -1100 * LBIN }, { type: 'bearing' }],
    material: { Sut: 105 * KPSI, Sy: 82 * KPSI }, finish: 'machined', ke: 0.814, us: true, criterion: 'gerber' };
  const r = solveShaft(input);
  assert.ok(r.ok, r.errors?.join(' '));
  const s = r.locations.find((l) => l.kind === 'shoulder' && l.joint === 2);
  near(s.M, 1260 * LBIN, 1e-9); near(s.T, 1100 * LBIN, 1e-12);
  near(s.Kt, 1.68, 0.01, 'Kt'); near(s.Kts, 1.42, 0.02, 'Kts');
  near(s.Kf, 1.58, 0.01, 'Kf'); near(s.Kfs, 1.37, 0.02, 'Kfs');
  near(s.Se, 27.1 * KPSI, 3e-3, 'Se');
  near(s.sigA, 15235 * PSI, 0.01); near(s.sigM, 9988 * PSI, 0.02);
  near(s.nAll.goodman, 1.52, 0.015); near(s.nAll.morrow, 1.60, 0.015); near(s.nAll.gerber, 1.73, 0.015);
  near(s.ny, 4.50, 0.015, 'ny');
  assert.equal(s.n, s.nAll.gerber);
});

test('shaft: uniform shaft agrees with the beam solver in both planes', () => {
  const d = 0.04, I = Math.PI * d ** 4 / 64, E = 207e9, G = 79.3e9, L = 0.8;
  const el = [{ x: 0.1, type: 'bearing' }, { x: 0.3, type: 'gear', Fy: -2000, Fz: 1500, T: 90, Mz: 25 }, { x: 0.55, type: 'pulley', Fy: 800, Fz: -2600, T: -150, My: -40 },
    { x: 0.7, type: 'bearing' }, { x: 0.8, type: 'load', Fy: -300, Fz: 200, T: 60 }];
  const r = solveShaft({ uniform: true, sections: [{ L, d }], elements: el, material: { E, G, Sut: 520e6, Sy: 290e6 }, finish: 'machined', ke: 1 });
  assert.ok(r.ok, r.errors?.join(' '));
  const loads = el.filter((e) => e.type !== 'bearing');
  const b = solveBeam({ L, E, G, A: Math.PI * d * d / 4, Iy: I, Iz: I, J: 2 * I,
    supports: [{ x: 0.1, uy: true, uz: true }, { x: 0.7, uy: true, uz: true }],
    pointLoads: loads.map((p) => ({ x: p.x, Fx: 0, Fy: p.Fy, Fz: p.Fz })),
    moments: loads.map((p) => ({ x: p.x, Mx: p.T, My: p.My ?? 0, Mz: p.Mz ?? 0 })) });
  assert.ok(b.ok, b.errors?.join(' '));
  const scale = { Vy: 3000, Vz: 3000, Mz: 400, My: 400, T: 150, v: 1e-4, w: 1e-4, slopeXY: 1e-3, slopeXZ: 1e-3 };
  for (const x of [0.05, 0.1, 0.2, 0.3, 0.42, 0.55, 0.62, 0.7, 0.76]) {
    for (const side of [-1, 1]) {
      const s = r.at(x, side), q = b.at(x, side < 0 ? 'left' : 'right');
      for (const [k, sc] of Object.entries(scale)) assert.ok(Math.abs(s[k] - q[k]) < 1e-7 * sc, `${k} at ${x} side ${side}: shaft ${s[k]}, beam ${q[k]}`);
    }
  }
  // twist is measured from x = 0 in both
  for (const x of [0.2, 0.45, 0.75]) assert.ok(Math.abs(r.at(x).twist - b.at(x, 'right').twist) < 1e-9);
  // no stress raiser on a uniform shaft
  assert.ok(r.locations.every((l) => l.Kf === 1 && l.Kfs === 1));
  const g = r.locations.find((l) => l.kind === 'gear');
  near(g.sigA, 32 * g.M / (Math.PI * d ** 3), 1e-12); near(g.sigM, Math.sqrt(3) * 16 * g.T / (Math.PI * d ** 3), 1e-12);
});

test('shaft: stepped deflection reduces to the uniform case and matches a hand result', () => {
  // Simply supported, central load: delta = P L^3 / 48 E I, end slope = P L^2 / 16 E I.
  const d = 0.03, I = Math.PI * d ** 4 / 64, E = 200e9, P = 1000, L = 0.6;
  const r = solveShaft({ uniform: true, sections: [{ L: 0.2, d }, { L: 0.4, d }], elements: [{ x: 0, type: 'bearing' }, { x: 0.3, type: 'load', Fy: -P }, { x: 0.6, type: 'bearing' }], material: { E } });
  near(r.at(0.3).v, -P * L ** 3 / (48 * E * I), 1e-10);
  near(r.at(0).slopeXY, -P * L * L / (16 * E * I), 1e-10);
  near(r.extremes.v.abs, P * L ** 3 / (48 * E * I), 1e-10);
  // Fz the same size gives the same deflection along z.
  const z = solveShaft({ uniform: true, sections: [{ L, d }], elements: [{ x: 0, type: 'bearing' }, { x: 0.3, type: 'load', Fz: -P }, { x: 0.6, type: 'bearing' }], material: { E } });
  near(z.at(0.3).w, -P * L ** 3 / (48 * E * I), 1e-10);
  // A hollow middle third is more flexible, and the stress there uses the tube section.
  const t = 0.005, It = Math.PI * (d ** 4 - (d - 2 * t) ** 4) / 64;
  const hlw = solveShaft({ uniform: true, sections: [{ L: 0.2, d }, { L: 0.2, d, t }, { L: 0.2, d }],
    elements: [{ x: 0, type: 'bearing' }, { x: 0.3, type: 'load', Fy: -P }, { x: 0.6, type: 'bearing' }], material: { E, Sut: 500e6, Sy: 300e6 } });
  assert.ok(Math.abs(hlw.at(0.3).v) > Math.abs(r.at(0.3).v));
  const mid = hlw.locations.find((l) => l.kind === 'load');
  near(mid.sigA, (P * L / 4) * (d / 2) / It, 1e-10);
  const bore = hlw.locations.find((l) => l.kind === 'bore');
  near(bore.sigA, (P / 2 * 0.2) * (d / 2) / It, 1e-10);       // the weaker, hollow side
  // Stepped: two diameters, by superposition of M / EI areas (unit-load method).
  const d2 = 0.04, I2 = Math.PI * d2 ** 4 / 64;
  const st = solveShaft({ sections: [{ L: 0.05, d: 0.02 }, { L: 0.3, d }, { L: 0.3, d: d2 }, { L: 0.05, d: 0.02 }],
    shoulders: [{ type: 'bearing' }, { type: 'gear', Fy: -P }, { type: 'bearing' }], material: { E } });
  assert.ok(st.ok, st.errors?.join(' '));
  // delta at the load = integral of M m / EI with M = P x / 2, m = x / 2 on each half
  const expected = (P / 4) * (0.3 ** 3 / 3) * (1 / (E * I) + 1 / (E * I2));
  near(Math.abs(st.at(0.35).v), expected, 1e-10);
});

test('shaft: input errors are explained', () => {
  const ok = { sections: [{ L: 0.1, d: 0.02 }, { L: 0.3, d: 0.03 }, { L: 0.1, d: 0.02 }], shoulders: [{ type: 'bearing' }, { type: 'bearing' }], material: { E: 207e9, Sut: 400e6, Sy: 220e6 } };
  assert.ok(solveShaft(ok).ok);
  const bad = (change, text) => { const r = solveShaft({ ...ok, ...change }); assert.equal(r.ok, false); assert.ok(r.errors.some((e) => e.includes(text)), `${r.errors}`); };
  bad({ shoulders: [{ type: 'bearing' }, { type: 'gear' }] }, 'exactly two bearings');
  bad({ sections: [{ L: 0.1, d: 0.03 }, { L: 0.3, d: 0.03 }, { L: 0.1, d: 0.02 }] }, 'no shoulder');
  bad({ sections: [{ L: 0.1, d: 0.02 }, { L: 0.3, d: 0.03, t: 0.004 }, { L: 0.1, d: 0.02 }] }, 'must be solid');
  bad({ shoulders: [{ type: 'bearing', width: 0.2 }, { type: 'bearing' }] }, 'wider than section 1');
  bad({ sections: [{ L: 0.1, d: 0.02 }] }, 'at least two sections');
  const four = { sections: [{ L: 0.1, d: 0.02 }, { L: 0.1, d: 0.03 }, { L: 0.1, d: 0.04 }, { L: 0.1, d: 0.03 }, { L: 0.1, d: 0.02 }], material: ok.material };
  bad({ ...four, shoulders: [{ type: 'bearing' }, { type: 'gear', T: 50 }, { type: 'pulley', T: -40 }, { type: 'bearing' }] }, 'torques');
  // a plain shoulder without a radius is reported, not guessed
  const r = solveShaft({ ...four, shoulders: [{ type: 'bearing' }, { type: 'none' }, { type: 'gear', Fy: -500 }, { type: 'bearing' }] });
  assert.ok(r.ok);
  assert.ok(r.locations.find((l) => l.joint === 1).error);
  assert.ok(r.warnings.some((w) => w.includes('fillet radius')));
  bad({ uniform: true, sections: [{ L: 0.3, d: 0.03 }, { L: 0.3, d: 0.04 }], elements: [{ x: 0, type: 'bearing' }, { x: 0.6, type: 'bearing' }] }, 'one outer diameter');
  bad({ uniform: true, sections: [{ L: 0.3, d: 0.03 }], elements: [{ x: 0, type: 'bearing' }, { x: 0.4, type: 'bearing' }] }, 'not on the shaft');
});

test('shaft: bearing and gear fillets follow the r/d rules', () => {
  const r = solveShaft({ sections: [{ L: 0.05, d: 0.02 }, { L: 0.1, d: 0.03 }, { L: 0.1, d: 0.04 }, { L: 0.1, d: 0.03 }, { L: 0.05, d: 0.02 }],
    shoulders: [{ type: 'bearing' }, { type: 'sprocket', Fy: -900, T: 40 }, { type: 'gear', Fz: 1200, T: -40, key: true }, { type: 'bearing' }],
    material: { E: 207e9, Sut: 520e6, Sy: 290e6 }, finish: 'machined', ke: 0.814 });
  assert.ok(r.ok, r.errors?.join(' '));
  const sh = r.locations.filter((l) => l.kind === 'shoulder');
  near(sh[0].r, 0.02 * 0.02, 1e-12); near(sh[1].r, 0.1 * 0.03, 1e-12); near(sh[2].r, 0.1 * 0.03, 1e-12); near(sh[3].r, 0.02 * 0.02, 1e-12);
  assert.ok(sh[0].Kt > 2.4 && sh[1].Kt < 1.8);
  assert.equal(r.locations.filter((l) => l.kind === 'keyseat').length, 1);
  assert.equal(r.locations.filter((l) => l.critical).length, 1);
  assert.equal(r.fatigue.critical.n, Math.min(...r.locations.map((l) => l.n)));
});

test('shaft: every example solves, saves and converts', () => {
  for (const ex of SHAFT_EXAMPLES) {
    const m = normalizeShaft(structuredClone(ex));
    const { input, errors } = shaftInput(m);
    assert.deepEqual(errors, [], ex.title);
    const r = solveShaft(input);
    assert.ok(r.ok, `${ex.title}: ${r.errors?.join(' ')}`);
    assert.ok(r.fatigue?.critical, ex.title);
    assert.ok(r.fatigue.critical.n > 0.5 && r.fatigue.critical.n < 20, `${ex.title}: n = ${r.fatigue.critical.n}`);
    assert.ok(r.warnings.every((w) => !w.includes('enter')), `${ex.title}: ${r.warnings}`);
    // changing units with conversion leaves the physics alone
    const to = m.units.force === 'lbf' ? UNIT_PRESETS['kN, m'] : UNIT_PRESETS['lbf, in'];
    const r2 = solveShaft({ ...shaftInput(convertShaft(m, m.units, to)).input, us: input.us });
    near(r2.fatigue.critical.n, r.fatigue.critical.n, 1e-9, ex.title);
    near(r2.extremes.Mtotal.abs, r.extremes.Mtotal.abs, 1e-9, ex.title);
    assert.ok(loadRows(m).length >= 1);
  }
  const blank = shaftInput(emptyShaft());
  assert.ok(blank.errors.length > 0);
  // the book's countershaft through the model layer
  const book = solveShaft(shaftInput(normalizeShaft(structuredClone(SHAFT_EXAMPLES[0]))).input);
  near(book.reactions[1].radial, Math.hypot(725.3, 1776.0) * LBF, 5e-4);
});
