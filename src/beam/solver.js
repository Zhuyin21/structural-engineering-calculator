// Beam solver: a straight, prismatic member along x with loads and supports
// in the XY and XZ planes, plus axial force and torque.
//
// Because the member is straight and y, z are principal axes of the section,
// the response splits into four independent problems:
//
//   axial    E A u''   = -q_x        unknown u      (bar)
//   torsion  G J phi'' = -t          unknown phi    (bar)
//   XY       E Iz v''''=  w_y        unknowns v, dv/dx   (beam)
//   XZ       E Iy w''''=  w_z        unknowns w, dw/dx   (beam)
//
// Each is solved in two steps:
//   1. Reactions. For bending, the method of initial parameters (Macaulay's
//      method): the unknowns are the deflection and slope at x = 0 and the
//      support reactions; the equations are the support conditions plus
//      force and moment balance. Axial and torsion use the stiffness method.
//   2. Internal forces are then built by walking along the beam from the left
//      end and summing everything to the left of the cut (the method of
//      sections), and slope and deflection by integrating M/EI along the
//      way. Nothing is interpolated, so the diagrams are exact for point,
//      uniform and linearly varying loads, and accurate to quadrature
//      precision for formula loads.
//
// As an independent check, each bending plane is also solved by the
// stiffness method (cubic beam elements, work-equivalent nodal loads) and
// the two sets of reactions are compared. See `checks.methods`.
//
// SIGN CONVENTIONS (see docs/sign-conventions.md)
//   Axes       right-handed: x along the beam, y up, z toward the viewer.
//   Views      XY from the front (y up the page); XZ from above (z DOWN the page).
//   Loads      positive along +x, +y, +z. Moments positive by the right-hand
//              rule about +x (torque), +y, +z; in both views that is
//              counter-clockwise on the page.
//   N          positive in tension.
//   T          positive when the torque vector on a +x cut face points along +x.
//   Vy, Vz     positive when the resultant of the forces to the left of the
//              cut points up the page: Vy = +sum(Fy), Vz = -sum(Fz).
//   Mz, My     positive when the beam sags on the page (XY: concave toward +y,
//              XZ: concave toward -z). Both equal the right-hand-rule component
//              of the internal moment on a +x cut face. Mz is the bending
//              moment in the XY plane; My in the XZ plane.
//   Slopes     dv/dx and dw/dx; deflections v, w along +y, +z.
//
// All quantities are SI (N, m, Pa, rad).

import { integrate, cauchyIntegrals, solveScaled, solveDense, bisect } from '../core/numeric.js';

const DOFS = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
const num = (v) => (Number.isFinite(v) ? v : 0);

/** A distributed load, restricted to one segment that it fully covers. */
export function segmentLoad(load, xa) {
  if (load.linear) {
    const m = (load.w2 - load.w1) / (load.x2 - load.x1);
    const wa = load.w1 + m * (xa - load.x1);
    return {
      w: (x) => wa + m * (x - xa),
      // closed-form repeated integrals of wa + m t
      I: (s) => [
        wa * s + m * s * s / 2,
        wa * s * s / 2 + m * s ** 3 / 6,
        wa * s ** 3 / 6 + m * s ** 4 / 24,
        wa * s ** 4 / 24 + m * s ** 5 / 120,
      ],
    };
  }
  return { w: load.w, I: (s) => cauchyIntegrals(load.w, xa, s) };
}

export function sumIntegrals(loads, s) {
  const I = [0, 0, 0, 0];
  for (const ld of loads) {
    const Ik = ld.I(s);
    I[0] += Ik[0]; I[1] += Ik[1]; I[2] += Ik[2]; I[3] += Ik[3];
  }
  return I;
}

