// Stress concentration page: pick one of five geometries, enter its
// dimensions and any of the loads F, M, T, and read Kt and Kts from
// Shigley's charts (Table A-15), with the nominal and peak stresses.
import { h, s, clear } from '../ui/dom.js';
import { pick, th } from '../ui/tables.js';
import { UNIT_CHOICES, DEFAULT_UNITS, UNIT_PRESETS, unitTable, fmt, convert } from '../core/units.js';
import { parseNum, materialSummary, materialSI, defaultMaterial, convertMaterial } from '../core/inputs.js';
import { openMaterialDialog, openUnitsDialog, parseSaved, fileSlug, showMessages } from '../ui/dialogs.js';
import { CHARTS } from './chartdata.js';
import { solveKt, chartCurve, GEOMETRIES, LOAD_NAMES } from './solver.js';

const STORE_KEY = 'sec.kt.model.v1';
const $ = (id) => document.getElementById(id);
const SI = UNIT_PRESETS['kN, m'], US = UNIT_PRESETS['lbf, in'];
const LOAD_KIND = { F: 'force', M: 'moment', T: 'moment' };

export function emptyKt(units = DEFAULT_UNITS) {
  return { version: 1, kind: 'kt', title: 'Untitled', units: { ...units }, geometry: 'shaft-fillet', dims: {}, loads: { F: '', M: '', T: '' }, material: defaultMaterial(units) };
}
const ex = (units, title, geometry, dims, loads) => ({ ...emptyKt(units), title, geometry, dims, loads: { F: '', M: '', T: '', ...loads }, material: defaultMaterial(units) });
export const KT_EXAMPLES = [
  ex(SI, 'Bar with a hole in tension (Shigley Ex. 3-13)', 'bar-hole', { w: 40, d: 4, t: 2 }, { F: 10 }),
  ex(SI, 'Bar with a shoulder in tension (Shigley Ex. 3-13)', 'bar-fillet', { D: 40, d: 34, r: 1, t: 2 }, { F: 10 }),
  ex(SI, 'Notched bar, tension and bending', 'bar-notch', { w: 60, d: 50, r: 5, t: 10 }, { F: 20, M: 0.15 }),
  ex(SI, 'Shaft shoulder in bending (Shigley Ex. 6-6)', 'shaft-fillet', { D: 38, d: 32, r: 3 }, { M: 0.1 }),
  ex(US, 'Shaft shoulder, bending and torque (Shigley Ex. 7-1)', 'shaft-fillet', { D: 1.65, d: 1.1, r: 0.11 }, { M: 1260, T: 1100 }),
  ex(SI, 'Grooved shaft with all three loads', 'shaft-groove', { D: 30, d: 25, r: 2.5 }, { F: 5, M: 0.06, T: 0.08 }),
];

let model = loadSaved() ?? structuredClone(KT_EXAMPLES[3]);
let solved = null, stale = true;
const U = () => unitTable(model.units);

function normalize(m) {
  const base = emptyKt();
  const out = { ...base, ...m, kind: 'kt' };
  out.units = { ...base.units, ...(m.units || {}) };
  for (const [k, list] of Object.entries(UNIT_CHOICES)) if (!list.includes(out.units[k])) out.units[k] = DEFAULT_UNITS[k];
  if (!GEOMETRIES[out.geometry]) out.geometry = base.geometry;
  out.dims = { ...(m.dims || {}) }; out.loads = { ...base.loads, ...(m.loads || {}) };
  out.material = { ...base.material, ...(m.material || {}) };
  return out;
}
function loadSaved() {
  try { const m = JSON.parse(localStorage.getItem(STORE_KEY)); return m && m.version === 1 ? normalize(m) : null; } catch { return null; }
}
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(model)); } catch { /* optional */ } };
function touch() {
  stale = true; save();
  $('kt-results').classList.toggle('stale', !!solved);
  clear($('kt-messages'));
  drawView();
}

/** Model in SI for the solver. */
export function ktInput(m) {
  const t = unitTable(m.units), geo = GEOMETRIES[m.geometry], errors = [];
  const mat = materialSI(m.units, m.material);
  const dims = {};
  for (const [k] of geo.dims) { const v = parseNum(m.dims[k]); dims[k] = v === null ? null : v * t.dim.f; }
  const loads = {};
  for (const k of Object.keys(geo.loads)) {
    const raw = m.loads[k];
    if (raw !== '' && raw !== undefined && raw !== null && parseNum(raw) === null) errors.push(`${LOAD_NAMES[k]}: enter a number, or leave it blank for zero.`);
    loads[k] = (parseNum(raw) ?? 0) * t[LOAD_KIND[k]].f;
  }
  return { input: { geometry: m.geometry, dims, loads, Sy: mat.Sy }, errors };
}

