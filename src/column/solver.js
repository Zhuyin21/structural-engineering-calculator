// Column buckling, following Shigley's Mechanical Engineering Design, 11th
// ed., Secs. 4-11 to 4-13. All quantities SI.
//
//   k = sqrt(I / A)                          radius of gyration
//   l / k                                    slenderness ratio
//   (l/k)1 = sqrt(2 pi^2 C E / Sy)           Eq. (4-45): where the two formulas meet
//   Euler,   l/k >  (l/k)1:   Pcr / A = C pi^2 E / (l/k)^2                  Eq. (4-44)
//   Johnson, l/k <= (l/k)1:   Pcr / A = Sy - (Sy l / (2 pi k))^2 / (C E)    Eq. (4-48)
//   Secant (eccentric load):  sigma_c = (P/A) [1 + (e c / k^2) sec((l / 2k) sqrt(P / (A E)))]   Eq. (4-53)
//
// C is the end-condition constant of Table 4-2.

/** Table 4-2: end-condition constants for Euler columns. */
export const END_CONDITIONS = {
  'fixed-free': { label: 'Fixed-free', theoretical: 0.25, conservative: 0.25, recommended: 0.25 },
  'rounded-rounded': { label: 'Rounded-rounded (pinned-pinned)', theoretical: 1, conservative: 1, recommended: 1 },
  'fixed-rounded': { label: 'Fixed-rounded (fixed-pinned)', theoretical: 2, conservative: 1, recommended: 1.2 },
  'fixed-fixed': { label: 'Fixed-fixed', theoretical: 4, conservative: 1, recommended: 1.2 },
};
export const C_SETS = { recommended: 'Recommended', theoretical: 'Theoretical', conservative: 'Conservative', custom: 'Custom' };

/** Slenderness where the Johnson parabola meets the Euler curve, Eq. (4-45). */
export const transitionSlenderness = (C, E, Sy) => Math.sqrt(2 * Math.PI ** 2 * C * E / Sy);

/**
 * Critical load for buckling about one axis.
 * Returns { k, slenderness, transition, regime, unitLoad, Pcr }.
 * Without Sy only Euler's formula can be applied, and `transition` is null.
 */
export function criticalLoad({ E, Sy, A, I, L, C }) {
  const k = Math.sqrt(I / A), sl = L / k;
  const euler = C * Math.PI ** 2 * E / (sl * sl);
  if (!(Sy > 0)) return { k, slenderness: sl, transition: null, regime: 'euler', unitLoad: euler, Pcr: euler * A };
  const transition = transitionSlenderness(C, E, Sy);
  if (sl > transition) return { k, slenderness: sl, transition, regime: 'euler', unitLoad: euler, Pcr: euler * A };
  const johnson = Sy - (Sy * sl / (2 * Math.PI)) ** 2 / (C * E);
  return { k, slenderness: sl, transition, regime: 'johnson', unitLoad: johnson, Pcr: johnson * A };
}

/** Critical unit load at an effective slenderness (l/k)/sqrt(C); used to draw the chart. */
export function unitLoadCurve(E, Sy, lambda) {
  const euler = Math.PI ** 2 * E / (lambda * lambda);
  if (!(Sy > 0)) return euler;
  return lambda > transitionSlenderness(1, E, Sy) ? euler : Sy - (Sy * lambda / (2 * Math.PI)) ** 2 / E;
}

/**
 * Largest compressive stress in an eccentrically loaded column, Eq. (4-53).
 * The formula is derived for rounded ends; other end conditions are handled
 * through the effective length l / sqrt(C). Returns Infinity at or beyond the
 * Euler load, where the secant term blows up.
 */
export function secantStress({ E, A, I, c, L, C, e, P }) {
  const k2 = I / A, lEff = L / Math.sqrt(C);
  const arg = (lEff / (2 * Math.sqrt(k2))) * Math.sqrt(P / (A * E));
  if (arg >= Math.PI / 2) return Infinity;
  return (P / A) * (1 + (e * c / k2) / Math.cos(arg));
}

