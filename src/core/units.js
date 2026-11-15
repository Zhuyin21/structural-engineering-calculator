// Units. Everything is stored and solved in SI base units (N, m, Pa, rad).
// The interface converts at the boundary using the factors below, so the
// student's choice of units can never leak into the mechanics.

const LBF = 4.4482216152605;      // N per lbf (exact by definition)
const INCH = 0.0254;              // m per inch (exact)

export const FORCE = { N: 1, kN: 1e3, lbf: LBF, kip: 1e3 * LBF };
export const LENGTH = { m: 1, mm: 1e-3, in: INCH, ft: 12 * INCH };
export const STRESS = {
  Pa: 1, kPa: 1e3, MPa: 1e6, GPa: 1e9,
  psi: LBF / (INCH * INCH), ksi: 1e3 * LBF / (INCH * INCH),
};
export const ANGLE = { rad: 1, deg: Math.PI / 180 };

/** What the student picks. `small` is the unit for section sizes and deflection. */
export const UNIT_CHOICES = {
  force: ['N', 'kN', 'lbf', 'kip'],
  length: ['m', 'mm', 'in', 'ft'],
  small: ['mm', 'm', 'in', 'ft'],
  stress: ['Pa', 'MPa', 'psi', 'ksi'],
  modulus: ['GPa', 'MPa', 'Pa', 'ksi', 'psi'],
  angle: ['rad', 'deg'],
};

export const DEFAULT_UNITS = {
  force: 'kN', length: 'm', small: 'mm', stress: 'MPa', modulus: 'GPa', angle: 'rad',
};

export const UNIT_PRESETS = {
  'kN, m': { force: 'kN', length: 'm', small: 'mm', stress: 'MPa', modulus: 'GPa', angle: 'rad' },
  'N, mm': { force: 'N', length: 'mm', small: 'mm', stress: 'MPa', modulus: 'GPa', angle: 'rad' },
  'lbf, in': { force: 'lbf', length: 'in', small: 'in', stress: 'psi', modulus: 'ksi', angle: 'rad' },
  'lbf, ft': { force: 'lbf', length: 'ft', small: 'in', stress: 'psi', modulus: 'ksi', angle: 'rad' },
  'kip, ft': { force: 'kip', length: 'ft', small: 'in', stress: 'ksi', modulus: 'ksi', angle: 'rad' },
};

const sup = (s, p) => s + ({ 2: '²', 4: '⁴' })[p];

/**
 * For a unit choice, the factor (multiply to get SI) and label of every kind
 * of quantity the calculators use.
 */
export function unitTable(u) {
  const F = FORCE[u.force], L = LENGTH[u.length], S = LENGTH[u.small];
  return {
    length:    { f: L,              label: u.length },
    force:     { f: F,              label: u.force },
    moment:    { f: F * L,          label: `${u.force}·${u.length}` },
    distForce: { f: F / L,          label: `${u.force}/${u.length}` },
    distMoment:{ f: F,              label: `${u.force}·${u.length}/${u.length}` },
    dim:       { f: S,              label: u.small },
    area:      { f: S * S,          label: sup(u.small, 2) },
    inertia:   { f: S ** 4,         label: sup(u.small, 4) },
    modulus:   { f: STRESS[u.modulus], label: u.modulus },
    stress:    { f: STRESS[u.stress],  label: u.stress },
    deflection:{ f: S,              label: u.small },
    angle:     { f: ANGLE[u.angle], label: u.angle },
    kTrans:    { f: F / S,          label: `${u.force}/${u.small}` },
    kRot:      { f: F * L,          label: `${u.force}·${u.length}/rad` },
    none:      { f: 1,              label: '' },
  };
}

export const toSI = (value, kind, u) => value * unitTable(u)[kind].f;
export const fromSI = (value, kind, u) => value / unitTable(u)[kind].f;
export const unitLabel = (kind, u) => unitTable(u)[kind].label;

/** Convert a displayed number from one unit choice to another. */
export function convert(value, kind, from, to) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(+value)) return value;
  const v = (+value) * unitTable(from)[kind].f / unitTable(to)[kind].f;
  return +v.toPrecision(12);
}

/**
 * Compact number formatting for tables and labels (about 5 significant
 * figures). Very large and very small values use engineering notation, with
 * the exponent a multiple of three: 79.99e6, 150e-9.
 */
export function fmt(v, sig = 5) {
  if (v === null || v === undefined || Number.isNaN(v)) return '\u2014';
  if (!Number.isFinite(v)) return v > 0 ? '\u221E' : '-\u221E';
  if (v === 0) return '0';
  const a = Math.abs(v);
  let text;
  if (a < 1e-4 || a >= 1e6) {
    let e3 = Math.floor(Math.log10(a) / 3) * 3;
    let m = +(v / 10 ** e3).toPrecision(sig);
    if (Math.abs(m) >= 1000) { m /= 1000; e3 += 3; }
    text = `${m}e${e3}`;
  } else text = (+v.toPrecision(sig)).toString();
  return text.replaceAll('-', '\u2212');
}