// ---------------------------------------------------------------------------
// Bar problem (axial or torsion): one unknown per node. `S` is the stiffness
// EA or GJ: one number, or an array with a value for each segment (stepped bar).
// ---------------------------------------------------------------------------
export function solveBar({ nodes, S, fixed, spring, point, segLoads, label }) {
  const Sj = (j) => (Array.isArray(S) ? S[j] : S);
  const n = nodes.length;
  const K = Array.from({ length: n }, () => new Array(n).fill(0));
  const F = point.slice();
  for (let j = 0; j < n - 1; j++) {
    const h = nodes[j + 1] - nodes[j], k = Sj(j) / h;
    K[j][j] += k; K[j][j + 1] -= k; K[j + 1][j] -= k; K[j + 1][j + 1] += k;
    for (const ld of segLoads[j]) {
      F[j] += integrate((x) => ld.w(x) * (1 - (x - nodes[j]) / h), nodes[j], nodes[j + 1]);
      F[j + 1] += integrate((x) => ld.w(x) * ((x - nodes[j]) / h), nodes[j], nodes[j + 1]);
    }
  }
  for (let i = 0; i < n; i++) K[i][i] += spring[i];

  const notes = [];
  const isFixed = fixed.slice();
  if (!isFixed.some(Boolean) && !spring.some((k) => k > 0)) {
    // Nothing holds the member. That is acceptable only when the loads are
    // in balance (for example torque in = torque out on a shaft).
    const total = F.reduce((a, b) => a + b, 0);
    const scale = F.reduce((a, b) => a + Math.abs(b), 0);
    if (Math.abs(total) > 1e-9 * scale) return { error: 'unrestrained' };
    isFixed[0] = true;
    notes.push(`${label} is not restrained, but the loads balance. Displacement is measured relative to x = 0.`);
  }
  const free = [];
  for (let i = 0; i < n; i++) if (!isFixed[i]) free.push(i);
  const sol = solveScaled(free.map((r) => free.map((c) => K[r][c])), free.map((r) => F[r]));
  if (sol.singular) return { error: 'unrestrained' };
  const u = new Array(n).fill(0);
  free.forEach((r, k) => { u[r] = sol.x[k]; });

  // Reactions: R = K u - F at held nodes; a spring pushes back with -k u.
  const R = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (isFixed[i]) {
      let r = -F[i];
      for (let c = 0; c < n; c++) r += K[i][c] * u[c];
      R[i] = r;
    } else if (spring[i] > 0) R[i] = -spring[i] * u[i];
  }

  // Walk left to right: internal force = -(sum of everything to the left).
  const segs = [];
  let Nf = 0;
  for (let j = 0; j < n - 1; j++) {
    Nf -= point[j] + R[j];
    const h = nodes[j + 1] - nodes[j];
    segs.push({ xa: nodes[j], h, Na: Nf, ua: u[j], S: Sj(j), loads: segLoads[j] });
    Nf -= sumIntegrals(segLoads[j], h)[0];
  }
  Nf -= point[n - 1] + R[n - 1];
  return { u, R, segs, closure: Nf, notes };
}

export function evalBar(seg, s) {
  const I = sumIntegrals(seg.loads, s);
  return { force: seg.Na - I[0], disp: seg.ua + (seg.Na * s - I[1]) / seg.S };
}

// ---------------------------------------------------------------------------
// Beam problem (one bending plane), stiffness method. Used as the
// independent cross-check; exact, but loses precision when two nodes are
// extremely close together, so it is only compared when they are not.
// ---------------------------------------------------------------------------
function solveBending({ nodes, EI, fixedT, fixedR, springT, springR, P, C, segLoads }) {
  const n = nodes.length, nd = 2 * n;
  const K = Array.from({ length: nd }, () => new Array(nd).fill(0));
  const F = new Array(nd).fill(0);
  for (let i = 0; i < n; i++) { F[2 * i] = P[i]; F[2 * i + 1] = C[i]; }

  for (let j = 0; j < n - 1; j++) {
    const xa = nodes[j], h = nodes[j + 1] - xa, k = EI / h ** 3;
    const ke = [
      [12 * k, 6 * h * k, -12 * k, 6 * h * k],
      [6 * h * k, 4 * h * h * k, -6 * h * k, 2 * h * h * k],
      [-12 * k, -6 * h * k, 12 * k, -6 * h * k],
      [6 * h * k, 2 * h * h * k, -6 * h * k, 4 * h * h * k],
    ];
    const map = [2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 3];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) K[map[a]][map[b]] += ke[a][b];
    // Work-equivalent nodal loads: integral of (Hermite shape function) x load.
    const shape = [
      (t) => 1 - 3 * t * t + 2 * t ** 3,
      (t) => h * (t - 2 * t * t + t ** 3),
      (t) => 3 * t * t - 2 * t ** 3,
      (t) => h * (t ** 3 - t * t),
    ];
    for (const ld of segLoads[j]) {
      for (let a = 0; a < 4; a++) {
        F[map[a]] += integrate((x) => ld.w(x) * shape[a]((x - xa) / h), xa, xa + h);
      }
    }
  }
  const fixed = new Array(nd).fill(false), spring = new Array(nd).fill(0);
  for (let i = 0; i < n; i++) {
    fixed[2 * i] = fixedT[i]; fixed[2 * i + 1] = fixedR[i];
    spring[2 * i] = springT[i]; spring[2 * i + 1] = springR[i];
    K[2 * i][2 * i] += springT[i]; K[2 * i + 1][2 * i + 1] += springR[i];
  }
  const free = [];
  for (let i = 0; i < nd; i++) if (!fixed[i]) free.push(i);
  const sol = solveScaled(free.map((r) => free.map((c) => K[r][c])), free.map((r) => F[r]));
  if (sol.singular) return { error: 'unstable' };
  const d = new Array(nd).fill(0);
  free.forEach((r, k) => { d[r] = sol.x[k]; });

  const R = new Array(nd).fill(0);
  for (let i = 0; i < nd; i++) {
    if (fixed[i]) {
      let r = -F[i];
      for (let c = 0; c < nd; c++) r += K[i][c] * d[c];
      R[i] = r;
    } else if (spring[i] > 0) R[i] = -spring[i] * d[i];
  }

  // Walk left to right. V is the sum of transverse forces to the left of the
  // cut; a counter-clockwise couple (in this plane view) drops M by its value.
  const segs = [];
  let V = 0, M = 0;
  for (let j = 0; j < n - 1; j++) {
    V += P[j] + R[2 * j];
    M -= C[j] + R[2 * j + 1];
    const h = nodes[j + 1] - nodes[j];
    segs.push({ xa: nodes[j], h, Va: V, Ma: M, tha: d[2 * j + 1], va: d[2 * j], EI, loads: segLoads[j] });
    const I = sumIntegrals(segLoads[j], h);
    M += V * h + I[1];
    V += I[0];
  }
  V += P[n - 1] + R[2 * n - 2];
  M -= C[n - 1] + R[2 * n - 1];
  return { d, R, segs, closure: { V, M } };
}