// ---------------------------------------------------------------------------
function field(id, obj, key, label, unit) {
  const inp = h('input', { id, class: 'num-in', type: 'text', inputMode: 'decimal', value: obj[key] ?? '', style: 'width: 100%' });
  inp.addEventListener('input', () => { obj[key] = inp.value.trim(); inp.classList.toggle('bad', inp.value.trim() !== '' && parseNum(inp.value) === null); touch(); });
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), h('div', { class: 'with-unit' }, inp, h('span', { class: 'unit', text: unit })));
}

function renderSetup() {
  const title = h('input', { id: 'kt-title', type: 'text', value: model.title ?? '', style: 'width: 15em', onInput: () => { model.title = title.value; save(); } });
  const geo = h('select', { id: 'kt-geometry' }, Object.entries(GEOMETRIES).map(([k, v]) => h('option', { value: k, text: v.label, selected: model.geometry === k })));
  geo.addEventListener('change', () => { model.geometry = geo.value; touch(); renderInputs(); });
  clear($('kt-setup')).append(
    h('div', { class: 'field' }, h('label', { for: 'kt-title', text: 'Name' }), title),
    h('div', { class: 'field' }, h('label', { for: 'kt-geometry', text: 'Geometry' }), geo),
    pick('kt-pick-material', 'Material', materialSummary(model.units, model.material), () => openMaterialDialog({ units: model.units, material: model.material, show: ['Sy', 'Sut', 'E', 'nu'],
      note: 'Only Sy is used here, for the factor of safety against yielding.', onApply: (mat) => { model.material = mat; touch(); renderSetup(); } })),
    pick('kt-pick-units', 'Units', `${model.units.force} · ${model.units.length} · ${model.units.stress}`, () => openUnitsDialog({ units: model.units, onApply: applyUnits })),
    h('div', { class: 'grow' }),
    h('button', { id: 'kt-solve', class: 'btn primary solve', type: 'button', onClick: () => solve(), text: 'Solve' }));
}

function renderInputs() {
  const u = U(), geo = GEOMETRIES[model.geometry];
  clear($('kt-inputs')).append(
    h('section', { class: 'panel', id: 'kt-dims' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'Dimensions' }), h('span', { class: 'hint', text: geo.label })),
      h('div', { class: 'panel-body stack' },
        h('div', { class: 'form-grid' }, geo.dims.map(([k, label]) => field(`kt-dim-${k}`, model.dims, k, label, u.dim.label))),
        h('p', { class: 'table-note', text: 'The stress concentration factors depend only on these dimensions. They are read from the charts of Shigley Table A-15.' }))),
    h('section', { class: 'panel', id: 'kt-loads' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'Loads' }), h('span', { class: 'hint', text: 'Leave blank for zero' })),
      h('div', { class: 'panel-body stack' },
        h('div', { class: 'form-grid' }, Object.keys(geo.loads).map((k) => field(`kt-load-${k}`, model.loads, k, LOAD_NAMES[k], u[LOAD_KIND[k]].label))),
        h('p', { class: 'table-note', text: Object.keys(geo.loads).length === 3
          ? 'Any combination of the three. With no loads you still get Kt and Kts; the stresses are then zero.'
          : 'Either or both. With no loads you still get Kt; the stresses are then zero.' }))));
}

