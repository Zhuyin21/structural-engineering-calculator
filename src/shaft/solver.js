// Shaft analysis, following Shigley's Mechanical Engineering Design, 11th ed.
//
//   Chapter 7   rotating shaft on two bearings: the combined bending moment
//               is completely reversed, the torque is steady, no axial load
//               (Eqs. 7-4 to 7-16, Table 7-1)
//   Chapter 6   endurance limit and Marin factors (Eqs. 6-10, 6-17 to 6-19,
//               Tables 6-2 and 6-4), notch sensitivity (Eqs. 6-32 to 6-36),
//               fatigue criteria (Goodman, Morrow, Gerber) and Eq. 6-44
//   Table A-15  Figures A-15-8 and A-15-9 for the shoulder fillets
//
// A stepped shaft is solid. Every bearing, gear, pulley or sprocket is located
// against a shoulder; its load acts at the middle of its width, measured from
// the shoulder onto the smaller diameter. A uniform shaft has one outer
// diameter, may be hollow over part of its length, and carries no stress
// concentration.
//
// Statics are exact (two bearings, point forces and couples). Slope and
// deflection integrate M / EI section by section, so the steps are included.
// Signs match the beam calculator; see docs/sign-conventions.md. All SI.
import { readChart } from '../kt/solver.js';

const PI = Math.PI;
const KPSI = 6894757.293168, MPA = 1e6, INCH = 0.0254, MM = 1e-3;

// Table 6-2: ka = a Sut^b, with a for Sut in kpsi and in MPa.
export const FINISHES = {
  ground: { label: 'Ground', us: 1.21, si: 1.38, b: -0.067 },
  machined: { label: 'Machined or cold-drawn', us: 2.00, si: 3.04, b: -0.217 },
  hotrolled: { label: 'Hot-rolled', us: 11.0, si: 38.6, b: -0.650 },
  forged: { label: 'As-forged', us: 12.7, si: 54.9, b: -0.758 },
};
// Table 6-4: reliability factor ke.
export const RELIABILITY = { 50: 1.000, 90: 0.897, 95: 0.868, 99: 0.814, 99.9: 0.753, 99.99: 0.702 };
export const CRITERIA = { goodman: 'DE-Goodman', morrow: 'DE-Morrow', gerber: 'DE-Gerber' };
// What can sit against a shoulder, and the fillet it calls for (Sec. 7-4).
export const COMPONENTS = {
  bearing: { label: 'Bearing', rd: 0.02 },
  gear: { label: 'Gear', rd: 0.1 },
  pulley: { label: 'Pulley', rd: 0.1 },
  sprocket: { label: 'Sprocket', rd: 0.1 },
  load: { label: 'Load point', rd: null },      // uniform shafts only
};
// Table 7-1, first-iteration estimates.
export const TABLE_7_1 = {
  sharp: { Kt: 2.7, Kts: 2.2 },       // shoulder fillet, r/d = 0.02
  round: { Kt: 1.7, Kts: 1.5 },       // shoulder fillet, r/d = 0.1
  keyseat: { Kt: 2.14, Kts: 3.0, rd: 0.02 },   // end-mill keyseat
};

/** Surface factor ka, Eq. 6-18. */
export function surfaceFactor(finish, Sut, us) {
  const f = FINISHES[finish] ?? FINISHES.machined;
  return Math.min(1, us ? f.us * (Sut / KPSI) ** f.b : f.si * (Sut / MPA) ** f.b);
}

/** Size factor kb for a rotating round shaft in bending and torsion, Eq. 6-19. */
export function sizeFactor(d, us) {
  if (us) {
    const x = d / INCH;
    if (x < 0.3) return { kb: 1, out: 'small' };
    if (x <= 2) return { kb: 0.879 * x ** -0.107 };
    return { kb: 0.91 * x ** -0.157, out: x > 10 ? 'large' : undefined };
  }
  const x = d / MM;
  if (x < 7.62) return { kb: 1, out: 'small' };
  if (x <= 51) return { kb: 1.24 * x ** -0.107 };
  return { kb: 1.51 * x ** -0.157, out: x > 254 ? 'large' : undefined };
}

