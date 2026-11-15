// Small numerical toolbox shared by every calculator: Gauss-Legendre
// quadrature, repeated integrals of a load, a dense linear solver, and a
// bracketed root finder. No dependencies.

/** Gauss-Legendre nodes and weights on [-1, 1], found by Newton iteration. */
export function gaussLegendre(n) {
  const x = new Array(n), w = new Array(n);
  const m = (n + 1) >> 1;
  for (let i = 0; i < m; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5));
    let pp = 1;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2; p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const dz = p1 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  return { x, w };
}

const GL = gaussLegendre(12);
const PANELS = 3;

/** Integral of f over [a, b] (composite 12-point Gauss-Legendre). */
export function integrate(f, a, b, panels = PANELS) {
  if (b === a) return 0;
  const hp = (b - a) / panels;
  let sum = 0;
  for (let p = 0; p < panels; p++) {
    const mid = a + (p + 0.5) * hp, half = hp / 2;
    for (let i = 0; i < GL.x.length; i++) sum += GL.w[i] * f(mid + half * GL.x[i]);
  }
  return sum * hp / 2;
}

/**
 * Repeated integrals of a load w, starting from x = xa:
 *   I_k(s) = integral from 0 to s of  w(xa + t) (s - t)^k / k!  dt,   k = 0..3
 * (Cauchy's formula for repeated integration.) I_0 is the load resultant,
 * I_1 its moment about the cut, and I_2, I_3 feed slope and deflection.
 */
export function cauchyIntegrals(w, xa, s, panels = PANELS) {
  const I = [0, 0, 0, 0];
  if (s === 0) return I;
  const hp = s / panels;
  for (let p = 0; p < panels; p++) {
    const mid = (p + 0.5) * hp, half = hp / 2;
    for (let i = 0; i < GL.x.length; i++) {
      const t = mid + half * GL.x[i];
      const f = GL.w[i] * half * w(xa + t);
      const d = s - t;
      I[0] += f; I[1] += f * d; I[2] += f * d * d / 2; I[3] += f * d * d * d / 6;
    }
  }
  return I;
}

/**
 * Solve K u = F for a small dense symmetric system. The matrix is scaled by
 * its diagonal first, so translation and rotation unknowns are comparable
 * and a tiny pivot reliably means "mechanism" instead of "awkward units".
 * Returns { x, singular }.
 */
export function solveScaled(K, F, tol = 1e-10) {
  const n = F.length;
  if (n === 0) return { x: [], singular: false };
  const d = new Array(n);
  for (let i = 0; i < n; i++) {
    const kii = Math.abs(K[i][i]);
    if (!(kii > 0)) return { x: null, singular: true };
    d[i] = Math.sqrt(kii);
  }
  const A = K.map((row, i) => row.map((v, j) => v / (d[i] * d[j])));
  const b = F.map((v, i) => v / d[i]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < tol) return { x: null, singular: true };
    if (piv !== c) { [A[piv], A[c]] = [A[c], A[piv]]; [b[piv], b[c]] = [b[c], b[piv]]; }
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const y = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * y[k];
    y[r] = s / A[r][r];
  }
  return { x: y.map((v, i) => v / d[i]), singular: false };
}

/** Root of f in [a, b] by bisection; f(a) and f(b) must differ in sign. */
export function bisect(f, a, b, fa = f(a)) {
  let lo = a, hi = b, flo = fa;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (mid === lo || mid === hi) break;
    const fm = f(mid);
    if (fm === 0) return mid;
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return 0.5 * (lo + hi);
}