// ---------------------------------------------------------------------------
// Drawing: the part in profile, to scale.
// ---------------------------------------------------------------------------
function drawView() {
  const host = $('kt-view'), W = Math.max(320, Math.floor(host.clientWidth || 640)), H = 230, cy = 104;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': `${GEOMETRIES[model.geometry].label}, drawn to scale` });
  clear(host).append(svg);
  const geo = GEOMETRIES[model.geometry], u = U();
  const g = Object.fromEntries(geo.dims.map(([k]) => [k, parseNum(model.dims[k])]));
  const need = geo.dims.map(([k]) => k).filter((k) => k !== 't');
  if (need.some((k) => !(g[k] > 0)) || geo.check({ ...g, t: g.t || 1 })) {
    svg.append(s('text', { x: W / 2, y: cy, 'text-anchor': 'middle', text: 'Enter the dimensions to draw the part.' }));
    return;
  }
  const big = g.w ?? g.D, x0 = W * 0.2, x1 = W * 0.8, mid = (x0 + x1) / 2;
  const k = Math.min(120 / big, (x1 - x0) / (2.6 * big));     // px per unit, keeping the part longer than it is tall
  const half = (v) => v * k / 2, R = Math.max(g.r ? g.r * k : 0, 0);
  const isShaft = model.geometry.startsWith('shaft');
  let d = '';
  if (model.geometry === 'bar-hole') {
    d = `M${x0} ${cy - half(g.w)}H${x1}V${cy + half(g.w)}H${x0}Z`;
    svg.append(s('path', { class: 'part', d }), s('circle', { class: 'part-hole', cx: mid, cy, r: half(g.d) }));
  } else if (model.geometry === 'bar-notch' || model.geometry === 'shaft-groove') {
    // a U-shaped notch of radius r on each side, cut down to the reduced size d
    const a = half(big), b = half(g.d), depth = a - b, r = Math.min(R, depth > 0 ? Math.max(R, 0.5) : R);
    const side = (sgn) => {
      const yOut = cy + sgn * a, yIn = cy + sgn * b;
      if (depth >= r) return `L${mid - r} ${yOut}L${mid - r} ${yIn + sgn * r}A${r} ${r} 0 0 ${sgn < 0 ? 0 : 1} ${mid + r} ${yIn + sgn * r}L${mid + r} ${yOut}`;
      const hw = Math.sqrt(Math.max(r * r - (r - depth) ** 2, 0));     // shallow notch: a circular arc
      return `L${mid - hw} ${yOut}A${r} ${r} 0 0 ${sgn < 0 ? 0 : 1} ${mid + hw} ${yOut}`;
    };
    d = `M${x0} ${cy - a}${side(-1)}L${x1} ${cy - a}L${x1} ${cy + a}`;
    // the lower edge runs right to left
    const lower = (() => {
      const yOut = cy + a, yIn = cy + b;
      if (depth >= r) return `L${mid + r} ${yOut}L${mid + r} ${yIn + r}A${r} ${r} 0 0 0 ${mid - r} ${yIn + r}L${mid - r} ${yOut}`;
      const hw = Math.sqrt(Math.max(r * r - (r - depth) ** 2, 0));
      return `L${mid + hw} ${yOut}A${r} ${r} 0 0 0 ${mid - hw} ${yOut}`;
    })();
    svg.append(s('path', { class: 'part', d: `${d}${lower}L${x0} ${cy + a}Z` }));
  } else {
    // shoulder: large section on the left, small on the right, with a fillet of radius r
    const a = half(g.D), b = half(g.d), r = Math.min(R, a - b);
    d = `M${x0} ${cy - a}H${mid}V${cy - b - r}A${r} ${r} 0 0 0 ${mid + r} ${cy - b}H${x1}V${cy + b}H${mid + r}A${r} ${r} 0 0 0 ${mid} ${cy + b + r}V${cy + a}H${x0}Z`;
    svg.append(s('path', { class: 'part', d }));
  }
  if (isShaft) svg.append(s('line', { class: 'axis', x1: x0 - 14, x2: x1 + 14, y1: cy, y2: cy, 'stroke-dasharray': '12 3 2 3' }));
  // loads that are applied
  const val = (key) => parseNum(model.loads[key]) || 0, lab = [];
  if (geo.loads.F && val('F')) lab.push(`F = ${fmt(val('F'), 4)} ${u.force.label}`);
  if (geo.loads.M && val('M')) lab.push(`M = ${fmt(val('M'), 4)} ${u.moment.label}`);
  if (geo.loads.T && val('T')) lab.push(`T = ${fmt(val('T'), 4)} ${u.moment.label}`);
  if (val('F')) {
    const dir = Math.sign(val('F'));
    for (const [xa, sgn] of [[x0, -1], [x1, 1]]) {
      const tail = xa + sgn * (dir > 0 ? 8 : 44), tip = xa + sgn * (dir > 0 ? 44 : 8);
      svg.append(s('line', { class: 'ld', x1: tail, x2: tip - sgn * dir * 6, y1: cy, y2: cy }),
        s('polygon', { class: 'ld-fill', points: `${tip},${cy} ${tip - sgn * dir * 9},${cy - 4} ${tip - sgn * dir * 9},${cy + 4}` }));
    }
  }
  svg.append(s('text', { class: 't-strong', x: W / 2, y: 20, 'text-anchor': 'middle', text: lab.length ? lab.join(',  ') : 'No loads: factors only' }));
  svg.append(s('text', { class: 't-dim', x: W / 2, y: H - 30, 'text-anchor': 'middle',
    text: `${geo.dims.map(([key]) => `${key} = ${fmt(g[key], 4)}`).join(',  ')} ${u.dim.label}` }));
  svg.append(s('text', { class: 't-dim', x: W / 2, y: H - 12, 'text-anchor': 'middle', text: isShaft ? 'side view, drawn to scale (the dash-dot line is the shaft axis)' : 'face view, drawn to scale' }));
}