/** Rotating-beam endurance limit of a steel, Eq. 6-10. */
export function enduranceLimitPrime(Sut, us) {
  if (us) return Sut <= 200 * KPSI ? 0.5 * Sut : 100 * KPSI;
  return Sut <= 1400 * MPA ? 0.5 * Sut : 700 * MPA;
}

/** Fatigue strength coefficient of a steel for the Morrow line, Eq. 6-44. */
export const fatigueStrengthCoefficient = (Sut, us) => Sut + (us ? 50 * KPSI : 345 * MPA);

/**
 * Notch sensitivity q, Eqs. 6-33, 6-35 (bending) and 6-36 (torsion).
 * The fits hold over a range of Sut; outside it the nearest end is used.
 * For radii above 0.16 in (4 mm) the value at that radius is used, as the
 * captions of Figures 6-26 and 6-27 say.
 */
export function notchSensitivity(r, Sut, torsion, us) {
  let s, rootA, rootR, clamped = false;
  if (us) {
    const lo = 50, hi = torsion ? 220 : 250;
    s = Sut / KPSI;
    if (s < lo || s > hi) { clamped = true; s = Math.min(hi, Math.max(lo, s)); }
    rootA = torsion ? 0.190 - 2.51e-3 * s + 1.35e-5 * s * s - 2.67e-8 * s ** 3 : 0.246 - 3.08e-3 * s + 1.51e-5 * s * s - 2.67e-8 * s ** 3;
    rootR = Math.sqrt(Math.min(r / INCH, 0.16));
  } else {
    const lo = 340, hi = torsion ? 1500 : 1700;
    s = Sut / MPA;
    if (s < lo || s > hi) { clamped = true; s = Math.min(hi, Math.max(lo, s)); }
    rootA = torsion ? 0.958 - 1.83e-3 * s + 1.43e-6 * s * s - 4.11e-10 * s ** 3 : 1.24 - 2.25e-3 * s + 1.60e-6 * s * s - 4.11e-10 * s ** 3;
    rootR = Math.sqrt(Math.min(r / MM, 4));
  }
  return { q: 1 / (1 + rootA / rootR), clamped };
}

/**
 * Fatigue factors of safety for an alternating and a mean von Mises stress
 * (Sec. 6-13). A location with no stress has an infinite factor.
 */
export function fatigueSafety({ sigA, sigM, Se, Sut, sigF }) {
  const line = (Sm) => (sigA === 0 && sigM === 0 ? Infinity : 1 / (sigA / Se + sigM / Sm));
  let gerber;
  if (sigM === 0) gerber = sigA === 0 ? Infinity : Se / sigA;
  else if (sigA === 0) gerber = Sut / sigM;
  else gerber = 0.5 * (Sut / sigM) ** 2 * (sigA / Se) * (-1 + Math.sqrt(1 + (2 * sigM * Se / (Sut * sigA)) ** 2));
  return { goodman: line(Sut), morrow: line(sigF), gerber };
}

const tubeI = (d, t) => { const di = t > 0 ? d - 2 * t : 0; return PI * (d ** 4 - di ** 4) / 64; };

/**
 * Solve a shaft.
 *
 * input = {
 *   uniform    false: stepped and solid; true: one outer diameter
 *   sections   [{ L, d, t }]   left to right; t is the wall thickness of a hollow part (uniform only)
 *   shoulders  stepped: one per joint between sections,
 *              { type: 'none'|'bearing'|'gear'|'pulley'|'sprocket', r, width, key, Fy, Fz, T, My, Mz }
 *   elements   uniform: [{ x, type, Fy, Fz, T, My, Mz }]
 *   material   { E, G, Sut, Sy }
 *   criterion  'goodman' | 'morrow' | 'gerber'
 *   finish     key of FINISHES
 *   ke         reliability factor
 *   us         true to use the U.S. customary curve fits (kpsi, in), else the SI ones
 *   sigF       optional fatigue strength coefficient for Morrow
 * }
 */
