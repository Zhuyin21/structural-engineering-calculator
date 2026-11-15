// Stress concentration, following Shigley's Mechanical Engineering Design,
// 11th ed., Sec. 3-13 and the charts of Table A-15.
//
// The theoretical factors Kt (normal stress) and Kts (shear stress) are read
// from the book's own curves, which chartdata.js holds as numbers. Between
// two plotted curves the value is interpolated, as one does by eye.
//
//   sigma_max = Kt  sigma_0        tau_max = Kts tau_0
//
// where the nominal stress sigma_0 or tau_0 is defined on each chart (it is
// always based on the reduced section). All quantities SI.
import { CHARTS } from './chartdata.js';

const PI = Math.PI;

/** Value of one plotted curve at x, or null when x is off the curve. A small margin past either end is allowed and flagged. */
function onCurve(curve, x) {
  const xs = curve.x, ks = curve.k, n = xs.length;
  const span = xs[n - 1] - xs[0];
  const lowMargin = Math.max(0.15 * xs[0], 0.01 * span), highMargin = 0.03 * span;
  if (x < xs[0] - lowMargin || x > xs[n - 1] + highMargin) return null;
  if (x < xs[0]) return { k: ks[0] + (ks[1] - ks[0]) / (xs[1] - xs[0]) * (x - xs[0]), edge: true };
  if (x > xs[n - 1]) return { k: ks[n - 1] + (ks[n - 1] - ks[n - 2]) / (xs[n - 1] - xs[n - 2]) * (x - xs[n - 1]), edge: true };
  let i = 1;
  while (i < n - 1 && x > xs[i]) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return { k: ks[i - 1] + t * (ks[i] - ks[i - 1]), edge: false };
}

// How far apart two curves are for interpolation. For a size ratio p = D/d or
// w/d the factor grows roughly with log(p - 1); the curve at infinity is
// reached through 1 - 1/p. The d/h family of Figure A-15-2 runs from 0 to
// infinity and is mapped with p / (1 + p).
const INF = Infinity;
const pv = (p) => (p === 'inf' ? INF : p);

/**
 * Read a chart. Returns { k, flags } or { error }.
 *   name  'A-15-9' etc.
 *   x     the horizontal variable (r/d, or d/w for the hole charts)
 *   p     the curve label (D/d, w/d or d/h); ignored for a single-curve chart
 * flags: 'edge' (just past the end of a curve), 'above' (ratio beyond the
 * highest curve, which is used as is), 'offtop' (the next curve up is off the
 * top of the chart at this x), 'below' (ratio under the lowest curve,
 * extrapolated toward Kt = 1), 'sparse' (some curves do not reach this x).
 */
export function readChart(name, x, p) {
  const chart = CHARTS[name];
  if (!chart) return { error: `Unknown chart ${name}.` };
  const all = chart.curves.map((c) => ({ p: pv(c.p), hit: onCurve(c, x) })).sort((a, b) => a.p - b.p);
  const here = all.filter((c) => c.hit);
  const xMin = Math.min(...chart.curves.map((c) => c.x[0])), xMax = Math.max(...chart.curves.map((c) => c.x[c.x.length - 1]));
  if (!here.length) {
    return { error: `${chart.x} = ${x.toFixed(3)} is off Figure ${name}, which covers ${chart.x} from ${xMin.toFixed(3)} to ${xMax.toFixed(2)}.` };
  }
  const flags = new Set();
  if (here.some((c) => c.hit.edge)) flags.add('edge');
  if (chart.p === null) return { k: here[0].hit.k, flags: [...flags] };
  if (here.length < all.length) flags.add('sparse');

  const dh = chart.p === 'd/h';
  const lo = here[0], hi = here[here.length - 1];
  if (p >= hi.p) {
    // Past the highest curve that reaches this x. If a higher curve exists but has
    // already left the top of the chart here, say so: the true value is higher.
    if (p > hi.p) flags.add(all.some((c) => c.p > hi.p) ? 'offtop' : 'above');
    return { k: hi.hit.k, flags: [...flags], used: [hi.p] };
  }
  if (p <= lo.p) {
    if (p === lo.p || dh) return { k: lo.hit.k, flags: [...flags], used: [lo.p] };
    // Below the lowest curve: continue the trend of the two lowest curves in log(p - 1), never under 1.
    flags.add('below');
    if (here.length === 1) return { k: 1 + (lo.hit.k - 1) * (p - 1) / (lo.p - 1), flags: [...flags], used: [lo.p] };
    const nx = here[1], slope = (nx.hit.k - lo.hit.k) / (Math.log(nx.p - 1) - Math.log(lo.p - 1));
    return { k: Math.max(1, lo.hit.k + slope * (Math.log(p - 1) - Math.log(lo.p - 1))), flags: [...flags], used: [lo.p, nx.p] };
  }
  let i = 1;
  while (p > here[i].p) i++;
  const a = here[i - 1], b = here[i];
  const u = dh ? (v) => (v === INF ? 1 : v / (1 + v)) : b.p === INF ? (v) => (v === INF ? 1 : 1 - 1 / v) : (v) => Math.log(v - 1);
  const t = (u(p) - u(a.p)) / (u(b.p) - u(a.p));
  return { k: a.hit.k + t * (b.hit.k - a.hit.k), flags: [...flags], used: [a.p, b.p] };
}