// ---------------------------------------------------------------------------
function solve(quiet = false) {
  const box = clear($('kt-messages'));
  const { input, errors } = ktInput(model);
  if (errors.length) { if (!quiet) showMessages(box, 'error', 'Fix these before solving:', errors); return; }
  const result = solveKt(input);
  if (!result.ok) { if (!quiet) showMessages(box, 'error', 'Cannot solve yet:', result.errors); return; }
  solved = { result, input };
  stale = false;
  showMessages(box, 'note', null, result.notes);
  renderResults();
  drawView();
}

/** One of the book's charts, redrawn from its data, with this part marked on it. */
function chartSvg(c, width) {
  const chart = CHARTS[c.figure], H = 250, M = { l: 44, r: 58, t: 14, b: 38 };
  const xT = chart.xTicks, kT = chart.kTicks;
  const xLo = xT[0], xHi = Math.max(xT[xT.length - 1], ...chart.curves.map((q) => q.x[q.x.length - 1])), kLo = kT[0], kHi = kT[kT.length - 1];
  const px = (v) => M.l + (v - xLo) / (xHi - xLo) * (width - M.l - M.r), py = (v) => M.t + (kHi - v) / (kHi - kLo) * (H - M.t - M.b);
  const svg = s('svg', { viewBox: `0 0 ${width} ${H}`, height: H, role: 'img',
    'aria-label': `Figure ${c.figure}: ${c.shear ? 'Kts' : 'Kt'} against ${chart.x}${c.K === null ? '' : `, with this part at ${fmt(c.K, 3)}`}` });
  for (const v of kT) svg.append(s('line', { class: 'grid-line', x1: M.l, x2: width - M.r, y1: py(v), y2: py(v) }), s('text', { x: M.l - 6, y: py(v) + 4, 'text-anchor': 'end', text: v.toFixed(1) }));
  for (const v of xT) svg.append(s('line', { class: 'grid-line', x1: px(v), x2: px(v), y1: M.t, y2: H - M.b }), s('text', { class: 't-dim', x: px(v), y: H - M.b + 15, 'text-anchor': 'middle', text: `${v}` }));
  svg.append(s('text', { class: 't-dim', x: (M.l + width - M.r) / 2, y: H - 6, 'text-anchor': 'middle', text: chart.x }));
  const path = (pts) => pts.map(([x, k], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)} ${py(Math.min(k, kHi)).toFixed(1)}`).join('');
  const curveName = (q) => (q.p === 'inf' ? '∞' : `${q.p}`);
  const atEdge = [];
  for (const q of chart.curves) {
    svg.append(s('path', { class: 'book-curve', d: path(q.x.map((x, i) => [x, q.k[i]])) }));
    if (chart.p === null) continue;
    const xe = q.x[q.x.length - 1], ke = q.k[q.k.length - 1];
    if (xe < xHi - 0.03 * (xHi - xLo)) svg.append(s('text', { class: 't-dim', x: px(xe) + 4, y: py(ke) - 4, text: curveName(q) }));   // a curve that stops short is labelled at its end
    else atEdge.push({ q, y: py(ke) + 4 });
  }
  // Curves that reach the right edge are labelled in the margin, in the same order, spread so they do not overlap.
  atEdge.sort((a, b) => a.y - b.y);
  for (let i = 1; i < atEdge.length; i++) atEdge[i].y = Math.max(atEdge[i].y, atEdge[i - 1].y + 11);
  const over = atEdge.length ? atEdge[atEdge.length - 1].y - (H - M.b - 1) : 0;
  for (const e of atEdge) svg.append(s('text', { class: 't-dim', x: width - M.r + 5, y: e.y - Math.max(0, over), text: curveName(e.q) }));
  if (chart.p !== null) svg.append(s('text', { class: 't-dim', x: width - M.r + 5, y: M.t + 2, text: c.pName }));
  if (c.K !== null) {
    if (chart.p !== null) { const own = chartCurve(c.figure, c.p, c.x); if (own.length > 1) svg.append(s('path', { class: 'curve', d: path(own) })); }
    const cx = px(c.x), cyy = py(Math.min(c.K, kHi));
    svg.append(s('line', { class: 'cursor-line', x1: cx, x2: cx, y1: cyy, y2: H - M.b, 'stroke-dasharray': '3 3' }), s('line', { class: 'cursor-line', x1: M.l, x2: cx, y1: cyy, y2: cyy, 'stroke-dasharray': '3 3' }),
      s('circle', { class: 'peak', cx, cy: cyy, r: 5 }),
      s('text', { class: 't-strong', x: cx + 9, y: cyy - 9, text: `${c.shear ? 'Kts' : 'Kt'} = ${c.K.toFixed(2)}` }));
  }
  return svg;
}

function renderResults() {
  $('kt-results').classList.toggle('stale', !!solved && stale);
  const body = clear($('kt-results-body'));
  if (!solved) {
    body.append(h('div', { class: 'empty-state' }, h('p', { text: 'Choose a geometry, enter its dimensions, then press Solve to read the stress concentration factors.' }),
      h('button', { class: 'btn', type: 'button', text: 'Solve', onClick: () => solve() })));
    return;
  }
  const u = U(), r = solved.result;
  const cell = (v, sig = 5) => h('td', { text: fmt(v, sig) });
  const name = (c) => (c.shear ? 'Kts' : 'Kt');
  const big = (label, value, sub) => h('div', {}, h('span', { text: label }), h('b', { class: 'num', text: value }), sub ? h('span', { text: sub }) : null);
  const head = h('div', { class: 'props headline' }, r.cases.map((c) => big(`${name(c)}, ${LOAD_NAMES[c.load].toLowerCase().replace(/ [fmt]$/, '')}`,
    c.K === null ? '—' : c.K.toFixed(2), c.K === null ? 'off the chart' : `Figure ${c.figure}`)));
  const ratio = (c) => `${c.xName} = ${fmt(c.x, 4)}${c.p === null ? '' : `,  ${c.pName} = ${fmt(c.p, 4)}`}`;
  const table = h('section', { class: 'full' }, h('h3', { text: 'Each loading' }),
    h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('Loading'), th('Chart'), th('Read at'), th('Factor'), th('Nominal stress', u.stress.label), th('Peak stress', u.stress.label))),
      h('tbody', {}, r.cases.map((c) => h('tr', {}, h('td', { text: LOAD_NAMES[c.load] }), h('td', { text: c.figure }), h('td', { text: ratio(c) }),
        c.K === null ? h('td', { class: 'muted', text: '—' }) : h('td', { text: `${name(c)} = ${c.K.toFixed(2)}` }),
        cell(c.nominal / u.stress.f), c.peak === null ? h('td', { class: 'muted', text: '—' }) : cell(c.peak / u.stress.f)))))),
    h('ul', { class: 'formulas' }, r.cases.map((c) => h('li', {}, `${LOAD_NAMES[c.load]}:  `, h('span', { class: 'mono', text: `${c.formula};   ${c.shear ? 'τmax = Kts τ₀' : 'σmax = Kt σ₀'}` }))),
      r.cases.filter((c) => c.error).map((c) => h('li', { class: 'check-bad', text: c.error }))));
  const vm = r.vonMises;
  const combined = h('section', { class: 'full' }, h('h3', { text: 'Combined at the notch' }),
    vm === null ? h('p', { class: 'check-bad', text: 'A loaded case is off its chart, so the combined stress cannot be given.' })
      : h('div', { class: 'props' },
        big('Largest normal stress σmax', `${fmt(r.sigmaMax / u.stress.f, 5)} ${u.stress.label}`),
        big('Largest shear stress τmax', `${fmt(r.tauMax / u.stress.f, 5)} ${u.stress.label}`),
        big("von Mises stress σ′", `${fmt(vm / u.stress.f, 5)} ${u.stress.label}`),
        big('Factor of safety n = Sy / σ′', r.safety === null ? '—' : fmt(r.safety, 4), r.safety === null ? (vm === 0 ? 'no load applied' : 'enter Sy in Material') : null)),
    h('p', { class: 'table-note', text: 'Axial and bending peaks are added, since both occur at the root of the notch; σ′ = √(σmax² + 3 τmax²). For a ductile material under static load, Shigley notes that Kt is often not applied (Sec. 3-13); it always matters for brittle materials and for fatigue.' }));
  const charts = h('div', { class: 'plots', id: 'kt-charts' });
  body.append(h('div', { class: 'tables' }, h('section', { class: 'full' }, head), table, combined), charts);
  const width = Math.max(300, Math.floor(charts.clientWidth || 640) - 24);
  for (const c of r.cases) {
    charts.append(h('div', { class: 'plot' }, h('div', { class: 'plot-head' },
      h('h3', {}, `Figure ${c.figure}: ${LOAD_NAMES[c.load].toLowerCase().replace(/ [fmt]$/, '')}`),
      h('div', { class: 'plot-read', text: c.K === null ? 'this part is off the chart' : `${ratio(c)}   →   ${name(c)} = ${c.K.toFixed(2)}` })), chartSvg(c, width)));
  }
  charts.append(h('p', { class: 'table-note', style: 'padding: 0 12px 10px', text: 'Grey lines are the curves printed in the book, labelled at the right. The blue line is the curve for this part, interpolated between them.' }));
}

function applyUnits(units, mode) {
  if (mode === 'convert') {
    const from = model.units, cv = (v, kind) => convert(parseNum(v) ?? '', kind, from, units);
    model = { ...model, units: { ...units }, material: convertMaterial(model.material, from, units),
      dims: Object.fromEntries(Object.entries(model.dims).map(([k, v]) => [k, cv(v, 'dim')])),
      loads: Object.fromEntries(Object.entries(model.loads).map(([k, v]) => [k, cv(v, LOAD_KIND[k])])) };
    save(); renderSetup(); renderInputs(); drawView(); renderResults();
  } else { model.units = { ...units }; renderSetup(); renderInputs(); touch(); renderResults(); }
}

function loadModel(m, autoSolve) {
  model = m; solved = null; stale = true; save();
  clear($('kt-messages'));
  renderSetup(); renderInputs();
  if (autoSolve) solve(); else { renderResults(); drawView(); }
}

function helpContent() {
  const li = (t) => h('li', { text: t });
  return h('div', { class: 'help' },
    h('h3', { text: 'What it does' }),
    h('ul', {}, li('Reads the theoretical stress concentration factors Kt (normal stress) and Kts (shear stress) for five common geometries, and applies them to the nominal stress: σmax = Kt σ₀ and τmax = Kts τ₀ (Shigley Sec. 3-13).'),
      li('Bars take an axial force F and a bending moment M. Round shafts also take a torque T. A load left blank is zero.')),
    h('h3', { text: 'Where the numbers come from' }),
    h('ul', {}, li('The curves of Shigley Table A-15 (Figures A-15-1 to A-15-9 and A-15-13 to A-15-15), taken from the book as numbers. A value between two printed curves is interpolated, the way you would by eye.'),
      li('Expect agreement with a careful reading of the chart to about two percent. The page tells you when a part is near or beyond the edge of a chart.'),
      li('The nominal stress is defined on each chart and is always based on the reduced section (the smaller width or diameter, or the width left beside the hole). The formula used is listed under the table.')),
    h('h3', { text: 'Combining loads' }),
    h('ul', {}, li('Axial and bending peak stresses are added, torsion gives the shear, and the von Mises stress is √(σ² + 3τ²). The factor of safety is Sy divided by that.'),
      li('These are theoretical (geometric) factors. Fatigue uses Kf = 1 + q (Kt − 1) with the notch sensitivity q; that belongs to the shaft analysis.')));
}

export const kt = {
  id: 'kt', label: 'Stress Concentration', helpTitle: 'Stress concentration: charts and formulas',
  examples: KT_EXAMPLES.map((e) => ({ title: e.title, load: () => loadModel(normalize(structuredClone(e)), true) })),
  init() {
    renderSetup(); renderInputs(); solve(true);
    if (!solved) { renderResults(); drawView(); }
    let timer = 0, last = 0;
    new ResizeObserver(() => {
      const w = $('kt-view').clientWidth;
      if (!w || w === last) return;
      last = w; clearTimeout(timer);
      timer = setTimeout(() => { drawView(); if (solved) renderResults(); }, 120);
    }).observe($('kt-view'));
  },
  show() { drawView(); if (solved) renderResults(); },
  newModel() { loadModel(emptyKt(model.units), false); },
  saveText: () => JSON.stringify(model, null, 2),
  openText(text) { const m = parseSaved(text, 'kt'); if (!m) return false; loadModel(normalize(m), false); return true; },
  csv: () => null,
  fileName: (ext) => `${fileSlug(model.title, 'stress-concentration')}.${ext}`,
  help: helpContent,
};
