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
const MAX_DEPTH = 48;

// Adaptive rule shared by the two integrators below. `panel(a, b)` returns the
// 12-point Gauss-Legendre estimate on [a, b] as an array (one entry per
// integral wanted). A panel is accepted when splitting it in two no longer
// changes the answer; otherwise each half is refined. Smooth loads are
// accepted at once, and a load with a jump or a kink (step(), abs(), min(),
// max()) is bisected down onto the jump, so it is integrated just as well.
function adaptive(panel, a, b, scale) {
  const refine = (lo, hi, whole, depth) => {
    const mid = 0.5 * (lo + hi);
    const left = panel(lo, mid), right = panel(mid, hi);
    let ok = depth >= MAX_DEPTH || mid === lo || mid === hi;
    if (!ok) {
      ok = true;
      for (let k = 0; k < whole.length; k++) {
        if (Math.abs(left[k] + right[k] - whole[k]) > 1e-13 * scale[k]) { ok = false; break; }
      }
    }
    if (ok) return left.map((v, k) => v + right[k]);
    const L = refine(lo, mid, left, depth + 1), R = refine(mid, hi, right, depth + 1);
    return L.map((v, k) => v + R[k]);
  };
  return refine(a, b, panel(a, b), 0);
}

/** Integral of f over [a, b], adaptive, accurate for smooth and piecewise-smooth f. */
export function integrate(f, a, b) {
  if (b === a) return 0;
  let big = 0;
  const panel = (lo, hi) => {
    const mid = 0.5 * (lo + hi), half = 0.5 * (hi - lo);
    let sum = 0;
    for (let i = 0; i < GL.x.length; i++) { const v = f(mid + half * GL.x[i]); sum += GL.w[i] * v; big = Math.max(big, Math.abs(v)); }
    return [sum * half];
  };
  const first = panel(a, b);
  const scale = [Math.max(big * Math.abs(b - a), Math.abs(first[0]), 1e-300)];
  return adaptive(panel, a, b, scale)[0];
}

/**
 * Repeated integrals of a load w, starting from x = xa:
 *   I_k(s) = integral from 0 to s of  w(xa + t) (s - t)^k / k!  dt,   k = 0..3
 * (Cauchy's formula for repeated integration.) I_0 is the load resultant,
 * I_1 its moment about the cut, and I_2, I_3 feed slope and deflection.
 */
export function cauchyIntegrals(w, xa, s) {
  if (s === 0) return [0, 0, 0, 0];
  let big = 0;
  const panel = (lo, hi) => {
    const mid = 0.5 * (lo + hi), half = 0.5 * (hi - lo);
    const I = [0, 0, 0, 0];
    for (let i = 0; i < GL.x.length; i++) {
      const t = mid + half * GL.x[i];
      const v = w(xa + t);
      big = Math.max(big, Math.abs(v));
      const f = GL.w[i] * half * v, d = s - t;
      I[0] += f; I[1] += f * d; I[2] += f * d * d / 2; I[3] += f * d * d * d / 6;
    }
    return I;
  };
  panel(0, s);
  const base = Math.max(big, 1e-300) * s;
  const scale = [base, base * s, base * s * s / 2, base * s ** 3 / 6];
  return adaptive(panel, 0, s, scale);
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

/**
 * Solve A x = b for a small dense general (not necessarily symmetric)
 * system: rows are scaled to unit size, then Gaussian elimination with
 * partial pivoting. Returns { x, singular }.
 */
export function solveDense(A0, b0, tol = 1e-11) {
  const n = b0.length;
  if (n === 0) return { x: [], singular: false };
  const A = A0.map((row) => row.slice()), b = b0.slice();
  for (let r = 0; r < n; r++) {
    const m = Math.max(...A[r].map(Math.abs));
    if (!(m > 0)) return { x: null, singular: true };
    for (let c = 0; c < n; c++) A[r][c] /= m;
    b[r] /= m;
  }
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
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let k = r + 1; k < n; k++) sum -= A[r][k] * x[k];
    x[r] = sum / A[r][r];
  }
  return { x, singular: false };
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