export function solveShaft(input, opts = {}) {
  const errors = [], warnings = [], notes = [];
  const secs = input.sections || [];
  if (!secs.length) return { ok: false, errors: ['Add at least one section.'] };
  secs.forEach((sc, i) => {
    if (!(sc.L > 0)) errors.push(`Section ${i + 1}: enter a length greater than zero.`);
    if (!(sc.d > 0)) errors.push(`${input.uniform ? 'Shaft' : `Section ${i + 1}`}: enter a diameter greater than zero.`);
    if (sc.t && !(sc.t > 0 && 2 * sc.t < sc.d)) errors.push(`Section ${i + 1}: the wall thickness must be less than half the diameter.`);
  });
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  const bounds = [0];
  for (const sc of secs) bounds.push(bounds[bounds.length - 1] + sc.L);
  const L = bounds[bounds.length - 1], tol = 1e-9 * L;
  const mat = input.material || {};
  const us = !!input.us;

  // --- stations: where a bearing reacts or a load acts ----------------------
  const stations = [];       // { x, type, label, sec, joint, Fy, Fz, T, My, Mz, key }
  const num = (v) => (Number.isFinite(v) ? v : 0);
  if (input.uniform) {
    if (secs.some((sc) => sc.d !== secs[0].d)) errors.push('A uniform shaft has one outer diameter.');
    (input.elements || []).forEach((e, i) => {
      if (!Number.isFinite(e.x) || e.x < -tol || e.x > L + tol) { errors.push(`Component ${i + 1} is not on the shaft.`); return; }
      const x = Math.min(L, Math.max(0, e.x));
      stations.push({ x, type: e.type, row: i, Fy: num(e.Fy), Fz: num(e.Fz), T: num(e.T), My: num(e.My), Mz: num(e.Mz), key: false });
    });
  } else {
    if (secs.length < 2) errors.push('A stepped shaft needs at least two sections. For a plain shaft choose Uniform diameter.');
    secs.forEach((sc, i) => { if (sc.t) errors.push(`Section ${i + 1}: a stepped shaft must be solid.`); });
    (input.shoulders || []).slice(0, secs.length - 1).forEach((sh, i) => {
      const type = sh?.type || 'none';
      if (type === 'none') return;
      const a = secs[i], b = secs[i + 1], name = `${COMPONENTS[type].label} at shoulder ${i + 1}`;
      if (a.d === b.d) { errors.push(`${name}: sections ${i + 1} and ${i + 2} have the same diameter, so there is no shoulder to seat it against.`); return; }
      const small = a.d < b.d ? i : i + 1, dir = small === i ? -1 : 1, width = num(sh.width);
      if (width < 0) { errors.push(`${name}: the width cannot be negative.`); return; }
      if (width > secs[small].L + tol) { errors.push(`${name}: it is wider than section ${small + 1}, which it sits on.`); return; }
      stations.push({ x: bounds[i + 1] + dir * width / 2, type, joint: i, sec: small, width,
        Fy: num(sh.Fy), Fz: num(sh.Fz), T: num(sh.T), My: num(sh.My), Mz: num(sh.Mz), key: !!sh.key && type !== 'bearing' });
    });
  }
  const bearings = stations.filter((st) => st.type === 'bearing').sort((a, b) => a.x - b.x);
  if (bearings.length !== 2) errors.push(`The shaft needs exactly two bearings; it has ${bearings.length}.`);
  else if (bearings[1].x - bearings[0].x <= tol) errors.push('The two bearings are at the same position.');
  const loads = stations.filter((st) => st.type !== 'bearing');
  const sumT = loads.reduce((a, p) => a + p.T, 0), maxT = Math.max(0, ...loads.map((p) => Math.abs(p.T)));
  if (Math.abs(sumT) > 1e-6 * maxT) errors.push('The torques on the shaft do not add up to zero. At steady speed the driving and driven torques cancel; check their values and signs.');
  if (errors.length) return { ok: false, errors };

  // --- reactions -------------------------------------------------------------
  const [A, B] = bearings, span = B.x - A.x;
  let sFy = 0, sFz = 0, mZ = 0, mY = 0;
  for (const p of loads) { sFy += p.Fy; sFz += p.Fz; mZ += (p.x - A.x) * p.Fy + p.Mz; mY += p.My - (p.x - A.x) * p.Fz; }
  const By = -mZ / span, Bz = mY / span;
  const acts = [...loads.map((p) => ({ x: p.x, Fy: p.Fy, Fz: p.Fz, T: p.T, My: p.My, Mz: p.Mz })),
    { x: A.x, Fy: -sFy - By, Fz: -sFz - Bz, T: 0, My: 0, Mz: 0 }, { x: B.x, Fy: By, Fz: Bz, T: 0, My: 0, Mz: 0 }];
  const reactions = [{ x: A.x, Fy: -sFy - By, Fz: -sFz - Bz }, { x: B.x, Fy: By, Fz: Bz }].map((r) => ({ ...r, radial: Math.hypot(r.Fy, r.Fz) }));

  /** Internal forces just left (side < 0) or right of x. */
  const internal = (x, side) => {
    let Vy = 0, Mz = 0, Vz = 0, My = 0, T = 0;
    for (const p of acts) {
      if (side < 0 ? p.x >= x - tol : p.x > x + tol) continue;
      Vy += p.Fy; Mz += p.Fy * (x - p.x) - p.Mz;
      Vz -= p.Fz; My -= p.Fz * (x - p.x) + p.My;
      T -= p.T;
    }
    return { Vy, Mz, Vz, My, T, Mtotal: Math.hypot(Mz, My) };
  };

  // --- nodes and segments ----------------------------------------------------
  const raw = [...bounds, ...stations.map((st) => st.x)].sort((a, b) => a - b);
  const nodes = [];
  for (const x of raw) if (!nodes.length || x - nodes[nodes.length - 1] > tol) nodes.push(x);
  nodes[0] = 0; nodes[nodes.length - 1] = L;
  const secAt = (x) => { let i = 0; while (i < secs.length - 1 && x > bounds[i + 1] + tol) i++; return i; };
  const secRight = (x) => { let i = 0; while (i < secs.length - 1 && x >= bounds[i + 1] - tol) i++; return i; };
  const E = mat.E > 0 ? mat.E : null, G = mat.G > 0 ? mat.G : null;
  const segs = [];
  for (let j = 0; j < nodes.length - 1; j++) {
    const a = nodes[j], h = nodes[j + 1] - a, sc = secs[secAt(a + h / 2)], I = tubeI(sc.d, sc.t);
    segs.push({ a, h, I, J: 2 * I, f: internal(a, 1) });
  }
  // Integrate curvature from x = 0 with zero start values, then add the rigid
  // motion that puts both bearings back on the axis.
  let th = { v: 0, w: 0 }, y = { v: 0, w: 0 }, phi = 0;
  for (const sg of segs) {
    const h = sg.h;
    sg.phi0 = phi;
    if (G) phi += sg.f.T * h / (G * sg.J);
    if (!E) continue;
    const EI = E * sg.I;
    sg.m = { v: [sg.f.Mz / EI, sg.f.Vy / EI], w: [-sg.f.My / EI, -sg.f.Vz / EI] };   // curvature = m0 + m1 s
    sg.th0 = { ...th }; sg.y0 = { ...y };
    for (const k of ['v', 'w']) {
      const [m0, m1] = sg.m[k];
      y[k] += th[k] * h + m0 * h * h / 2 + m1 * h ** 3 / 6;
      th[k] += m0 * h + m1 * h * h / 2;
    }
  }
  const segOf = (x, side) => {
    let j = 0;
    while (j < segs.length - 1 && (side < 0 ? x > nodes[j + 1] + tol : x >= nodes[j + 1] - tol)) j++;
    return j;
  };
  const rigid = { v: [0, 0], w: [0, 0] };
  /** Everything in segment j at a distance s from its left end. */
  const evalSeg = (j, s) => {
    const sg = segs[j], f = sg.f, x = sg.a + s;
    const out = { x, Vy: f.Vy, Mz: f.Mz + f.Vy * s, Vz: f.Vz, My: f.My + f.Vz * s, T: f.T };
    out.Mtotal = Math.hypot(out.Mz, out.My);
    out.twist = G ? sg.phi0 + f.T * s / (G * sg.J) : null;
    if (E) {
      for (const [k, slope] of [['v', 'slopeXY'], ['w', 'slopeXZ']]) {
        const [m0, m1] = sg.m[k];
        out[slope] = sg.th0[k] + m0 * s + m1 * s * s / 2 + rigid[k][1];
        out[k] = sg.y0[k] + sg.th0[k] * s + m0 * s * s / 2 + m1 * s ** 3 / 6 + rigid[k][0] + rigid[k][1] * x;
      }
      out.slope = Math.hypot(out.slopeXY, out.slopeXZ);
      out.deflection = Math.hypot(out.v, out.w);
    } else for (const k of ['v', 'w', 'slopeXY', 'slopeXZ', 'slope', 'deflection']) out[k] = null;
    return out;
  };
  /** Everything at x, just left (side < 0) or right of it. */
  const at = (x, side = 1) => { const j = segOf(x, side); return evalSeg(j, Math.min(segs[j].h, Math.max(0, x - segs[j].a))); };
  if (E) for (const k of ['v', 'w']) {
    const ya = at(A.x)[k], yb = at(B.x)[k], c1 = -(yb - ya) / span;
    rigid[k] = [-ya - c1 * A.x, c1];
  }

  // --- series for the diagrams ------------------------------------------------
  const KEYS = ['Vy', 'Mz', 'slopeXY', 'v', 'Vz', 'My', 'slopeXZ', 'w', 'Mtotal', 'T', 'twist', 'deflection'];
  const series = Object.fromEntries(KEYS.map((k) => [k, []]));
  const xs = [], total = opts.stations || 480;
  segs.forEach((sg, j) => {
    const m = Math.max(6, Math.ceil(total * sg.h / L)), list = [];
    for (let k = 0; k <= m; k++) list.push(sg.h * k / m);
    if (E) for (const k of ['v', 'w']) {          // where the slope is zero the deflection peaks
      const [m0, m1] = sg.m[k], c = sg.th0[k] + rigid[k][1];
      const roots = Math.abs(m1) < 1e-300 ? (Math.abs(m0) > 1e-300 ? [-c / m0] : []) : (() => {
        const disc = m0 * m0 - 2 * m1 * c;
        return disc < 0 ? [] : [(-m0 + Math.sqrt(disc)) / m1, (-m0 - Math.sqrt(disc)) / m1];
      })();
      for (const r of roots) if (r > 1e-9 * sg.h && r < sg.h * (1 - 1e-9)) list.push(r);
    }
    list.sort((a, b) => a - b);
    for (const s of list) {
      const e = evalSeg(j, s);
      xs.push(e.x);
      for (const k of KEYS) series[k].push(e[k]);
    }
  });
  for (const k of ['slopeXY', 'v', 'slopeXZ', 'w', 'deflection']) if (!E) series[k] = null;
  if (!G) series.twist = null;

  const extremes = {};
  for (const k of KEYS) {
    if (!series[k]) continue;
    let iMax = 0;
    series[k].forEach((v, i) => { if (Math.abs(v) > Math.abs(series[k][iMax])) iMax = i; });
    extremes[k] = { abs: Math.abs(series[k][iMax]), value: series[k][iMax], x: xs[iMax] };
  }
  const end = internal(L, 1);
  const scaleF = Math.max(1e-300, ...acts.map((p) => Math.hypot(p.Fy, p.Fz))), scaleM = Math.max(scaleF * L, ...acts.map((p) => Math.abs(p.T)), 1e-300);
  const checks = { V: Math.hypot(end.Vy, end.Vz) / scaleF, M: Math.hypot(end.Mz, end.My) / scaleM, T: Math.abs(end.T) / scaleM };

  // --- fatigue and first-cycle yield at every location -------------------------
  const Sut = mat.Sut > 0 ? mat.Sut : null, Sy = mat.Sy > 0 ? mat.Sy : null;
  const criterion = CRITERIA[input.criterion] ? input.criterion : 'goodman';
  const ke = input.ke > 0 ? input.ke : 1;
  const locations = [];
  // The larger moment and torque of the two sides of x. Round-off left over
  // where the diagrams return to zero is not a load.
  const peakM = Math.max(...nodes.map((x) => Math.max(at(x, -1).Mtotal, at(x, 1).Mtotal))), peakT = Math.max(...segs.map((sg) => Math.abs(sg.f.T)));
  const worst = (x) => {
    const l = at(x, -1), r = at(x, 1), M = Math.max(l.Mtotal, r.Mtotal), T = Math.max(Math.abs(l.T), Math.abs(r.T));
    return { M: M > 1e-9 * peakM ? M : 0, T: T > 1e-9 * peakT ? T : 0 };
  };
  const stationLabel = (st) => COMPONENTS[st.type].label;
  if (input.uniform) {
    const seen = [];
    const add = (x, label, kind) => {
      if (seen.some((v) => Math.abs(v - x) <= tol)) return;
      seen.push(x);
      const { M, T } = worst(x);
      // at a change of bore, take the weaker side
      const sc = [secs[secAt(x)], secs[secRight(x)]].sort((p, q) => tubeI(p.d, p.t) - tubeI(q.d, q.t))[0];
      locations.push({ x, label, kind, d: sc.d, t: sc.t || 0, M, T, Kt: 1, Kts: 1 });
    };
    for (const st of stations) add(st.x, stationLabel(st), st.type);
    for (let i = 1; i < secs.length; i++) if ((secs[i].t || 0) !== (secs[i - 1].t || 0)) add(bounds[i], 'Change of bore', 'bore');
  } else {
    for (let i = 0; i < secs.length - 1; i++) {
      const a = secs[i], b = secs[i + 1], sh = (input.shoulders || [])[i] || {}, type = sh.type || 'none';
      if (a.d === b.d) { notes.push(`Sections ${i + 1} and ${i + 2} have the same diameter, so there is no shoulder between them.`); continue; }
      const d = Math.min(a.d, b.d), D = Math.max(a.d, b.d), x = bounds[i + 1];
      const loc = { x, kind: 'shoulder', joint: i, d, D, t: 0, ...worst(x), flags: [],
        label: type === 'none' ? 'Shoulder' : `${COMPONENTS[type].label} shoulder` };
      if (type === 'none') {
        if (!(sh.r > 0)) { loc.error = 'Enter the fillet radius.'; warnings.push(`Shoulder ${i + 1}: enter the fillet radius to check it.`); locations.push(loc); continue; }
        loc.r = sh.r;
      } else { loc.r = COMPONENTS[type].rd * d; loc.rule = COMPONENTS[type].rd; }
      if (loc.r > (D - d) / 2 * (1 + 1e-9)) loc.flags.push('tall');
      const rd = loc.r / d, Dd = D / d;
      const bend = readChart('A-15-9', rd, Dd), tors = readChart('A-15-8', rd, Dd);
      const est = loc.rule === 0.02 ? TABLE_7_1.sharp : loc.rule === 0.1 ? TABLE_7_1.round : null;
      for (const [key, res, fig] of [['Kt', bend, 'A-15-9'], ['Kts', tors, 'A-15-8']]) {
        if (!res.error) { loc[key] = res.k; if (res.flags.includes('offtop')) loc.flags.push(`offtop ${fig}`); continue; }
        if (est) { loc[key] = est[key]; loc.flags.push(`estimate ${fig}`); } else loc.error = res.error;
      }
      if (loc.error) warnings.push(`Shoulder ${i + 1}: ${loc.error}`);
      locations.push(loc);
    }
    for (const st of loads) {
      const d = secs[st.sec].d, base = { x: st.x, d, t: 0, ...worst(st.x), flags: [] };
      if (st.key) locations.push({ ...base, kind: 'keyseat', label: `${stationLabel(st)} keyseat`, Kt: TABLE_7_1.keyseat.Kt, Kts: TABLE_7_1.keyseat.Kts, r: TABLE_7_1.keyseat.rd * d, rule: TABLE_7_1.keyseat.rd });
      else if (st.width > 0) locations.push({ ...base, kind: 'seat', label: `${stationLabel(st)} seat`, Kt: 1, Kts: 1 });
    }
    locations.sort((p, q) => p.x - q.x);
  }

  let fatigue = null;
  if (Sut) {
    const SePrime = enduranceLimitPrime(Sut, us), ka = surfaceFactor(input.finish, Sut, us);
    const sigF = input.sigF > 0 ? input.sigF : fatigueStrengthCoefficient(Sut, us);
    let clampQ = false, sizeOut = false;
    for (const loc of locations) {
      if (loc.error) continue;
      const I = tubeI(loc.d, loc.t), c = loc.d / 2;
      loc.sigma0 = loc.M * c / I; loc.tau0 = loc.T * c / (2 * I);
      if (loc.Kt > 1 || loc.Kts > 1) {
        const qb = notchSensitivity(loc.r, Sut, false, us), qt = notchSensitivity(loc.r, Sut, true, us);
        clampQ ||= qb.clamped || qt.clamped;
        loc.q = qb.q; loc.qs = qt.q;
        loc.Kf = 1 + qb.q * (loc.Kt - 1); loc.Kfs = 1 + qt.q * (loc.Kts - 1);
      } else { loc.q = loc.qs = null; loc.Kf = loc.Kfs = 1; }
      const size = sizeFactor(loc.d, us);
      sizeOut ||= !!size.out;
      loc.kb = size.kb;
      loc.Se = ka * size.kb * ke * SePrime;
      loc.sigA = loc.Kf * loc.sigma0;                    // Eq. 7-4 with Ta = 0
      loc.sigM = Math.sqrt(3) * loc.Kfs * loc.tau0;      // Eq. 7-5 with Mm = 0
      loc.sigMax = Math.hypot(loc.sigA, loc.sigM);       // Eq. 7-15
      loc.nAll = fatigueSafety({ sigA: loc.sigA, sigM: loc.sigM, Se: loc.Se, Sut, sigF });
      loc.n = loc.nAll[criterion];
      loc.ny = Sy ? (loc.sigMax > 0 ? Sy / loc.sigMax : Infinity) : null;
    }
    const usable = locations.filter((l) => !l.error && Number.isFinite(l.n));
    const critical = usable.length ? usable.reduce((a, b) => (b.n < a.n ? b : a)) : null;
    const yieldable = locations.filter((l) => !l.error && l.ny !== null && Number.isFinite(l.ny));
    const yieldCritical = yieldable.length ? yieldable.reduce((a, b) => (b.ny < a.ny ? b : a)) : null;
    if (critical) critical.critical = true;
    fatigue = { criterion, SePrime, ka, ke, sigF, critical, yieldCritical };
    if (clampQ) warnings.push('Sut is outside the range of the notch sensitivity fits (Eqs. 6-35 and 6-36); the nearest end of the range was used.');
    if (sizeOut) warnings.push('A diameter is outside the range of the size factor, Eq. 6-19 (0.3 to 10 in, 7.62 to 254 mm).');
    if (locations.some((l) => l.flags?.some((f) => f.startsWith('offtop')))) warnings.push('At a marked shoulder the curve for this D/d leaves the top of the chart, so the highest curve still on the chart was used. The true factor is higher.');
    if (locations.some((l) => l.flags?.some((f) => f.startsWith('estimate')))) warnings.push('At a marked shoulder the chart could not be read at this r/d, so the Table 7-1 estimate was used.');
    if (locations.some((l) => l.flags?.includes('tall'))) warnings.push('At a marked shoulder the fillet radius is larger than the step, (D − d)/2. Check the radius.');
    if (E && (E < 185e9 || E > 215e9)) warnings.push('The endurance limit, surface factor and notch sensitivity used here are for steels. Treat the fatigue factors with care for another material.');
  } else notes.push('Enter the ultimate strength Sut in Material to get the fatigue factors of safety.');
  if (Sut && !Sy) notes.push('Enter the yield strength Sy in Material to check first-cycle yielding.');
  if (!E) notes.push('Enter the modulus E in Material to get slopes and deflections.');
  if (!loads.some((p) => p.Fy || p.Fz || p.T || p.My || p.Mz)) notes.push('No loads are applied yet.');

  // Slopes and deflections where they matter: bearings and components (Table 7-2).
  const points = stations.slice().sort((a, b) => a.x - b.x).map((st) => {
    const e = at(st.x, 1);
    return { x: st.x, type: st.type, label: stationLabel(st), slopeXY: e.slopeXY, slopeXZ: e.slopeXZ, slope: e.slope, v: e.v, w: e.w, deflection: e.deflection };
  });

  return { ok: true, uniform: !!input.uniform, L, bounds, nodes, x: xs, ...series, extremes, reactions, stations, points, at, checks,
    locations, fatigue, warnings, notes };
}
