// Diagram plots: one quantity along the beam, drawn as a thin line over a
// light wash, with the peaks labelled and a cursor shared across a group.
import { h, s, clear } from './dom.js';
import { fmt } from '../core/units.js';

const MARGIN = { l: 62, r: 16, t: 16, b: 24 };   // l is widened per group to fit the tick labels
const H = 164;

function niceStep(span, target) {
  const raw = span / target, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/**
 * Draw a group of plots that share an x axis and a hover cursor.
 * plots = [{ title, symbol, unit, y: number[], invert }]   x in display units.
 * `invert: true` draws positive values downward, for a quantity measured
 * along an axis that points down the page (z in the top view).
 */
export function renderPlotGroup(container, { x, xUnit, plots, marks = [] }) {
  clear(container);
  const width = Math.max(300, Math.floor(container.clientWidth || 640));
  const x0 = x[0], x1 = x[x.length - 1];
  // Left margin wide enough for the longest y tick label in the group.
  const longest = Math.max(1, ...plots.flatMap((p) => [Math.max(...p.y), Math.min(...p.y)].map((v) => fmt(v, 3).length)));
  const M = { ...MARGIN, l: Math.max(40, Math.round(longest * 6.8 + 16)) };
  const px = (v) => M.l + (v - x0) / (x1 - x0) * (width - M.l - M.r);
  const cursors = [];

  for (const p of plots) {
    let lo = 0, hi = 0, iMax = 0, iMin = 0;
    p.y.forEach((v, i) => { if (v > p.y[iMax]) iMax = i; if (v < p.y[iMin]) iMin = i; });
    hi = Math.max(0, p.y[iMax]); lo = Math.min(0, p.y[iMin]);
    const flat = hi - lo < 1e-300;
    if (flat) { hi = 1; lo = -1; }
    const Hh = flat ? 100 : H;                   // a quantity that is zero everywhere gets a short strip
    const pad = (hi - lo) * 0.2;
    const g = p.invert ? -1 : 1;                 // geometry sign: -1 puts positive values below zero
    const gHi = Math.max(g * hi, g * lo), gLo = Math.min(g * hi, g * lo);
    const top = gHi + (gHi > 0 ? pad : pad * 0.4), bot = gLo - (gLo < 0 ? pad : pad * 0.4);
    const py = (v) => M.t + (top - g * v) / (top - bot) * (Hh - M.t - M.b);

    const read = h('div', { class: 'plot-read' });
    const summary = flat ? 'zero everywhere'
      : `max ${fmt(p.y[iMax], 4)} at ${fmt(x[iMax], 4)} ${xUnit}  ·  min ${fmt(p.y[iMin], 4)} at ${fmt(x[iMin], 4)} ${xUnit}`;
    read.textContent = summary;

    const svg = s('svg', { viewBox: `0 0 ${width} ${Hh}`, height: Hh, role: 'img',
      'aria-label': `${p.title} along the beam. ${summary}` });
    // grid: zero line, the two extremes, and x ticks
    const yTicks = flat ? [0] : [...new Set([0, p.y[iMax], p.y[iMin]])];
    for (const v of yTicks) {
      svg.append(s('line', { class: v === 0 ? 'zero-line' : 'grid-line', x1: M.l, x2: width - M.r, y1: py(v), y2: py(v) }));
      svg.append(s('text', { x: M.l - 8, y: py(v) + 4, 'text-anchor': 'end', text: fmt(v, 3) }));
    }
    const step = niceStep(x1 - x0, Math.max(3, Math.floor(width / 110)));
    for (let k = Math.ceil(x0 / step); k * step <= x1 + 1e-9; k++) {
      const xv = k * step;
      svg.append(s('line', { class: 'grid-line', x1: px(xv), x2: px(xv), y1: Hh - M.b, y2: Hh - M.b + 4 }));
      svg.append(s('text', { class: 't-dim', x: px(xv), y: Hh - 6, 'text-anchor': 'middle', text: fmt(+xv.toPrecision(10), 4) }));
    }
    for (const xm of marks) svg.append(s('line', { class: 'sup-tick', x1: px(xm), x2: px(xm), y1: py(0) - 4, y2: py(0) + 4 }));

    if (!flat) {
      let d = '';
      for (let i = 0; i < x.length; i++) d += `${i ? 'L' : 'M'}${px(x[i]).toFixed(2)} ${py(p.y[i]).toFixed(2)}`;
      svg.append(s('path', { class: 'area', d: `M${px(x0)} ${py(0)}L${d.slice(1)}L${px(x1)} ${py(0)}Z` }));
      svg.append(s('path', { class: 'curve', d }));
      const labelPeak = (i, above) => {
        if (Math.abs(p.y[i]) < 1e-9 * Math.max(Math.abs(hi), Math.abs(lo))) return;
        const cx = px(x[i]), cy = py(p.y[i]);
        svg.append(s('circle', { class: 'peak', cx, cy, r: 4 }));
        const anchor = cx > width - 90 ? 'end' : cx < M.l + 50 ? 'start' : 'middle';
        const dx = anchor === 'end' ? -7 : anchor === 'start' ? 7 : 0;
        svg.append(s('text', { class: 't-strong', x: cx + dx, y: above ? cy - 8 : cy + 15, 'text-anchor': anchor, text: fmt(p.y[i], 4) }));
      };
      labelPeak(iMax, !p.invert);
      if (iMin !== iMax) labelPeak(iMin, !!p.invert);
    }

    const cLine = s('line', { class: 'cursor-line', y1: M.t - 4, y2: Hh - M.b, visibility: 'hidden' });
    const cDot = s('circle', { class: 'peak', r: 4, visibility: 'hidden' });
    svg.append(cLine, cDot);
    cursors.push((i) => {
      if (i === null) { cLine.setAttribute('visibility', 'hidden'); cDot.setAttribute('visibility', 'hidden'); read.textContent = summary; return; }
      const cx = px(x[i]);
      cLine.setAttribute('x1', cx); cLine.setAttribute('x2', cx); cLine.setAttribute('visibility', 'visible');
      cDot.setAttribute('cx', cx); cDot.setAttribute('cy', py(p.y[i])); cDot.setAttribute('visibility', flat ? 'hidden' : 'visible');
      read.textContent = `x = ${fmt(x[i], 4)} ${xUnit}   ${p.symbol} = ${fmt(p.y[i], 5)} ${p.unit}`;
    });

    const hit = s('rect', { x: M.l, y: 0, width: width - M.l - M.r, height: Hh, fill: 'transparent' });
    const move = (e) => {
      const box = svg.getBoundingClientRect();
      const xv = x0 + ((e.clientX - box.left) * (width / box.width) - M.l) / (width - M.l - M.r) * (x1 - x0);
      let a = 0, b = x.length - 1;
      while (b - a > 1) { const m = (a + b) >> 1; if (x[m] < xv) a = m; else b = m; }
      const i = Math.abs(x[a] - xv) <= Math.abs(x[b] - xv) ? a : b;
      cursors.forEach((c) => c(i));
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => cursors.forEach((c) => c(null)));
    svg.append(hit);

    container.append(h('div', { class: 'plot' },
      h('div', { class: 'plot-head' },
        h('h3', {}, p.title, h('span', { class: 'unit', text: `(${p.unit})` })), read),
      svg));
  }
}