/**
 * The same bending problem solved by the method of initial parameters
 * (Macaulay's method, as done by hand): the unknowns are the deflection and
 * slope at x = 0 and the support reactions, and the equations are the
 * support conditions plus force and moment balance. Unlike the stiffness
 * method it has no elements, so it stays accurate when two positions are
 * extremely close together (a load a hair's width from a support).
 */
function solveBendingDirect({ nodes, EI, fixedT, fixedR, springT, springR, P, C, segLoads }) {
  const n = nodes.length, len = nodes[n - 1] - nodes[0];
  // March along the beam from a given start state with given nodal forces/couples.
  const march = (v0, th0, Pn, Cn, keep) => {
    let V = 0, M = 0, th = th0, v = v0;
    const vN = new Array(n), thN = new Array(n), segs = [];
    for (let j = 0; j < n; j++) {
      vN[j] = v; thN[j] = th;
      V += Pn[j]; M -= Cn[j];
      if (j === n - 1) break;
      const h = nodes[j + 1] - nodes[j];
      if (keep) segs.push({ xa: nodes[j], h, Va: V, Ma: M, tha: th, va: v, EI, loads: segLoads[j] });
      const I = sumIntegrals(segLoads[j], h);
      v += th * h + (M * h * h / 2 + V * h ** 3 / 6 + I[3]) / EI;
      th += (M * h + V * h * h / 2 + I[2]) / EI;
      M += V * h + I[1];
      V += I[0];
    }
    return { vN, thN, V, M, segs };
  };
  const part = march(0, 0, P, C, false);          // applied loads only, starting flat

  // Unknowns, all scaled to a length: a = v(0), b = slope(0) * len,
  // r = R len^3 / EI for each force reaction, c = C len^2 / EI for each couple.
  const unknowns = [];
  for (let i = 0; i < n; i++) {
    if (fixedT[i] || springT[i] > 0) unknowns.push({ node: i, couple: false });
    if (fixedR[i] || springR[i] > 0) unknowns.push({ node: i, couple: true });
  }
  const m = unknowns.length + 2;
  const xi = nodes.map((x) => (x - nodes[0]) / len);
  const A = [], rhs = [];
  const deflRow = (sNode) => {                     // v at node sNode, in terms of the unknowns
    const row = new Array(m).fill(0);
    row[0] = 1; row[1] = xi[sNode];
    unknowns.forEach((q, k) => {
      const d = xi[sNode] - xi[q.node];
      if (d > 0) row[k + 2] = q.couple ? -d * d / 2 : d ** 3 / 6;
    });
    return row;
  };
  const slopeRow = (sNode) => {                    // slope * len at node sNode
    const row = new Array(m).fill(0);
    row[1] = 1;
    unknowns.forEach((q, k) => {
      const d = xi[sNode] - xi[q.node];
      if (d > 0) row[k + 2] = q.couple ? -d : d * d / 2;
    });
    return row;
  };
  unknowns.forEach((q, k) => {
    const i = q.node;
    if (!q.couple) {
      const row = deflRow(i), known = -part.vN[i];
      if (fixedT[i]) { A.push(row); rhs.push(known); } else {      // spring: R + k v = 0
        const kap = springT[i] * len ** 3 / EI, sc = Math.max(1, kap);
        const r2 = row.map((v) => v * kap / sc); r2[k + 2] += 1 / sc;
        A.push(r2); rhs.push(known * kap / sc);
      }
    } else {
      const row = slopeRow(i), known = -part.thN[i] * len;
      if (fixedR[i]) { A.push(row); rhs.push(known); } else {      // rotational spring: C + k theta = 0
        const kap = springR[i] * len / EI, sc = Math.max(1, kap);
        const r2 = row.map((v) => v * kap / sc); r2[k + 2] += 1 / sc;
        A.push(r2); rhs.push(known * kap / sc);
      }
    }
  });
  const force = new Array(m).fill(0), moment = new Array(m).fill(0);
  unknowns.forEach((q, k) => {
    if (q.couple) moment[k + 2] = -1; else { force[k + 2] = 1; moment[k + 2] = 1 - xi[q.node]; }
  });
  A.push(force); rhs.push(-part.V * len ** 3 / EI);
  A.push(moment); rhs.push(-part.M * len * len / EI);

  const sol = solveDense(A, rhs);
  if (sol.singular) return { error: 'unstable' };
  const x = sol.x;
  let R, full;
  // Solve, march, and polish: the free response (no supports) can be far
  // larger than the real deflection, so the first answer loses digits to
  // cancellation. Two rounds of iterative refinement on the same equations
  // recover them.
  for (let round = 0; ; round++) {
    R = new Array(2 * n).fill(0);
    const Ptot = P.slice(), Ctot = C.slice();
    unknowns.forEach((q, k) => {
      if (q.couple) { R[2 * q.node + 1] = x[k + 2] * EI / (len * len); Ctot[q.node] += R[2 * q.node + 1]; }
      else { R[2 * q.node] = x[k + 2] * EI / len ** 3; Ptot[q.node] += R[2 * q.node]; }
    });
    full = march(x[0], x[1] / len, Ptot, Ctot, true);
    if (round === 2) break;
    const res = unknowns.map((q, k) => {
      const i = q.node;
      if (!q.couple) {
        if (fixedT[i]) return -full.vN[i];
        const kap = springT[i] * len ** 3 / EI;
        return -(x[k + 2] + kap * full.vN[i]) / Math.max(1, kap);
      }
      if (fixedR[i]) return -full.thN[i] * len;
      const kap = springR[i] * len / EI;
      return -(x[k + 2] + kap * full.thN[i] * len) / Math.max(1, kap);
    });
    res.push(-full.V * len ** 3 / EI, -full.M * len * len / EI);
    const fix = solveDense(A, res);
    if (fix.singular) break;
    for (let k = 0; k < m; k++) x[k] += fix.x[k];
  }
  const d = new Array(2 * n);
  for (let i = 0; i < n; i++) { d[2 * i] = full.vN[i]; d[2 * i + 1] = full.thN[i]; }
  // How well the support conditions are met. The yardstick is the larger of
  // the real response and the free response (the beam with its supports
  // removed), since rounding error scales with the latter.
  const mids = full.segs.flatMap((sg) => [0.25, 0.5, 0.75].map((t) => evalBending(sg, sg.h * t)));
  const vBig = Math.max(...full.vN.map(Math.abs), ...part.vN.map(Math.abs), ...mids.map((e) => Math.abs(e.defl)), 1e-300);
  const thBig = Math.max(...full.thN.map(Math.abs), ...part.thN.map(Math.abs), ...mids.map((e) => Math.abs(e.slope)), 1e-300);
  let miss = 0;
  for (let i = 0; i < n; i++) {
    if (fixedT[i]) miss = Math.max(miss, Math.abs(full.vN[i]) / vBig);
    if (fixedR[i]) miss = Math.max(miss, Math.abs(full.thN[i]) / thBig);
  }
  return { d, R, segs: full.segs, closure: { V: full.V, M: full.M }, miss };
}