/** The load at which the secant-formula stress reaches Sy (Eq. 4-54), by bisection. */
export function secantLoad({ E, Sy, A, I, c, L, C, e }) {
  const lEff = L / Math.sqrt(C);
  const euler = Math.PI ** 2 * E * I / (lEff * lEff);
  let lo = 0, hi = euler * (1 - 1e-12);
  if (secantStress({ E, A, I, c, L, C, e, P: hi }) < Sy) return hi;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (secantStress({ E, A, I, c, L, C, e, P: mid }) < Sy) lo = mid; else hi = mid;
    if (hi - lo <= 1e-13 * hi) break;
  }
  return 0.5 * (lo + hi);
}

/**
 * Solve a column.
 * input = { L, E, Sy, A, Iz, Iy, cy, cz, Cxy, Cxz, P, e, ePlane: 'xy' | 'xz' }
 *   XY plane: the column bends in XY, about z, so Iz and cy apply.
 *   XZ plane: bends about y, so Iy and cz apply.
 */
export function solveColumn(input) {
  const errors = [], warnings = [], notes = [];
  const pos = (v) => Number.isFinite(v) && v > 0;
  if (!pos(input.L)) errors.push('Enter a column length greater than zero.');
  if (!pos(input.E)) errors.push('Material: enter the elastic modulus E.');
  if (!pos(input.A)) errors.push('Section: the area A is needed.');
  if (!pos(input.Iz) && !pos(input.Iy)) errors.push('Section: enter a second moment of area (Iz, Iy or both).');
  for (const [name, C] of [['XY', input.Cxy], ['XZ', input.Cxz]]) if (!pos(C)) errors.push(`Enter an end-condition constant C for the ${name} plane.`);
  if (input.P !== null && input.P !== undefined && !(input.P >= 0)) errors.push('Enter the load as a positive compressive force.');
  if (errors.length) return { ok: false, errors };
  if (!pos(input.Sy)) warnings.push('No yield strength given, so Euler’s formula is used at every slenderness. Enter Sy to let short columns switch to the Johnson formula.');

  const planes = [];
  for (const [id, name, I, c, C] of [['xy', 'XY', input.Iz, input.cy, input.Cxy], ['xz', 'XZ', input.Iy, input.cz, input.Cxz]]) {
    if (!pos(I)) { notes.push(`Buckling in the ${name} plane was not checked: ${id === 'xy' ? 'Iz' : 'Iy'} is missing.`); continue; }
    planes.push({ id, name, I, c: pos(c) ? c : null, C, ...criticalLoad({ E: input.E, Sy: input.Sy, A: input.A, I, L: input.L, C }) });
  }
  const governing = planes.reduce((m, p) => (p.Pcr < m.Pcr ? p : m));
  const out = { ok: true, planes, governing, warnings, notes, squash: pos(input.Sy) ? input.Sy * input.A : null };
  for (const p of planes) {
    if (p.slenderness < 10) notes.push(`Slenderness in the ${p.name} plane is ${p.slenderness.toFixed(1)}. Members this short are compression blocks, not columns: they fail by yielding or crushing (Shigley, Sec. 4-15).`);
  }

  const P = pos(input.P) ? input.P : null;
  if (P) {
    out.P = P;
    out.directStress = P / input.A;
    out.safety = governing.Pcr / P;                     // n = Pcr / P
  }
  if (pos(input.e)) {
    const p = planes.find((q) => q.id === (input.ePlane || 'xy'));
    if (!p) notes.push('The eccentric load was not checked: that plane has no second moment of area.');
    else if (!p.c) notes.push('The eccentric load was not checked: the extreme-fibre distance for that plane is missing.');
    else if (!pos(input.Sy)) notes.push('The eccentric load was not checked: the secant formula needs the yield strength.');
    else {
      const args = { E: input.E, A: input.A, I: p.I, c: p.c, L: input.L, C: p.C, e: input.e };
      const Py = secantLoad({ ...args, Sy: input.Sy });
      out.secant = { plane: p, e: input.e, ecRatio: input.e * p.c / (p.I / input.A), yieldLoad: Py,
        stress: P ? secantStress({ ...args, P }) : null, safety: P ? Py / P : null };
    }
  }
  return out;
}
