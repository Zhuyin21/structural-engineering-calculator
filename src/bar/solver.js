// Bar solver: a straight member along x carrying axial load only. The bar
// may be stepped (each segment has its own area and elastic modulus) and may
// be held at one end or at both (statically indeterminate).
//
//   E A u'' = -q(x)        N = E A u'       sigma = N / A       epsilon = sigma / E
//
// Sign conventions: forces positive along +x; N and sigma positive in
// tension; u positive along +x; a reaction is the force the wall applies to
// the bar. All quantities are SI.
//
// Method: stiffness method with a node at every step and load (exact for a
// stepped bar), then N by summing the loads to the left of the cut and u by
// integrating N / EA. Reference: Shigley, Secs. 3-9 and 4-3.
import { solveBar, evalBar, segmentLoad } from '../beam/solver.js';

/**
 * input = {
 *   segments:   [{ L, A, E }]          left to right; E may be null
 *   fixedLeft, fixedRight              booleans
 *   pointLoads: [{ x, Fx }]
 *   distLoads:  [{ x1, x2, w1, w2 }]   force per length, linear from w1 to w2
 * }
 * Returns { ok: false, errors } or { ok: true, x, N, sigma, strain, u,
 *   segments, reactions: { left, right }, elongation, extremes, at, checks, warnings }.
 */