/**
 * Points along the interpolated curve for one value of p, for drawing. Only
 * the stretch that is interpolated between the same printed curves as at
 * `xAt` is returned, so the line never jumps from one pair of curves to another.
 */
export function chartCurve(name, p, xAt, n = 120) {
  const chart = CHARTS[name];
  const xMin = Math.min(...chart.curves.map((c) => c.x[0])), xMax = Math.max(...chart.curves.map((c) => c.x[c.x.length - 1]));
  const key = (r) => (r.error ? null : (r.used ?? []).join(','));
  const want = key(readChart(name, xAt, p));
  if (want === null) return [];
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(xMin + (xMax - xMin) * (i / (n - 1)) ** 1.6);
  const runs = [[]];
  for (const x of xs) {
    const r = readChart(name, x, p);
    if (key(r) === want && !r.flags.includes('edge')) runs[runs.length - 1].push([x, r.k]);
    else if (runs[runs.length - 1].length) runs.push([]);
  }
  // the run that contains (or is nearest to) the point being read
  const dist = (run) => (run.length ? (xAt < run[0][0] ? run[0][0] - xAt : xAt > run[run.length - 1][0] ? xAt - run[run.length - 1][0] : 0) : Infinity);
  return runs.reduce((best, run) => (dist(run) < dist(best) ? run : best), []);
}

// ---------------------------------------------------------------------------
// The five geometries. For each load: the chart, the chart variables, and the
// nominal stress exactly as the chart's caption defines it.
// ---------------------------------------------------------------------------
const round = (d) => ({ A: PI * d * d / 4, Z: PI * d ** 3 / 32, Zp: PI * d ** 3 / 16 });

export const GEOMETRIES = {
  'bar-hole': {
    label: 'Rectangular bar with a hole',
    dims: [['w', 'Width w'], ['d', 'Hole diameter d'], ['t', 'Thickness t']],
    check: ({ w, d }) => (d >= w ? 'The hole is as wide as the bar.' : null),
    loads: {
      F: { figure: 'A-15-1', x: (g) => g.d / g.w, p: () => null, nominal: (g, F) => F / ((g.w - g.d) * g.t), formula: 'σ₀ = F / [(w − d) t]' },
      M: { figure: 'A-15-2', x: (g) => g.d / g.w, p: (g) => g.d / g.t, nominal: (g, M) => 6 * M / ((g.w - g.d) * g.t ** 2), formula: 'σ₀ = M c / I,  I = (w − d) t³ / 12,  c = t / 2', pName: 'd/t' },
    },
    note: 'The moment bends the bar about its width, through the thickness, as drawn in Figure A-15-2 (where the thickness is called h).',
  },
  'bar-notch': {
    label: 'Rectangular bar with notches',
    dims: [['w', 'Full width w'], ['d', 'Width between the notches d'], ['r', 'Notch radius r'], ['t', 'Thickness t']],
    check: ({ w, d }) => (d >= w ? 'The width between the notches must be less than the full width.' : null),
    loads: {
      F: { figure: 'A-15-3', x: (g) => g.r / g.d, p: (g) => g.w / g.d, nominal: (g, F) => F / (g.d * g.t), formula: 'σ₀ = F / (d t)' },
      M: { figure: 'A-15-4', x: (g) => g.r / g.d, p: (g) => g.w / g.d, nominal: (g, M) => 6 * M / (g.t * g.d ** 2), formula: 'σ₀ = M c / I,  I = t d³ / 12,  c = d / 2' },
    },
  },
  'bar-fillet': {
    label: 'Rectangular bar with a shoulder',
    dims: [['D', 'Larger width D'], ['d', 'Smaller width d'], ['r', 'Fillet radius r'], ['t', 'Thickness t']],
    check: ({ D, d, r }) => (d >= D ? 'The smaller width must be less than the larger width.' : r > (D - d) / 2 * (1 + 1e-9) ? 'The fillet radius is larger than the shoulder height (D − d) / 2.' : null),
    loads: {
      F: { figure: 'A-15-5', x: (g) => g.r / g.d, p: (g) => g.D / g.d, nominal: (g, F) => F / (g.d * g.t), formula: 'σ₀ = F / (d t)' },
      M: { figure: 'A-15-6', x: (g) => g.r / g.d, p: (g) => g.D / g.d, nominal: (g, M) => 6 * M / (g.t * g.d ** 2), formula: 'σ₀ = M c / I,  I = t d³ / 12,  c = d / 2' },
    },
  },
  'shaft-fillet': {
    label: 'Round shaft with a shoulder',
    dims: [['D', 'Larger diameter D'], ['d', 'Smaller diameter d'], ['r', 'Fillet radius r']],
    check: ({ D, d, r }) => (d >= D ? 'The smaller diameter must be less than the larger diameter.' : r > (D - d) / 2 * (1 + 1e-9) ? 'The fillet radius is larger than the shoulder height (D − d) / 2.' : null),
    loads: {
      F: { figure: 'A-15-7', x: (g) => g.r / g.d, p: (g) => g.D / g.d, nominal: (g, F) => F / round(g.d).A, formula: 'σ₀ = F / A,  A = π d² / 4' },
      M: { figure: 'A-15-9', x: (g) => g.r / g.d, p: (g) => g.D / g.d, nominal: (g, M) => M / round(g.d).Z, formula: 'σ₀ = M c / I = 32 M / (π d³)' },
      T: { figure: 'A-15-8', x: (g) => g.r / g.d, p: (g) => g.D / g.d, nominal: (g, T) => T / round(g.d).Zp, formula: 'τ₀ = T c / J = 16 T / (π d³)', shear: true },
    },
  },
  'shaft-groove': {
    label: 'Round shaft with a groove',
    dims: [['D', 'Shaft diameter D'], ['d', 'Diameter at the groove d'], ['r', 'Groove radius r']],
    check: ({ D, d }) => (d >= D ? 'The diameter at the groove must be less than the shaft diameter.' : null),
    loads: {
      F: { figure: 'A-15-13', x: (g) => g.r / g.d, p: (g) => g.D / g.d, nominal: (g, F) => F / round(g.d).A, formula: 'σ₀ = F / A,  A = π d² / 4' },
      M: { figure: 'A-15-14', x: (g) => g.r / g.d, p: (g) => g.D / g.d, nominal: (g, M) => M / round(g.d).Z, formula: 'σ₀ = M c / I = 32 M / (π d³)' },
      T: { figure: 'A-15-15', x: (g) => g.r / g.d, p: (g) => g.D / g.d, nominal: (g, T) => T / round(g.d).Zp, formula: 'τ₀ = T c / J = 16 T / (π d³)', shear: true },
    },
  },
};
export const LOAD_NAMES = { F: 'Axial force F', M: 'Bending moment M', T: 'Torque T' };

