// Plane views: a drawing of the beam, its supports and loads as seen in the
// XY plane (from the front, y up) or the XZ plane (from above, z down). Redrawn from the tables on every
// edit, so the student sees what they typed before solving. After a solve
// the reactions are added in a second colour.
import { s, clear } from '../ui/dom.js';
import { fmt, unitTable } from '../core/units.js';
import { compile } from '../core/expr.js';
import { parseNum, SUPPORT_TYPES } from './model.js';

const H = 250, Y0 = 104, MX = 46;

const PLANES = {
  // `up` is +1 when the transverse axis points up the page, -1 when it points down.
  xy: { axis: 'y', t: 'uy', r: 'rz', F: 'Fy', M: 'Mz', k: 'ky', dir: 'y', up: 1 },
  // The XZ plane is seen from above (looking along -y), so +z points down the
  // page. In both views a positive moment (right-hand rule) is counter-clockwise.
  xz: { axis: 'z', t: 'uz', r: 'ry', F: 'Fz', M: 'My', k: 'kz', dir: 'z', up: -1 },
};

function arrow(g, x1, y1, x2, y2, cls, heads = 1) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  g.append(s('line', { class: cls, x1, y1, x2: x2 - ux * 6, y2: y2 - uy * 6 }));
  for (let k = 0; k < heads; k++) {
    const tx = x2 - ux * 7 * k, ty = y2 - uy * 7 * k;
    g.append(s('polygon', { class: `${cls}-fill`,
      points: `${tx},${ty} ${tx - ux * 9 - uy * 4},${ty - uy * 9 + ux * 4} ${tx - ux * 9 + uy * 4},${ty - uy * 9 - ux * 4}` }));
  }
}