export function solveBarModel(input) {
  const errors = [], warnings = [];
  const segsIn = input.segments || [];
  if (!segsIn.length) return { ok: false, errors: ['Add at least one segment.'] };
  segsIn.forEach((sg, i) => {
    if (!(sg.L > 0)) errors.push(`Segment ${i + 1}: enter a length greater than zero.`);
    if (!(sg.A > 0)) errors.push(`Segment ${i + 1}: enter a cross-section or an area.`);
  });
  if (errors.length) return { ok: false, errors };
  if (!input.fixedLeft && !input.fixedRight) return { ok: false, errors: ['Nothing holds the bar. Fix the left end, the right end, or both.'] };

  const bounds = [0];
  for (const sg of segsIn) bounds.push(bounds[bounds.length - 1] + sg.L);
  const L = bounds[bounds.length - 1], tol = 1e-9 * L;
  const inBar = (x) => Number.isFinite(x) && x >= -tol && x <= L + tol;
  const pointLoads = input.pointLoads || [], distLoads = input.distLoads || [];
  pointLoads.forEach((p, i) => { if (!inBar(p.x)) errors.push(`Point load ${i + 1} is not on the bar.`); });
  distLoads.forEach((q, i) => {
    if (!inBar(q.x1) || !inBar(q.x2)) errors.push(`Distributed load ${i + 1} extends past the bar.`);
    else if (!(q.x2 - q.x1 > tol)) errors.push(`Distributed load ${i + 1} must end after it starts.`);
  });
  const haveE = segsIn.every((sg) => sg.E > 0);
  if (!haveE && input.fixedLeft && input.fixedRight) {
    errors.push('The bar is held at both ends, so how the load splits depends on stiffness. Enter E for every segment.');
  }
  if (errors.length) return { ok: false, errors };
  if (!haveE) warnings.push('Strain and displacement not available: enter E (choose a material, or type E for each segment).');

  const clamp = (x) => Math.min(L, Math.max(0, x));
  const raw = [...bounds];
  pointLoads.forEach((p) => raw.push(clamp(p.x)));
  distLoads.forEach((q) => raw.push(clamp(q.x1), clamp(q.x2)));
  raw.sort((a, b) => a - b);
  const nodes = [];
  for (const x of raw) if (!nodes.length || x - nodes[nodes.length - 1] > tol) nodes.push(x);
  nodes[nodes.length - 1] = L;
  const n = nodes.length;
  const nodeOf = (x) => { let b = 0; for (let i = 1; i < n; i++) if (Math.abs(nodes[i] - x) < Math.abs(nodes[b] - x)) b = i; return b; };
  // Which input segment each piece between two nodes belongs to.
  const parent = [];
  for (let j = 0; j < n - 1; j++) {
    const mid = 0.5 * (nodes[j] + nodes[j + 1]);
    let k = 0;
    while (k < segsIn.length - 1 && mid > bounds[k + 1]) k++;
    parent.push(k);
  }

  const point = new Array(n).fill(0);
  for (const p of pointLoads) point[nodeOf(clamp(p.x))] += Number.isFinite(p.Fx) ? p.Fx : 0;
  const segLoads = nodes.slice(0, -1).map(() => []);
  for (const q of distLoads) {
    const load = { linear: true, x1: clamp(q.x1), x2: clamp(q.x2), w1: q.w1 || 0, w2: q.w2 || 0 };
    for (let j = nodeOf(load.x1); j < nodeOf(load.x2); j++) segLoads[j].push(segmentLoad(load, nodes[j]));
  }
  const fixed = new Array(n).fill(false);
  fixed[0] = !!input.fixedLeft; fixed[n - 1] = !!input.fixedRight;

  const r = solveBar({
    nodes, S: parent.map((k) => (haveE ? segsIn[k].E : 1) * segsIn[k].A),
    fixed, spring: new Array(n).fill(0), point, segLoads, label: 'The bar',
  });
  if (r.error) return { ok: false, errors: ['Nothing holds the bar. Fix the left end, the right end, or both.'] };

  const evalAt = (j, s) => {
    const e = evalBar(r.segs[j], s), sg = segsIn[parent[j]];
    const sigma = e.force / sg.A;
    return { N: e.force, sigma, strain: haveE ? sigma / sg.E : null, u: haveE ? e.disp : null };
  };
  /** Values at x; at a step or a load, `side` picks just left or just right. */
  function at(x, side = 'right') {
    const xc = clamp(x);
    let j = 0;
    while (j < n - 2 && xc > nodes[j + 1] + (side === 'left' ? tol : -tol)) j++;
    return { x: xc, ...evalAt(j, Math.min(Math.max(xc - nodes[j], 0), nodes[j + 1] - nodes[j])) };
  }

  const KEYS = ['N', 'sigma', 'strain', 'u'];
  const series = Object.fromEntries(KEYS.map((k) => [k, []])), xs = [];
  for (let j = 0; j < n - 1; j++) {
    const h = nodes[j + 1] - nodes[j], m = Math.max(4, Math.ceil(240 * h / L));
    for (let k = 0; k <= m; k++) {
      const e = evalAt(j, h * k / m);
      xs.push(nodes[j] + h * k / m);
      for (const key of KEYS) series[key].push(e[key]);
    }
  }
  if (!haveE) { series.strain = null; series.u = null; }

  const extremes = {};
  for (const k of KEYS) {
    const arr = series[k];
    if (!arr) { extremes[k] = null; continue; }
    let iMax = 0, iMin = 0;
    for (let i = 1; i < arr.length; i++) { if (arr[i] > arr[iMax]) iMax = i; if (arr[i] < arr[iMin]) iMin = i; }
    const iAbs = Math.abs(arr[iMax]) >= Math.abs(arr[iMin]) ? iMax : iMin;
    extremes[k] = { max: arr[iMax], xMax: xs[iMax], min: arr[iMin], xMin: xs[iMin], abs: Math.abs(arr[iAbs]), xAbs: xs[iAbs], atAbs: arr[iAbs] };
  }

  // Per-segment summary: forces at its two ends, the governing stress, and how much it stretches.
  const segments = segsIn.map((sg, k) => {
    const a = at(bounds[k], 'right'), b = at(bounds[k + 1], 'left');
    // Largest stress in the segment: its ends, both sides of every load inside it, and samples between.
    const cands = [a.sigma, b.sigma];
    for (const xn of nodes) if (xn > bounds[k] + tol && xn < bounds[k + 1] - tol) cands.push(at(xn, 'left').sigma, at(xn, 'right').sigma);
    for (let i = 1; i < 40; i++) cands.push(at(bounds[k] + (bounds[k + 1] - bounds[k]) * i / 40, 'left').sigma);
    const worst = cands.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
    return { x1: bounds[k], x2: bounds[k + 1], A: sg.A, E: sg.E ?? null, N1: a.N, N2: b.N, sigma: worst,
      strain: haveE ? worst / sg.E : null, elongation: haveE ? b.u - a.u : null };
  });

  return {
    ok: true, x: xs, ...series, nodes, bounds, length: L, segments,
    reactions: { left: input.fixedLeft ? r.R[0] : null, right: input.fixedRight ? r.R[n - 1] : null },
    elongation: haveE ? at(L, 'left').u - at(0).u : null,
    extremes, at, checks: { N: r.closure }, warnings,
  };
}
