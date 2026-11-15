// Cross-section library. All formulas take and return consistent units
// (give dimensions in metres, get m^2 and m^4). Axes: y is the "height"
// direction, z the "width" direction, x runs along the member.
//
//   Iz  resists bending in the XY plane (loads along y)
//   Iy  resists bending in the XZ plane (loads along z)
//   J   torsion constant (equals the polar moment only for round sections)
//   cy, cz  distance from the centroid to the extreme fibre in y and z

const PI = Math.PI;

export const SHAPES = {
  rect: {
    label: 'Rectangle',
    dims: [['b', 'Width b (along z)'], ['h', 'Height h (along y)']],
    defaults: { b: 0.1, h: 0.2 },
    props({ b, h }) {
      // Saint-Venant torsion constant of a solid rectangle (exact series).
      const long = Math.max(b, h), short = Math.min(b, h);
      let sum = 0;
      for (let n = 1; n <= 15; n += 2) sum += Math.tanh(n * PI * long / (2 * short)) / n ** 5;
      const J = long * short ** 3 * (1 / 3 - (64 / PI ** 5) * (short / long) * sum);
      return { A: b * h, Iz: b * h ** 3 / 12, Iy: h * b ** 3 / 12, J, cy: h / 2, cz: b / 2 };
    },
  },
  circle: {
    label: 'Solid circle',
    dims: [['d', 'Diameter d']],
    defaults: { d: 0.05 },
    props({ d }) {
      const I = PI * d ** 4 / 64;
      return { A: PI * d * d / 4, Iz: I, Iy: I, J: 2 * I, cy: d / 2, cz: d / 2, round: true };
    },
  },
  tube: {
    label: 'Round tube',
    dims: [['do', 'Outer diameter'], ['di', 'Inner diameter']],
    defaults: { do: 0.06, di: 0.05 },
    check: ({ do: D, di }) => (di >= D ? 'Inner diameter must be smaller than the outer diameter' : null),
    props({ do: D, di }) {
      const I = PI * (D ** 4 - di ** 4) / 64;
      return { A: PI * (D * D - di * di) / 4, Iz: I, Iy: I, J: 2 * I, cy: D / 2, cz: D / 2, round: true };
    },
  },
  ibeam: {
    label: 'I-beam',
    dims: [['h', 'Overall depth h (along y)'], ['bf', 'Flange width'], ['tf', 'Flange thickness'], ['tw', 'Web thickness']],
    defaults: { h: 0.3, bf: 0.15, tf: 0.0107, tw: 0.0071 },
    check: ({ h, bf, tf, tw }) => (2 * tf >= h ? 'Flanges are thicker than the section depth'
      : tw >= bf ? 'Web is thicker than the flange width' : null),
    props({ h, bf, tf, tw }) {
      const hw = h - 2 * tf;
      return {
        A: 2 * bf * tf + hw * tw,
        Iz: (bf * h ** 3 - (bf - tw) * hw ** 3) / 12,
        Iy: (2 * tf * bf ** 3 + hw * tw ** 3) / 12,
        J: (2 * bf * tf ** 3 + (h - tf) * tw ** 3) / 3,    // thin-walled open section
        cy: h / 2, cz: bf / 2,
      };
    },
  },
  box: {
    label: 'Rectangular tube',
    dims: [['b', 'Width b (along z)'], ['h', 'Height h (along y)'], ['t', 'Wall thickness']],
    defaults: { b: 0.1, h: 0.15, t: 0.006 },
    check: ({ b, h, t }) => (2 * t >= Math.min(b, h) ? 'Wall is too thick for this size' : null),
    props({ b, h, t }) {
      const bi = b - 2 * t, hi = h - 2 * t;
      return {
        A: b * h - bi * hi,
        Iz: (b * h ** 3 - bi * hi ** 3) / 12,
        Iy: (h * b ** 3 - hi * bi ** 3) / 12,
        J: 2 * t * (b - t) ** 2 * (h - t) ** 2 / (b + h - 2 * t),   // Bredt, uniform wall
        cy: h / 2, cz: b / 2,
      };
    },
  },
};

/** Properties of a library shape, or an error string. Dimensions in metres. */
export function sectionProps(shape, dims) {
  const def = SHAPES[shape];
  if (!def) return { error: `Unknown shape "${shape}"` };
  for (const [key, label] of def.dims) {
    if (!(dims[key] > 0)) return { error: `${label} must be a positive number` };
  }
  const bad = def.check ? def.check(dims) : null;
  if (bad) return { error: bad };
  return def.props(dims);
}

/**
 * Peak stresses for a doubly symmetric section under the internal forces at
 * one cross-section. Returns values in Pa (null where not applicable).
 *   sigma   largest normal stress magnitude from bending (both planes) + axial
 *   tauV    largest transverse shear stress (VQ/It at the neutral axis)
 *   tauT    torsional shear stress (round sections and closed tubes only)
 */
export function peakStress(shape, dims, p, { N = 0, Mz = 0, My = 0, Vy = 0, Vz = 0, T = 0 }) {
  if (!p || !(p.A > 0)) return null;
  const out = { sigma: null, tauVy: null, tauVz: null, tauT: null };
  const axial = N / p.A;
  if (p.round && p.Iz > 0) {
    // For a round section the two bending moments combine into one resultant.
    out.sigma = Math.abs(axial) + Math.hypot(Mz, My) * p.cy / p.Iz;
  } else if (p.Iz > 0 && p.Iy > 0 && p.cy > 0 && p.cz > 0) {
    // Corner fibres see both bending stresses at once.
    out.sigma = Math.abs(axial) + Math.abs(Mz) * p.cy / p.Iz + Math.abs(My) * p.cz / p.Iy;
  } else if (p.Iz > 0 && p.cy > 0 && My === 0) {
    out.sigma = Math.abs(axial) + Math.abs(Mz) * p.cy / p.Iz;
  }
  const aV = Math.abs(Vy), aZ = Math.abs(Vz), aT = Math.abs(T);
  if (shape === 'rect') {
    out.tauVy = 1.5 * aV / p.A; out.tauVz = 1.5 * aZ / p.A;
  } else if (shape === 'circle') {
    out.tauVy = 4 * aV / (3 * p.A); out.tauVz = 4 * aZ / (3 * p.A);
    out.tauT = aT * p.cy / p.J;
  } else if (shape === 'tube') {
    const ro = dims.do / 2, ri = dims.di / 2;
    const k = (4 / 3) * (ro * ro + ro * ri + ri * ri) / (ro * ro + ri * ri);
    out.tauVy = k * aV / p.A; out.tauVz = k * aZ / p.A;
    out.tauT = aT * ro / p.J;
  } else if (shape === 'ibeam') {
    const { h, bf, tf, tw } = dims;
    const Q = bf * tf * (h - tf) / 2 + tw * (h / 2 - tf) ** 2 / 2;
    out.tauVy = aV * Q / (p.Iz * tw);
    out.tauVz = 1.5 * aZ / (2 * bf * tf);          // flanges carry weak-axis shear
  } else if (shape === 'box') {
    const { b, h, t } = dims;
    const bi = b - 2 * t, hi = h - 2 * t;
    const Qy = (b * h * h - bi * hi * hi) / 8, Qz = (h * b * b - hi * bi * bi) / 8;
    out.tauVy = aV * Qy / (p.Iz * 2 * t);
    out.tauVz = aZ * Qz / (p.Iy * 2 * t);
    out.tauT = aT / (2 * (b - t) * (h - t) * t);   // Bredt
  }
  return out;
}