const FLAG_TEXT = {
  edge: 'just past the end of the plotted curve; the value continues its slope',
  above: 'the size ratio is beyond the highest curve on the chart, so that curve is used',
  below: 'the size ratio is under the lowest curve on the chart; the value is extrapolated toward Kt = 1',
  sparse: 'not every curve on the chart reaches this position, so the nearest ones that do are used',
  offtop: 'the next curve up has left the top of the chart here (Kt above 3), so the highest curve still on the chart is used; the true value is somewhat higher',
};

/**
 * input = { geometry, dims: { w, d, r, t, D ... } in metres, loads: { F, M, T } (missing = 0), Sy }
 * Returns { ok: false, errors } or
 *   { ok: true, cases: [{ load, figure, xName, x, pName, p, K, flags, nominal, peak, formula, shear }],
 *     sigmaMax, tauMax, vonMises, safety, notes }
 */
export function solveKt(input) {
  const geo = GEOMETRIES[input.geometry];
  if (!geo) return { ok: false, errors: ['Choose a geometry.'] };
  const g = input.dims || {}, errors = [], notes = [];
  for (const [k, label] of geo.dims) if (!(g[k] > 0)) errors.push(`Enter ${label[0].toLowerCase()}${label.slice(1)} as a positive number.`);
  if (errors.length) return { ok: false, errors };
  const bad = geo.check(g);
  if (bad) return { ok: false, errors: [bad] };

  const cases = [];
  for (const [load, def] of Object.entries(geo.loads)) {
    const chart = CHARTS[def.figure];
    const x = def.x(g), p = def.p(g);
    const r = readChart(def.figure, x, p);
    const value = Number.isFinite(input.loads?.[load]) ? input.loads[load] : 0;
    const nominal = def.nominal(g, value);
    const c = { load, figure: def.figure, xName: chart.x, x, pName: def.pName ?? chart.p, p, formula: def.formula, shear: !!def.shear, value, nominal };
    if (r.error) { c.K = null; c.error = r.error; c.peak = null; c.flags = []; } else {
      c.K = r.k; c.flags = r.flags; c.used = r.used ?? null; c.peak = r.k * nominal;
      for (const f of r.flags) notes.push(`Figure ${def.figure}: ${FLAG_TEXT[f]}.`);
    }
    cases.push(c);
  }
  // Combine at the root of the notch: axial and bending stresses add, shear comes from torsion.
  const loaded = cases.filter((c) => c.value !== 0);
  const missing = loaded.filter((c) => c.K === null);
  let sigmaMax = null, tauMax = null, vonMises = null, safety = null;
  if (!missing.length) {
    sigmaMax = cases.filter((c) => !c.shear && c.K !== null).reduce((s, c) => s + Math.abs(c.peak), 0);
    tauMax = cases.filter((c) => c.shear && c.K !== null).reduce((s, c) => s + Math.abs(c.peak), 0);
    vonMises = Math.sqrt(sigmaMax ** 2 + 3 * tauMax ** 2);
    if (input.Sy > 0 && vonMises > 0) safety = input.Sy / vonMises;
  }
  if (geo.note) notes.push(geo.note);
  return { ok: true, cases, sigmaMax, tauMax, vonMises, safety, notes: [...new Set(notes)] };
}