function evalBending(seg, s) {
  const I = sumIntegrals(seg.loads, s);
  const { Va, Ma, tha, va, EI } = seg;
  return {
    V: Va + I[0],
    M: Ma + Va * s + I[1],
    slope: tha + (Ma * s + Va * s * s / 2 + I[2]) / EI,
    defl: va + tha * s + (Ma * s * s / 2 + Va * s ** 3 / 6 + I[3]) / EI,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Solve a beam.
 *
 * input = {
 *   L,                                  beam length
 *   E, G, A, Iy, Iz, J,                 any may be missing (see below)
 *   supports:   [{ x, ux,uy,uz,rx,ry,rz (booleans), kux,kuy,kuz,krx,kry,krz (spring rates) }],
 *   pointLoads: [{ x, Fx, Fy, Fz }],
 *   moments:    [{ x, Mx, My, Mz }],     Mx is torque
 *   distLoads:  [{ x1, x2, dir: 'x'|'y'|'z'|'t', w1, w2 }  or  { x1, x2, dir, w: (x) => value }],
 * }
 *
 * Missing stiffness: reactions and force diagrams of a uniform beam on rigid
 * supports do not depend on E, I, A or J, so those are still returned and
 * the displacement arrays for that problem come back as null.
 *
 * Returns { ok: false, errors } or
 *   { ok: true, x, N, T, Vy, Mz, slopeXY, v, Vz, My, slopeXZ, w, u, twist,
 *     Mtotal, reactions, extremes, at(x, side), checks, warnings, notes, active }
 */
export function solveBeam(input, opts = {}) {
  const errors = [], warnings = [], notes = [];
  const L = input.L;
  if (!(L > 0)) return { ok: false, errors: ['Beam length must be greater than zero.'] };
  const tol = 1e-9 * L;
  const supports = input.supports || [], pointLoads = input.pointLoads || [];
  const moments = input.moments || [], distLoads = input.distLoads || [];

  const inBeam = (x) => Number.isFinite(x) && x >= -tol && x <= L + tol;
  supports.forEach((s, i) => { if (!inBeam(s.x)) errors.push(`Support ${i + 1} is not on the beam.`); });
  pointLoads.forEach((p, i) => { if (!inBeam(p.x)) errors.push(`Point load ${i + 1} is not on the beam.`); });
  moments.forEach((m, i) => { if (!inBeam(m.x)) errors.push(`Moment ${i + 1} is not on the beam.`); });
  distLoads.forEach((q, i) => {
    if (!inBeam(q.x1) || !inBeam(q.x2)) errors.push(`Distributed load ${i + 1} extends past the beam.`);
    else if (!(q.x2 - q.x1 > tol)) errors.push(`Distributed load ${i + 1} must end after it starts.`);
  });
  if (errors.length) return { ok: false, errors };

  // --- nodes at every event ------------------------------------------------
  const clamp = (x) => Math.min(L, Math.max(0, x));
  const raw = [0, L];
  supports.forEach((s) => raw.push(clamp(s.x)));
  pointLoads.forEach((p) => raw.push(clamp(p.x)));
  moments.forEach((m) => raw.push(clamp(m.x)));
  distLoads.forEach((q) => raw.push(clamp(q.x1), clamp(q.x2)));
  raw.sort((a, b) => a - b);
  const nodes = [];
  for (const x of raw) if (!nodes.length || x - nodes[nodes.length - 1] > tol) nodes.push(x);
  nodes[nodes.length - 1] = L;
  const n = nodes.length;
  let minGap = L;
  for (let i = 1; i < n; i++) minGap = Math.min(minGap, nodes[i] - nodes[i - 1]);
  const nodeOf = (x) => {
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(nodes[i] - x) < Math.abs(nodes[best] - x)) best = i;
    return best;
  };

  // --- gather nodal data ---------------------------------------------------
  const zeros = () => new Array(n).fill(0);
  const fixed = Object.fromEntries(DOFS.map((k) => [k, new Array(n).fill(false)]));
  const spring = Object.fromEntries(DOFS.map((k) => [k, zeros()]));
  const supportNodes = new Set();
  for (const s of supports) {
    const i = nodeOf(clamp(s.x));
    supportNodes.add(i);
    for (const k of DOFS) {
      if (s[k]) fixed[k][i] = true;
      const ks = num(s['k' + k]);
      if (ks < 0) errors.push('Spring stiffness cannot be negative.');
      spring[k][i] += Math.max(0, ks);
    }
  }
  const pt = { Fx: zeros(), Fy: zeros(), Fz: zeros(), Mx: zeros(), My: zeros(), Mz: zeros() };
  for (const p of pointLoads) {
    const i = nodeOf(clamp(p.x));
    pt.Fx[i] += num(p.Fx); pt.Fy[i] += num(p.Fy); pt.Fz[i] += num(p.Fz);
  }
  for (const m of moments) {
    const i = nodeOf(clamp(m.x));
    pt.Mx[i] += num(m.Mx); pt.My[i] += num(m.My); pt.Mz[i] += num(m.Mz);
  }

  // Distributed loads, split by direction and restricted to each segment.
  const segLoads = { x: [], y: [], z: [], t: [] };
  const hasDist = { x: false, y: false, z: false, t: false };
  for (const dir of Object.keys(segLoads)) for (let j = 0; j < n - 1; j++) segLoads[dir].push([]);
  distLoads.forEach((q, qi) => {
    if (!segLoads[q.dir]) { errors.push(`Distributed load ${qi + 1} has an unknown direction.`); return; }
    const linear = typeof q.w !== 'function';
    const load = linear
      ? { linear: true, x1: clamp(q.x1), x2: clamp(q.x2), w1: num(q.w1), w2: num(q.w2) }
      : { linear: false, w: q.w };
    if (!linear) {
      for (let k = 0; k <= 20; k++) {
        const val = q.w(q.x1 + (q.x2 - q.x1) * k / 20);
        if (!Number.isFinite(val)) {
          errors.push(`Distributed load ${qi + 1}: the formula does not give a number everywhere on its range.`);
          return;
        }
      }
    }
    const a = nodeOf(clamp(q.x1)), b = nodeOf(clamp(q.x2));
    for (let j = a; j < b; j++) segLoads[q.dir][j].push(segmentLoad(load, nodes[j]));
    if (!linear || load.w1 !== 0 || load.w2 !== 0) hasDist[q.dir] = true;
  });
  if (errors.length) return { ok: false, errors };

  // --- stiffness -----------------------------------------------------------
  const pos = (v) => Number.isFinite(v) && v > 0;
  const stiff = {
    axial: pos(input.E) && pos(input.A) ? input.E * input.A : null,
    torsion: pos(input.G) && pos(input.J) ? input.G * input.J : null,
    xy: pos(input.E) && pos(input.Iz) ? input.E * input.Iz : null,
    xz: pos(input.E) && pos(input.Iy) ? input.E * input.Iy : null,
  };
  const need = {
    axial: 'E and the area A', torsion: 'G and the torsion constant J',
    xy: 'E and Iz', xz: 'E and Iy',
  };
  const any = (arr) => arr.some((v) => v !== 0);
  const hasSpring = (keys) => keys.some((k) => spring[k].some((v) => v > 0));

  const results = {};
  const active = {};

  // --- axial and torsion ---------------------------------------------------
  const bars = [
    { id: 'axial', label: 'The beam along x', fix: 'ux', point: pt.Fx, dir: 'x',
      missing: 'There is an axial load, but nothing holds the beam along x. Add a pin or fixed support.' },
    { id: 'torsion', label: 'Twist', fix: 'rx', point: pt.Mx, dir: 't',
      missing: 'There is a torque, but nothing resists twist and the torques do not balance. Add a fixed support, or a custom support that holds rotation about x.' },
  ];
  for (const b of bars) {
    active[b.id] = any(b.point) || hasDist[b.dir];
    if (!active[b.id]) continue;
    if (stiff[b.id] === null && hasSpring([b.fix])) {
      errors.push(`A spring is used, so ${need[b.id]} are needed.`); continue;
    }
    const r = solveBar({
      nodes, S: stiff[b.id] ?? 1, fixed: fixed[b.fix], spring: spring[b.fix],
      point: b.point, segLoads: segLoads[b.dir], label: b.label,
    });
    if (r.error) { errors.push(b.missing); continue; }
    notes.push(...r.notes);
    results[b.id] = r;
  }

  // --- the two bending planes ----------------------------------------------
  const planes = [
    { id: 'xy', name: 'XY', axis: 'y', t: 'uy', r: 'rz', P: pt.Fy, C: pt.Mz, dir: 'y' },
    // This plane is solved with z as the transverse axis, in which a couple
    // about +y is clockwise; the shear and moment are then turned into the
    // top-view (z down) convention where they are read out, in evalSeg.
    { id: 'xz', name: 'XZ', axis: 'z', t: 'uz', r: 'ry', P: pt.Fz, C: pt.My.map((v) => -v), dir: 'z' },
  ];
  for (const pl of planes) {
    active[pl.id] = any(pl.P) || any(pl.C) || hasDist[pl.dir];
    if (!active[pl.id]) continue;
    if (stiff[pl.id] === null && hasSpring([pl.t, pl.r])) {
      errors.push(`A spring is used, so ${need[pl.id]} are needed.`); continue;
    }
    const problem = {
      nodes, EI: stiff[pl.id] ?? 1,
      fixedT: fixed[pl.t], fixedR: fixed[pl.r], springT: spring[pl.t], springR: spring[pl.r],
      P: pl.P, C: pl.C, segLoads: segLoads[pl.dir],
    };
    const r = solveBendingDirect(problem);
    if (!r.error && minGap >= 1e-3 * L) {
      // Second opinion from the stiffness method.
      const k = solveBending(problem);
      const big = Math.max(...r.R.map(Math.abs), ...pl.P.map(Math.abs), 1e-300);
      const bigM = Math.max(big * L, ...pl.C.map(Math.abs));
      r.methods = k.error ? 1 : Math.max(...r.R.map((v, i) => Math.abs(v - k.R[i]) / (i % 2 ? bigM : big)));
    }
    if (r.error) {
      const nT = fixed[pl.t].filter(Boolean).length + spring[pl.t].filter((k) => k > 0).length;
      const nR = fixed[pl.r].filter(Boolean).length + spring[pl.r].filter((k) => k > 0).length;
      if (nT === 0) errors.push(`Nothing holds the beam in the ${pl.axis} direction, but there are loads in the ${pl.name} plane. Add a support.`);
      else if (nT === 1 && nR === 0) errors.push(`In the ${pl.name} plane the beam can still rotate about its single support. Add a second support or use a fixed one.`);
      else errors.push(`The supports do not hold the beam in the ${pl.name} plane.`);
      continue;
    }
    results[pl.id] = r;
  }
  if (errors.length) return { ok: false, errors };

  for (const id of ['xy', 'xz', 'axial', 'torsion']) {
    if (active[id] && stiff[id] === null) {
      const what = { xy: 'XY deflection and slope', xz: 'XZ deflection and slope', axial: 'Axial displacement', torsion: 'Angle of twist' }[id];
      warnings.push(`${what} not available: enter ${need[id]}.`);
    }
  }

  // --- evaluate anywhere ---------------------------------------------------
  const haveDisp = (id) => active[id] && stiff[id] !== null;
  function evalSeg(j, s) {
    const out = { N: 0, T: 0, Vy: 0, Mz: 0, Vz: 0, My: 0, u: null, twist: null, v: null, slopeXY: null, w: null, slopeXZ: null };
    if (results.axial) { const e = evalBar(results.axial.segs[j], s); out.N = e.force; if (haveDisp('axial')) out.u = e.disp; }
    if (results.torsion) { const e = evalBar(results.torsion.segs[j], s); out.T = e.force; if (haveDisp('torsion')) out.twist = e.disp; }
    if (results.xy) { const e = evalBending(results.xy.segs[j], s); out.Vy = e.V; out.Mz = e.M; if (haveDisp('xy')) { out.v = e.defl; out.slopeXY = e.slope; } }
    if (results.xz) { const e = evalBending(results.xz.segs[j], s); out.Vz = -e.V || 0; out.My = -e.M || 0; if (haveDisp('xz')) { out.w = e.defl; out.slopeXZ = e.slope; } }
    for (const id of ['axial', 'torsion', 'xy', 'xz']) {
      if (!active[id] && stiff[id] !== null) {
        if (id === 'axial') out.u = 0; else if (id === 'torsion') out.twist = 0;
        else if (id === 'xy') { out.v = 0; out.slopeXY = 0; } else { out.w = 0; out.slopeXZ = 0; }
      }
    }
    out.Mtotal = Math.hypot(out.Mz, out.My);
    return out;
  }
  /** Values at position x. At a load or support, `side` picks just left or just right of it. */
  function at(x, side = 'right') {
    const xc = clamp(x);
    let j = 0;
    while (j < n - 2 && xc > nodes[j + 1] + (side === 'left' ? tol : -tol)) j++;
    if (side === 'left' && j > 0 && Math.abs(xc - nodes[j]) <= tol) j--;
    return { x: xc, ...evalSeg(j, Math.min(Math.max(xc - nodes[j], 0), nodes[j + 1] - nodes[j])) };
  }

  // --- stations for plotting -----------------------------------------------
  // Even spacing plus the exact positions where a shear or slope changes
  // sign, so that peak moments and peak deflections are captured exactly.
  const total = opts.stations || 480;
  const KEYS = ['N', 'T', 'Vy', 'Mz', 'Vz', 'My', 'Mtotal', 'u', 'twist', 'v', 'slopeXY', 'w', 'slopeXZ'];
  const series = Object.fromEntries(KEYS.map((k) => [k, []]));
  const xs = [];
  for (let j = 0; j < n - 1; j++) {
    const h = nodes[j + 1] - nodes[j];
    const m = Math.max(6, Math.ceil(total * h / L));
    const sList = [];
    for (let k = 0; k <= m; k++) sList.push(h * k / m);
    const extra = [];
    // d(Mtotal^2)/dx = 2 (Mz Vy + My Vz), so its zero is where the total moment peaks.
    const probes = [...['Vy', 'Vz', 'slopeXY', 'slopeXZ', 'N', 'T'].map((key) => (e) => e[key]), (e) => e.Mz * e.Vy + e.My * e.Vz];
    for (const probe of probes) {
      let prev = probe(evalSeg(j, 0));
      if (prev === null) continue;
      for (let k = 1; k <= m; k++) {
        const cur = probe(evalSeg(j, sList[k]));
        if (prev !== 0 && cur !== 0 && (prev < 0) !== (cur < 0)) {
          extra.push(bisect((s) => probe(evalSeg(j, s)), sList[k - 1], sList[k], prev));
        }
        prev = cur;
      }
    }
    const all = sList.concat(extra).sort((a, b) => a - b);
    for (const s of all) {
      const e = evalSeg(j, s);
      xs.push(nodes[j] + s);
      for (const k of KEYS) series[k].push(e[k]);
    }
  }
  for (const k of ['u', 'twist', 'v', 'slopeXY', 'w', 'slopeXZ']) if (series[k][0] === null) series[k] = null;

  // --- reactions (true vector components) ----------------------------------
  const reactions = [];
  for (const i of [...supportNodes].sort((a, b) => a - b)) {
    const held = Object.fromEntries(DOFS.map((k) => [k, fixed[k][i] || spring[k][i] > 0]));
    reactions.push({
      x: nodes[i], held,
      Fx: results.axial ? results.axial.R[i] : 0,
      Fy: results.xy ? results.xy.R[2 * i] : 0,
      Fz: results.xz ? results.xz.R[2 * i] : 0,
      Mx: results.torsion ? results.torsion.R[i] : 0,
      My: results.xz ? -results.xz.R[2 * i + 1] : 0,
      Mz: results.xy ? results.xy.R[2 * i + 1] : 0,
    });
  }

  // --- extremes ------------------------------------------------------------
  const extremes = {};
  for (const k of KEYS) {
    const arr = series[k];
    if (!arr) { extremes[k] = null; continue; }
    let iMax = 0, iMin = 0;
    for (let i = 1; i < arr.length; i++) { if (arr[i] > arr[iMax]) iMax = i; if (arr[i] < arr[iMin]) iMin = i; }
    const iAbs = Math.abs(arr[iMax]) >= Math.abs(arr[iMin]) ? iMax : iMin;
    extremes[k] = {
      max: arr[iMax], xMax: xs[iMax], min: arr[iMin], xMin: xs[iMin],
      abs: Math.abs(arr[iAbs]), xAbs: xs[iAbs], atAbs: arr[iAbs],
    };
  }

  // --- equilibrium check ---------------------------------------------------
  // After the last node every internal force must return to zero.
  const checks = {
    Vy: results.xy ? results.xy.closure.V : 0, Mz: results.xy ? results.xy.closure.M : 0,
    Vz: results.xz ? results.xz.closure.V : 0, My: results.xz ? results.xz.closure.M : 0,
    N: results.axial ? results.axial.closure : 0, T: results.torsion ? results.torsion.closure : 0,
    // Largest relative gap between the support conditions and the solution.
    supports: Math.max(results.xy?.miss ?? 0, results.xz?.miss ?? 0),
    // Largest relative difference between the two solution methods' reactions
    // (null when positions are too close together for the comparison to be fair).
    methods: [results.xy?.methods, results.xz?.methods].some((v) => v !== undefined)
      ? Math.max(results.xy?.methods ?? 0, results.xz?.methods ?? 0) : null,
  };

  return {
    ok: true, x: xs, ...series, nodes, reactions, extremes, at, checks, warnings, notes, active,
    available: Object.fromEntries(['xy', 'xz', 'axial', 'torsion'].map((id) => [id, stiff[id] !== null])),
  };
}