/** Curved arrow about (cx, cy); ccw is the sense as seen on screen. */
function curl(g, cx, cy, r, ccw, cls) {
  const a0 = ccw ? -40 : 220, a1 = ccw ? 220 : -40, pts = [];
  for (let k = 0; k <= 26; k++) {
    const a = (a0 + (a1 - a0) * k / 26) * Math.PI / 180;
    pts.push([cx + r * Math.cos(a), cy - r * Math.sin(a)]);
  }
  g.append(s('polyline', { class: cls, points: pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ') }));
  const [ex, ey] = pts[pts.length - 1], [bx, by] = pts[pts.length - 3];
  const len = Math.hypot(ex - bx, ey - by), ux = (ex - bx) / len, uy = (ey - by) / len;
  const tx = ex + ux * 4, ty = ey + uy * 4;
  g.append(s('polygon', { class: `${cls}-fill`,
    points: `${tx},${ty} ${tx - ux * 9 - uy * 4},${ty - uy * 9 + ux * 4} ${tx - ux * 9 + uy * 4},${ty - uy * 9 - ux * 4}` }));
}

function ground(g, x, y, half = 14) {
  g.append(s('line', { class: 'sup-line', x1: x - half, x2: x + half, y1: y, y2: y }));
  for (let hx = x - half + 2; hx <= x + half; hx += 6) g.append(s('line', { class: 'hatch', x1: hx, y1: y, x2: hx - 5, y2: y + 5 }));
}

/**
 * Draw one plane view into `host`.
 * `solved` is { result, units } when the results are current, otherwise null.
 */
export function drawPlane(host, model, plane, solved) {
  const cfg = PLANES[plane];
  const W = Math.max(320, Math.floor(host.clientWidth || 640));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img',
    'aria-label': `Beam drawn in the X${cfg.axis.toUpperCase()} plane with its supports and loads` });
  clear(host).append(svg);
  const u = unitTable(model.units);
  const L = parseNum(model.length);

  // axis triad
  if (cfg.up > 0) {
    arrow(svg, 16, 44, 16, 20, 'axis'); arrow(svg, 16, 44, 40, 44, 'axis');
    svg.append(s('text', { class: 't-dim', x: 22, y: 24, text: cfg.axis }), s('text', { class: 't-dim', x: 44, y: 48, text: 'x' }));
  } else {
    arrow(svg, 16, 20, 16, 44, 'axis'); arrow(svg, 16, 20, 40, 20, 'axis');
    svg.append(s('text', { class: 't-dim', x: 22, y: 46, text: cfg.axis }), s('text', { class: 't-dim', x: 44, y: 24, text: 'x' }));
  }

  if (!(L > 0)) {
    svg.append(s('text', { x: W / 2, y: Y0, 'text-anchor': 'middle', text: 'Enter a beam length to draw the beam.' }));
    return;
  }
  const px = (x) => MX + (x / L) * (W - 2 * MX);
  const on = (x) => x !== null && x >= 0 && x <= L * (1 + 1e-9);
  const ticks = [0, L];

  // --- distributed loads (behind everything else) ---------------------------
  const dists = [];
  for (const q of model.distLoads || []) {
    if (q.dir !== cfg.dir && !(plane === 'xy' && (q.dir === 'x' || q.dir === 't'))) continue;
    const x1 = parseNum(q.x1), x2 = parseNum(q.x2);
    if (!on(x1) || !on(x2) || !(x2 > x1)) continue;
    let f;
    if (q.profile === 'formula') {
      try { const c = compile(String(q.expr ?? '')); f = (x) => c({ x, L }); } catch { continue; }
    } else {
      const w1 = parseNum(q.w1); if (w1 === null) continue;
      const w2 = q.profile === 'linear' ? parseNum(q.w2) : w1; if (w2 === null) continue;
      f = (x) => w1 + (w2 - w1) * (x - x1) / (x2 - x1);
    }
    const n = 32, pts = [];
    const flip = q.dir === cfg.dir ? cfg.up : 1;       // values as they point on the page (positive = up)
    for (let k = 0; k <= n; k++) { const x = x1 + (x2 - x1) * k / n; const v = f(x) * flip; pts.push([x, Number.isFinite(v) ? v : 0]); }
    dists.push({ q, x1, x2, pts });
    ticks.push(x1, x2);
  }
  const wMax = Math.max(0, ...dists.filter((d) => d.q.dir === cfg.dir).flatMap((d) => d.pts.map((p) => Math.abs(p[1]))));
  for (const d of dists) {
    const a = px(d.x1), b = px(d.x2);
    if (d.q.dir !== cfg.dir) {            // axial or torque per length: a labelled bracket along the beam
      const y = Y0 - 12;
      svg.append(s('polyline', { class: 'ld', points: `${a},${y + 4} ${a},${y} ${b},${y} ${b},${y + 4}`, 'stroke-dasharray': '5 3' }));
      const kind = d.q.dir === 'x' ? 'axial' : 'torque';
      const val = d.q.profile === 'formula' ? 'w(x)' : fmt(d.pts[0][1], 4) + (d.q.profile === 'linear' ? ` to ${fmt(d.pts[d.pts.length - 1][1], 4)}` : '');
      svg.append(s('text', { x: (a + b) / 2, y: y - 5, 'text-anchor': 'middle', text: `${kind} ${val} ${d.q.dir === 'x' ? u.distForce.label : u.distMoment.label}` }));
      continue;
    }
    if (!(wMax > 0)) continue;
    // A load pointing down the page is drawn above the beam pushing down; one pointing up, below it.
    const yOf = (v) => (v < 0 ? Y0 - 5 - 32 * Math.abs(v) / wMax : v > 0 ? Y0 + 5 + 32 * v / wMax : null);
    for (const side of [-1, 1]) {
      const base = Y0 + side * 5;
      let dPath = '', any = false;
      d.pts.forEach(([x, v], i) => {
        const y = v * side > 0 ? yOf(v) : base;
        if (v * side > 0) any = true;
        dPath += `${i ? 'L' : 'M'}${px(x).toFixed(1)} ${y.toFixed(1)}`;
      });
      if (!any) continue;
      svg.append(s('path', { class: 'ld-area', d: `M${a} ${base}L${dPath.slice(1)}L${b} ${base}Z` }));
      const count = Math.max(2, Math.round((b - a) / 30));
      for (let k = 0; k <= count; k++) {
        const x = d.x1 + (d.x2 - d.x1) * k / count;
        const i = Math.round(k / count * (d.pts.length - 1)), v = d.pts[i][1];
        if (v * side > 0 && Math.abs(yOf(v) - base) > 11) arrow(svg, px(x), yOf(v), px(x), base, 'ld');
      }
    }
    const lab = (x, v, anchor) => {
      if (v === 0) return;
      svg.append(s('text', { x: px(x), y: v < 0 ? yOf(v) - 5 : yOf(v) + 13, 'text-anchor': anchor, text: `${fmt(Math.abs(v), 4)} ${u.distForce.label}` }));
    };
    const first = d.pts[0][1], last = d.pts[d.pts.length - 1][1];
    if (d.q.profile === 'formula') {
      const peak = d.pts.reduce((m, p) => (Math.abs(p[1]) > Math.abs(m[1]) ? p : m));
      if (peak[1] !== 0) svg.append(s('text', { x: px(peak[0]), y: peak[1] < 0 ? yOf(peak[1]) - 5 : yOf(peak[1]) + 13, 'text-anchor': 'middle',
        text: `w(x), peak ${fmt(Math.abs(peak[1]), 4)} ${u.distForce.label}` }));
    } else if (first === last) lab((d.x1 + d.x2) / 2, first, 'middle');
    else { lab(d.x1, first, 'start'); lab(d.x2, last, 'end'); }
  }

  // --- beam ------------------------------------------------------------------
  svg.append(s('rect', { class: 'beam', x: MX, y: Y0 - 5, width: W - 2 * MX, height: 10, rx: 1.5 }));

  // --- supports --------------------------------------------------------------
  for (const sp of model.supports || []) {
    const x = parseNum(sp.x);
    if (!on(x)) continue;
    ticks.push(x);
    const X = px(x);
    const type = SUPPORT_TYPES[sp.type] ? sp.type : 'pin';
    const holds = type === 'custom' ? (sp.holds || {}) : SUPPORT_TYPES[type].holds;
    const spring = type === 'spring' && (parseNum(sp[cfg.k]) || 0) > 0;
    const t = !!holds[cfg.t], r = !!holds[cfg.r];
    const g = s('g', {}, s('title', { text: `${SUPPORT_TYPES[type].label} at x = ${fmt(x)} ${u.length.label}` }));
    if (t && r) {
      const side = x <= L / 2 ? -1 : 1;
      g.append(s('line', { class: 'sup-line', x1: X, x2: X, y1: Y0 - 30, y2: Y0 + 30, 'stroke-width': 2.5 }));
      for (let y = Y0 - 28; y <= Y0 + 30; y += 7) g.append(s('line', { class: 'hatch', x1: X, y1: y, x2: X + side * 8, y2: y + 6 }));
    } else if (t) {
      g.append(s('polygon', { class: 'sup', points: `${X},${Y0 + 5} ${X - 10},${Y0 + 23} ${X + 10},${Y0 + 23}` }));
      if (holds.ux) ground(g, X, Y0 + 23);
      else {
        g.append(s('circle', { class: 'sup', cx: X - 5, cy: Y0 + 26.5, r: 3 }), s('circle', { class: 'sup', cx: X + 5, cy: Y0 + 26.5, r: 3 }));
        ground(g, X, Y0 + 30);
      }
    } else if (spring) {
      let pts = `${X},${Y0 + 5}`;
      for (let k = 0; k < 6; k++) pts += ` ${X + (k % 2 ? 6 : -6)},${Y0 + 8 + k * 3.6}`;
      pts += ` ${X},${Y0 + 29}`;
      g.append(s('polyline', { class: 'sup-line', points: pts }));
      ground(g, X, Y0 + 29);
    } else if (r) {
      g.append(s('rect', { class: 'sup', x: X - 5, y: Y0 - 10, width: 10, height: 20 }));
    } else {
      g.append(s('circle', { class: 'sup-off', cx: X, cy: Y0 + 13, r: 5 }),
        s('title', { text: 'This support does not act in this plane' }));
    }
    svg.append(g);
  }

  // --- point loads -----------------------------------------------------------
  const placed = [];
  const stagger = (X) => { const near = placed.filter((p) => Math.abs(p - X) < 58).length; placed.push(X); return near % 2 ? 16 : 0; };
  for (const p of model.pointLoads || []) {
    const x = parseNum(p.x);
    if (!on(x)) continue;
    ticks.push(x);
    const X = px(x), v = (parseNum(p[cfg.F]) || 0) * cfg.up;
    if (v !== 0) {
      const len = 40 + stagger(X);
      if (v < 0) { arrow(svg, X, Y0 - 5 - len, X, Y0 - 5, 'ld'); svg.append(s('text', { class: 't-strong', x: X, y: Y0 - 10 - len, 'text-anchor': 'middle', text: `${fmt(-v, 4)} ${u.force.label}` })); }
      else { arrow(svg, X, Y0 + 5 + len, X, Y0 + 5, 'ld'); svg.append(s('text', { class: 't-strong', x: X + 6, y: Y0 + 8 + len, text: `${fmt(v, 4)} ${u.force.label}` })); }
    }
    const fx = parseNum(p.Fx) || 0;
    if (plane === 'xy' && fx !== 0) {
      const tail = X - Math.sign(fx) * 38;
      arrow(svg, tail, Y0, X, Y0, 'ld');
      svg.append(s('text', { class: 't-strong', x: tail, y: Y0 - 9, 'text-anchor': fx > 0 ? 'start' : 'end', text: `${fmt(Math.abs(fx), 4)} ${u.force.label}` }));
    }
  }

  // --- moments and torque ------------------------------------------------------
  for (const m of model.moments || []) {
    const x = parseNum(m.x);
    if (!on(x)) continue;
    ticks.push(x);
    const X = px(x), v = parseNum(m[cfg.M]) || 0;
    if (v !== 0) {
      curl(svg, X, Y0, 17, v > 0, 'ld');
      svg.append(s('text', { class: 't-strong', x: X + 22, y: Y0 - 20, text: `${fmt(Math.abs(v), 4)} ${u.moment.label}` }));
    }
    const tq = parseNum(m.Mx) || 0;
    if (plane === 'xy' && tq !== 0) {
      // Torque is drawn on the beam axis as a double-headed vector (right-hand rule).
      const dir = Math.sign(tq), right = X < W - 150;
      arrow(svg, X - dir * 20, Y0, X + dir * 20, Y0, 'ld', 2);
      svg.append(s('text', { class: 't-strong', x: X + (right ? 8 : -8), y: Y0 - 11, 'text-anchor': right ? 'start' : 'end', text: `T ${fmt(Math.abs(tq), 4)} ${u.moment.label}` }));
    }
  }

  // --- reactions (only when results are current) -----------------------------
  if (solved) {
    for (const r of solved.result.reactions) {
      const X = px(r.x / u.length.f);
      const F = r[cfg.F] / u.force.f * cfg.up, Mv = r[cfg.M] / u.moment.f;
      const tiny = (v, ref) => Math.abs(v) < 1e-9 * ref;
      const fRef = Math.max(1e-12, ...solved.result.reactions.map((q) => Math.abs(q[cfg.F]) / u.force.f));
      let line = Y0 + 82;
      if (!tiny(F, fRef)) {
        if (F > 0) arrow(svg, X, Y0 + 68, X, Y0 + 38, 'rx'); else arrow(svg, X, Y0 + 38, X, Y0 + 68, 'rx');
        svg.append(s('text', { class: 't-strong', x: X, y: line, 'text-anchor': 'middle', text: `${fmt(Math.abs(F), 4)} ${u.force.label}` }));
        line += 13;
      }
      if (r.held[cfg.r] && Math.abs(Mv) > 1e-12) {
        const side = X < W / 2 ? 1 : -1;
        curl(svg, X, Y0, 24, Mv > 0, 'rx');
        svg.append(s('text', { class: 't-strong', x: X + side * 30, y: Y0 - 30, 'text-anchor': side > 0 ? 'start' : 'end', text: `${fmt(Math.abs(Mv), 4)} ${u.moment.label}` }));
      }
      if (plane === 'xy') {
        const Rx = r.Fx / u.force.f, Rt = r.Mx / u.moment.f;
        const anchor = X < 70 ? 'start' : X > W - 70 ? 'end' : 'middle';
        if (r.held.ux && Math.abs(Rx) > 1e-12) { svg.append(s('text', { x: X, y: line, 'text-anchor': anchor, text: `Rx ${fmt(Rx, 4)} ${u.force.label}` })); line += 13; }
        if (r.held.rx && Math.abs(Rt) > 1e-12) svg.append(s('text', { x: X, y: line, 'text-anchor': anchor, text: `T ${fmt(Rt, 4)} ${u.moment.label}` }));
      }
    }
  }

  // --- dimension line --------------------------------------------------------
  const yd = H - 26;
  svg.append(s('line', { class: 'dim', x1: MX, x2: W - MX, y1: yd, y2: yd }));
  const uniq = [...new Set(ticks.map((t) => +t.toPrecision(10)))].sort((a, b) => a - b);
  const labelled = [];
  const tryLabel = (t) => {
    const X = px(t);
    svg.append(s('line', { class: 'dim', x1: X, x2: X, y1: yd - 4, y2: yd + 4 }));
    if (labelled.some((q) => Math.abs(q - X) < 34)) return;
    labelled.push(X);
    svg.append(s('text', { class: 't-dim', x: X, y: yd + 16, 'text-anchor': 'middle', text: fmt(t, 4) }));
  };
  [0, L].forEach(tryLabel);
  uniq.filter((t) => t !== 0 && t !== +L.toPrecision(10)).forEach(tryLabel);
  svg.append(s('text', { class: 't-dim', x: W - MX + 8, y: yd + 4, text: u.length.label }));
}
