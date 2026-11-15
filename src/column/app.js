// Column calculator page: buckling of a straight column under compression,
// following Shigley Secs. 4-11 to 4-13 (Euler, J. B. Johnson, secant).
import { h, s, clear } from '../ui/dom.js';
import { pick, th } from '../ui/tables.js';
import { UNIT_CHOICES, DEFAULT_UNITS, UNIT_PRESETS, unitTable, fmt, convert } from '../core/units.js';
import {
  parseNum, sectionSI, sectionSummary, materialSummary, materialSI, defaultMaterial, materialPreset, convertSection, convertMaterial,
} from '../core/inputs.js';
import {
  openSectionDialog, openMaterialDialog, openUnitsDialog, parseSaved, fileSlug, showMessages,
} from '../ui/dialogs.js';
import { solveColumn, END_CONDITIONS, C_SETS, unitLoadCurve, transitionSlenderness } from './solver.js';

const STORE_KEY = 'sec.column.model.v1';
const $ = (id) => document.getElementById(id);
const SI = UNIT_PRESETS['kN, m'];

export function emptyColumn(units = DEFAULT_UNITS) {
  return { version: 1, kind: 'column', title: 'Untitled column', units: { ...units }, length: '',
    section: { shape: 'circle', dims: { d: '' }, custom: {} }, material: defaultMaterial(units),
    endXY: 'rounded-rounded', endXZ: 'rounded-rounded', cSet: 'recommended', cXY: '', cXZ: '', load: '', ecc: '', eccPlane: 'xy' };
}

export const COLUMN_EXAMPLES = [
  { ...emptyColumn(SI), title: 'Long round column (Euler)', length: 1.5, section: { shape: 'circle', dims: { d: 40 }, custom: {} },
    material: { ...materialPreset('aisi-1050-cd', SI), id: 'custom', Sy: 500, Sut: '' }, load: 22 },
  { ...emptyColumn(SI), title: 'Short round column (Johnson)', length: 0.375, section: { shape: 'circle', dims: { d: 20 }, custom: {} },
    material: { ...materialPreset('aisi-1050-cd', SI), id: 'custom', Sy: 500, Sut: '' }, load: 22 },
  { ...emptyColumn(SI), title: 'Rectangular strut, different ends in each plane', length: 0.8, section: { shape: 'rect', dims: { b: 12, h: 30 }, custom: {} },
    endXY: 'rounded-rounded', endXZ: 'fixed-fixed', load: 8 },
  { ...emptyColumn(SI), title: 'Eccentric load on a tube (secant)', length: 2, section: { shape: 'tube', dims: { do: 60, di: 50 }, custom: {} },
    material: materialPreset('aisi-1020-cd', SI), load: 40, ecc: 0.005, eccPlane: 'xy' },
];

let model = loadSaved() ?? structuredClone(COLUMN_EXAMPLES[0]);
let solved = null, stale = true;
const U = () => unitTable(model.units);

function normalize(m) {
  const base = emptyColumn();
  const out = { ...base, ...m, kind: 'column' };
  out.units = { ...base.units, ...(m.units || {}) };
  for (const [k, list] of Object.entries(UNIT_CHOICES)) if (!list.includes(out.units[k])) out.units[k] = DEFAULT_UNITS[k];
  out.section = { ...base.section, ...(m.section || {}) };
  out.material = { ...base.material, ...(m.material || {}) };
  if (!END_CONDITIONS[out.endXY]) out.endXY = base.endXY;
  if (!END_CONDITIONS[out.endXZ]) out.endXZ = base.endXZ;
  if (!C_SETS[out.cSet]) out.cSet = 'recommended';
  return out;
}
function loadSaved() {
  try { const m = JSON.parse(localStorage.getItem(STORE_KEY)); return m && m.version === 1 ? normalize(m) : null; } catch { return null; }
}
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(model)); } catch { /* optional */ } };

function touch() {
  stale = true; save();
  $('col-results').classList.toggle('stale', !!solved);
  clear($('col-messages'));
  drawView();
}

const constantFor = (m, plane) => (m.cSet === 'custom' ? parseNum(plane === 'xy' ? m.cXY : m.cXZ) : END_CONDITIONS[plane === 'xy' ? m.endXY : m.endXZ][m.cSet]);

/** Model in SI for the solver. */
export function columnInput(m) {
  const t = unitTable(m.units), errors = [];
  const mat = materialSI(m.units, m.material);
  errors.push(...mat.errors);
  const sec = sectionSI(m.units, m.section);
  if (sec.error) errors.push(sec.error);
  const p = sec.props || {};
  const P = parseNum(m.load), e = parseNum(m.ecc);
  const input = { L: (parseNum(m.length) ?? 0) * t.length.f, E: mat.E, Sy: mat.Sy, A: p.A ?? null, Iz: p.Iz ?? null, Iy: p.Iy ?? null, cy: p.cy ?? null, cz: p.cz ?? null,
    Cxy: constantFor(m, 'xy'), Cxz: constantFor(m, 'xz'), P: P === null ? null : P * t.force.f, e: e === null ? null : e * t.length.f, ePlane: m.eccPlane };
  return { input, errors };
}

// ---------------------------------------------------------------------------
function numField(id, key, label, unit, width = '6em') {
  const inp = h('input', { id, class: 'num-in', type: 'text', inputMode: 'decimal', value: model[key] ?? '', style: `width: ${width}` });
  inp.addEventListener('input', () => { model[key] = inp.value.trim(); inp.classList.toggle('bad', inp.value.trim() !== '' && parseNum(inp.value) === null); touch(); });
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), h('div', { class: 'with-unit' }, inp, unit ? h('span', { class: 'unit', text: unit }) : null));
}
function selectField(id, key, label, options, rerender) {
  const sel = h('select', { id }, Object.entries(options).map(([value, text]) => h('option', { value, text, selected: model[key] === value })));
  sel.addEventListener('change', () => { model[key] = sel.value; touch(); if (rerender) renderInputs(); });
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), sel);
}

function renderSetup() {
  const u = U();
  const title = h('input', { id: 'col-title', type: 'text', value: model.title ?? '', style: 'width: 13.5em', onInput: () => { model.title = title.value; save(); } });
  clear($('col-setup')).append(
    h('div', { class: 'field' }, h('label', { for: 'col-title', text: 'Name' }), title),
    numField('col-length', 'length', 'Column length', u.length.label),
    pick('col-pick-section', 'Cross-section', sectionSummary(model.units, model.section), () => openSectionDialog({ units: model.units, section: model.section, need: 'column',
      onApply: (sec) => { model.section = sec; touch(); renderSetup(); } })),
    pick('col-pick-material', 'Material', materialSummary(model.units, model.material), () => openMaterialDialog({ units: model.units, material: model.material, show: ['E', 'Sy', 'Sut', 'nu'],
      note: 'E sets the Euler load. Sy decides where the Johnson formula takes over and is needed for an eccentric load.',
      onApply: (mat) => { model.material = mat; touch(); renderSetup(); } })),
    pick('col-pick-units', 'Units', `${model.units.force} · ${model.units.length} · ${model.units.stress}`, () => openUnitsDialog({ units: model.units, onApply: applyUnits })),
    h('div', { class: 'grow' }),
    h('button', { id: 'col-solve', class: 'btn primary solve', type: 'button', onClick: () => solve(), text: 'Solve' }));
}

function renderInputs() {
  const u = U();
  const ends = Object.fromEntries(Object.entries(END_CONDITIONS).map(([k, v]) => [k, v.label]));
  const cText = (plane) => { const c = constantFor(model, plane); return c ? `C = ${fmt(c, 4)}` : 'C = ?'; };
  const custom = model.cSet === 'custom';
  const endRow = (plane, endKey, cKey, what) => h('div', { class: 'form-grid ends-row' },
    selectField(`col-${endKey}`, endKey, `Ends, ${what}`, ends, true),
    custom ? numField(`col-${cKey}`, cKey, 'End-condition constant C', '', '100%')
      : h('div', { class: 'field' }, h('span', { class: 'label', text: 'End-condition constant' }), h('b', { class: 'num', id: `col-c-${plane}`, text: cText(plane) })));
  clear($('col-inputs')).append(
    h('section', { class: 'panel', id: 'col-ends' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'End conditions' }), h('span', { class: 'hint', text: 'Shigley Table 4-2' })),
      h('div', { class: 'panel-body stack' },
        selectField('col-cSet', 'cSet', 'Values of C to use', C_SETS, true),
        endRow('xy', 'endXY', 'cXY', 'buckling in the XY plane (about z, uses Iz)'),
        endRow('xz', 'endXZ', 'cXZ', 'buckling in the XZ plane (about y, uses Iy)'),
        h('p', { class: 'table-note', text: 'Recommended values allow for ends that are never perfectly fixed: 1.2 instead of the theoretical 2 or 4. A fixed-free column is always 1/4.' }))),
    h('section', { class: 'panel', id: 'col-loading' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'Load' }), h('span', { class: 'hint', text: 'Optional' })),
      h('div', { class: 'panel-body stack' },
        h('div', { class: 'form-grid' },
          numField('col-load', 'load', 'Compressive load P', u.force.label, '100%'),
          numField('col-ecc', 'ecc', 'Eccentricity e', u.length.label, '100%'),
          selectField('col-eccPlane', 'eccPlane', 'Eccentricity lies in', { xy: 'XY plane (offset along y)', xz: 'XZ plane (offset along z)' }, false)),
        h('p', { class: 'table-note', text: 'Give a load to get the factor of safety n = Pcr / P. Give an eccentricity as well to apply the secant formula.' }))));
}

// ---------------------------------------------------------------------------
function modeShape(end, t) {
  // Buckled shape between the base (t = 0) and the top (t = 1), scaled to about 1.
  if (end === 'fixed-free') return 1 - Math.cos(Math.PI * t / 2);
  if (end === 'fixed-fixed') return (1 - Math.cos(2 * Math.PI * t)) / 2;
  if (end === 'fixed-rounded') {
    // Measured from the pinned top: y = sin(k s) - s sin(k), with tan k = k.
    const k = 4.4934, sTop = 1 - t;
    return (Math.sin(k * sTop) - sTop * Math.sin(k)) / 1.4;
  }
  return Math.sin(Math.PI * t);
}

function drawView() {
  const host = $('col-view'), W = Math.max(320, Math.floor(host.clientWidth || 640)), H = 300;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'The column in each plane with its end conditions and buckled shape' });
  clear(host).append(svg);
  const top = 50, bot = H - 66, u = U();
  const P = parseNum(model.load);
  [['xy', model.endXY, 'XY plane', 'y'], ['xz', model.endXZ, 'XZ plane', 'z']].forEach(([plane, end, name, axis], i) => {
    const cx = W * (i ? 0.72 : 0.28);
    const governs = solved && !stale && solved.result.governing.id === plane;
    svg.append(s('text', { class: 't-strong', x: cx, y: bot + 38, 'text-anchor': 'middle', text: `${name}${governs ? ' (governs)' : ''}` }));
    svg.append(s('text', { class: 't-dim', x: cx, y: bot + 53, 'text-anchor': 'middle', text: END_CONDITIONS[end].label.replace(/ \(.*/, '') }));
    // base
    const baseFixed = end.startsWith('fixed');
    if (baseFixed) {
      svg.append(s('line', { class: 'sup-line', x1: cx - 26, x2: cx + 26, y1: bot, y2: bot, 'stroke-width': 2.5 }));
      for (let x = cx - 24; x <= cx + 26; x += 7) svg.append(s('line', { class: 'hatch', x1: x, y1: bot, x2: x - 6, y2: bot + 7 }));
    } else {
      svg.append(s('polygon', { class: 'sup', points: `${cx},${bot} ${cx - 10},${bot + 16} ${cx + 10},${bot + 16}` }), s('line', { class: 'sup-line', x1: cx - 16, x2: cx + 16, y1: bot + 16, y2: bot + 16 }));
    }
    // top: fixed-fixed is held against rotation but free to move down; rounded is a pin on a roller; free is free
    if (end === 'fixed-fixed') svg.append(s('rect', { class: 'sup', x: cx - 16, y: top - 10, width: 32, height: 10 }));
    else if (end !== 'fixed-free') svg.append(s('circle', { class: 'sup', cx, cy: top, r: 5 }),
      s('line', { class: 'sup-line', x1: cx + 14, x2: cx + 14, y1: top - 12, y2: top + 12 }), s('line', { class: 'sup-line', x1: cx - 14, x2: cx - 14, y1: top - 12, y2: top + 12 }));
    // column and buckled shape
    svg.append(s('rect', { class: 'beam', x: cx - 4, y: top, width: 8, height: bot - top, rx: 1.5 }));
    let d = '';
    for (let k = 0; k <= 40; k++) { const t = k / 40; d += `${k ? 'L' : 'M'}${(cx + 30 * modeShape(end, t)).toFixed(1)} ${(bot - t * (bot - top)).toFixed(1)}`; }
    svg.append(s('path', { class: 'curve', d, 'stroke-dasharray': '5 4', 'stroke-width': 1.5 }));
    // load
    const yA = top - (end === 'fixed-fixed' ? 40 : 34);
    svg.append(s('line', { class: 'ld', x1: cx, x2: cx, y1: yA, y2: top - (end === 'fixed-fixed' ? 16 : 12) }),
      s('polygon', { class: 'ld-fill', points: `${cx},${top - (end === 'fixed-fixed' ? 10 : 6)} ${cx - 4},${top - (end === 'fixed-fixed' ? 19 : 15)} ${cx + 4},${top - (end === 'fixed-fixed' ? 19 : 15)}` }));
    if (!i) svg.append(s('text', { class: 't-strong', x: cx + 10, y: yA + 8, text: P ? `P = ${fmt(P, 4)} ${u.force.label}` : 'P' }));
    svg.append(s('text', { class: 't-dim', x: cx + 46, y: (top + bot) / 2, text: `bends along ${axis}` }));
  });
  const L = parseNum(model.length);
  svg.append(s('line', { class: 'dim', x1: 22, x2: 22, y1: top, y2: bot }), s('line', { class: 'dim', x1: 18, x2: 26, y1: top, y2: top }), s('line', { class: 'dim', x1: 18, x2: 26, y1: bot, y2: bot }),
    s('text', { class: 't-dim', x: 30, y: (top + bot) / 2 + 4, text: L ? `l = ${fmt(L, 4)} ${u.length.label}` : 'l' }));
}

// ---------------------------------------------------------------------------
function solve(quiet = false) {
  const box = clear($('col-messages'));
  const { input, errors } = columnInput(model);
  if (errors.length) { if (!quiet) showMessages(box, 'error', 'Fix these before solving:', errors); return; }
  const result = solveColumn(input);
  if (!result.ok) { if (!quiet) showMessages(box, 'error', 'The column cannot be solved yet:', result.errors); return; }
  solved = { result, input };
  stale = false;
  showMessages(box, 'note', null, [...result.warnings, ...result.notes]);
  renderResults();
  drawView();
}

function chart(host) {
  const { result: r, input } = solved, u = U();
  const W = Math.max(300, Math.floor(host.clientWidth || 640)), H = 280, M = { l: 64, r: 20, t: 18, b: 40 };
  const lam = r.planes.map((p) => p.slenderness / Math.sqrt(p.C));
  const tr = input.Sy > 0 ? transitionSlenderness(1, input.E, input.Sy) : null;
  const xMax = Math.max(...lam.map((v) => v * 1.3), tr ? tr * 1.9 : 0, 60);
  const x0 = tr ? 0 : Math.min(...lam) * 0.5;
  const yTop = tr ? input.Sy : unitLoadCurve(input.E, null, x0);
  const px = (v) => M.l + (v - x0) / (xMax - x0) * (W - M.l - M.r), py = (v) => M.t + (1 - v / (yTop * 1.08)) * (H - M.t - M.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Critical unit load against effective slenderness, with this column marked' });
  const f = u.stress.f;
  for (const v of [0, yTop / 2, yTop]) {
    svg.append(s('line', { class: v ? 'grid-line' : 'zero-line', x1: M.l, x2: W - M.r, y1: py(v), y2: py(v) }), s('text', { x: M.l - 8, y: py(v) + 4, 'text-anchor': 'end', text: fmt(v / f, 3) }));
  }
  const step = xMax > 240 ? 100 : xMax > 120 ? 50 : 20;
  for (let v = Math.ceil(x0 / step) * step; v <= xMax; v += step) {
    svg.append(s('line', { class: 'grid-line', x1: px(v), x2: px(v), y1: H - M.b, y2: H - M.b + 4 }), s('text', { class: 't-dim', x: px(v), y: H - M.b + 17, 'text-anchor': 'middle', text: `${v}` }));
  }
  svg.append(s('text', { class: 't-dim', x: (M.l + W - M.r) / 2, y: H - 6, 'text-anchor': 'middle', text: 'effective slenderness (l/k) / √C' }));
  let d = '';
  for (let k = 0; k <= 200; k++) { const v = x0 + (xMax - x0) * k / 200; if (v <= 0) continue; d += `${d ? 'L' : 'M'}${px(v).toFixed(1)} ${py(Math.min(unitLoadCurve(input.E, input.Sy, v), yTop)).toFixed(1)}`; }
  if (tr) d = `M${px(0)} ${py(input.Sy)}L${d.slice(1)}`;
  svg.append(s('path', { class: 'curve', d }));
  if (tr) {
    svg.append(s('line', { class: 'cursor-line', x1: px(tr), x2: px(tr), y1: M.t, y2: H - M.b, 'stroke-dasharray': '3 3' }),
      s('text', { class: 't-dim', x: px(tr) - 6, y: M.t + 10, 'text-anchor': 'end', text: 'Johnson' }), s('text', { class: 't-dim', x: px(tr) + 6, y: M.t + 10, text: 'Euler' }));
  }
  const same = r.planes.length === 2 && Math.abs(lam[0] - lam[1]) < 1e-6 * xMax;
  r.planes.forEach((p, i) => {
    if (same && i) return;                                // both planes sit on the same point: one marker, one label
    const cx = px(lam[i]), cy = py(Math.min(p.unitLoad, yTop));
    const near = !same && i && Math.abs(lam[0] - lam[1]) < 0.12 * xMax;
    svg.append(s('circle', { class: 'peak', cx, cy, r: 5 }), s('text', { class: 't-strong', x: cx + 9, y: cy - 8 - (near ? 14 : 0),
      'text-anchor': cx > W - 170 ? 'end' : 'start', text: `${same ? 'XY and XZ' : p.name}: ${fmt(p.unitLoad / f, 4)} ${u.stress.label}` }));
  });
  clear(host).append(h('div', { class: 'plot' }, h('div', { class: 'plot-head' }, h('h3', {}, 'Critical unit load Pcr / A', h('span', { class: 'unit', text: `(${u.stress.label})` })),
    h('div', { class: 'plot-read', text: tr ? `formulas meet at (l/k)₁/√C = ${fmt(tr, 4)}, where Pcr/A = Sy/2` : 'Euler curve only (no Sy)' })), svg));
}

function renderResults() {
  $('col-results').classList.toggle('stale', !!solved && stale);
  const body = clear($('col-results-body'));
  if (!solved) {
    body.append(h('div', { class: 'empty-state' }, h('p', { text: 'Set up the column, then press Solve to get the critical load in each plane.' }),
      h('button', { class: 'btn', type: 'button', text: 'Solve', onClick: () => solve() })));
    return;
  }
  const u = U(), r = solved.result, g = r.governing;
  const cell = (v, sig = 5) => h('td', { text: fmt(v, sig) });
  const big = (label, value, sub) => h('div', {}, h('span', { text: label }), h('b', { class: 'num', text: value }), sub ? h('span', { text: sub }) : null);
  const summary = h('div', { class: 'props headline' },
    big('Critical load Pcr', `${fmt(g.Pcr / u.force.f, 5)} ${u.force.label}`, `${g.name} plane governs, ${g.regime === 'euler' ? 'Euler' : 'Johnson'} formula`),
    big('Critical unit load Pcr / A', `${fmt(g.unitLoad / u.stress.f, 5)} ${u.stress.label}`),
    r.P ? big('Factor of safety n = Pcr / P', fmt(r.safety, 4), r.safety < 1 ? 'the column buckles under this load' : null) : big('Factor of safety', '—', 'enter a load P'));
  const rows = (label, unit, get, sig) => h('tr', {}, h('td', {}, label, unit ? h('span', { class: 'unit', text: unit }) : null), ...r.planes.map((p) => (typeof get(p) === 'string' ? h('td', { text: get(p) }) : cell(get(p), sig))));
  const table = h('section', { class: 'full' }, h('h3', { text: 'Buckling in each plane' }),
    h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('Quantity'), ...r.planes.map((p) => th(`${p.name} plane`, p.id === 'xy' ? 'about z' : 'about y')))),
      h('tbody', {},
        rows('End-condition constant C', '', (p) => p.C, 4),
        rows('Second moment of area I', u.inertia.label, (p) => p.I / u.inertia.f),
        rows('Radius of gyration k', u.dim.label, (p) => p.k / u.dim.f),
        rows('Slenderness ratio l / k', '', (p) => p.slenderness, 4),
        rows('Limit (l / k)₁, Eq. 4-45', '', (p) => (p.transition === null ? '—' : p.transition), 4),
        rows('Formula used', '', (p) => (p.regime === 'euler' ? 'Euler, Eq. 4-44' : 'Johnson, Eq. 4-48')),
        rows('Critical unit load Pcr / A', u.stress.label, (p) => p.unitLoad / u.stress.f),
        rows('Critical load Pcr', u.force.label, (p) => p.Pcr / u.force.f)))));
  const extra = [];
  if (r.P) extra.push(h('p', { class: 'table-note' }, `Direct compressive stress P / A = ${fmt(r.directStress / u.stress.f, 5)} ${u.stress.label}.`,
    r.squash ? ` Load to yield the section without buckling, Sy A = ${fmt(r.squash / u.force.f, 5)} ${u.force.label}.` : ''));
  let secant = null;
  if (r.secant) {
    const q = r.secant;
    secant = h('section', { class: 'full' }, h('h3', { text: `Eccentric load, secant formula (${q.plane.name} plane)` }),
      h('div', { class: 'scroll-x' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, th('Quantity'), th('Value'))), h('tbody', {},
        h('tr', {}, h('td', { text: 'Eccentricity ratio e c / k²' }), cell(q.ecRatio, 4)),
        h('tr', {}, h('td', {}, 'Load at which the largest stress reaches Sy', h('span', { class: 'unit', text: u.force.label })), cell(q.yieldLoad / u.force.f)),
        q.stress !== null ? h('tr', {}, h('td', {}, 'Largest compressive stress under P, Eq. 4-53', h('span', { class: 'unit', text: u.stress.label })), Number.isFinite(q.stress) ? cell(q.stress / u.stress.f) : h('td', { text: 'beyond the Euler load' })) : null,
        q.safety !== null ? h('tr', {}, h('td', { text: 'Factor of safety on load' }), cell(q.safety, 4)) : null))),
      h('p', { class: 'table-note', text: 'The secant formula is derived for rounded ends. Other end conditions are handled through the effective length l / √C.' }));
  }
  const chartHost = h('div', { class: 'plots', id: 'col-chart' });
  body.append(h('div', { class: 'tables' }, h('section', { class: 'full' }, summary, ...extra), table, secant), chartHost);
  chart(chartHost);
}

function applyUnits(units, mode) {
  if (mode === 'convert') {
    const from = model.units, cv = (v, kind) => convert(parseNum(v) ?? '', kind, from, units);
    model = { ...model, units: { ...units }, length: cv(model.length, 'length'), load: cv(model.load, 'force'), ecc: cv(model.ecc, 'length'),
      section: convertSection(model.section, from, units), material: convertMaterial(model.material, from, units) };
    save(); renderSetup(); renderInputs(); drawView(); renderResults();
  } else { model.units = { ...units }; renderSetup(); renderInputs(); touch(); renderResults(); }
}

function loadModel(m, autoSolve) {
  model = m; solved = null; stale = true; save();
  clear($('col-messages'));
  renderSetup(); renderInputs();
  if (autoSolve) solve(); else { renderResults(); drawView(); }
}

function helpContent() {
  const li = (t) => h('li', { text: t });
  return h('div', { class: 'help' },
    h('h3', { text: 'What it solves' }),
    h('ul', {}, li('The load at which a straight, centrally loaded column buckles, checked separately for bending in the XY plane (about z, using Iz) and in the XZ plane (about y, using Iy). The smaller load governs.'),
      li('Optionally, the stress in an eccentrically loaded column by the secant formula.')),
    h('h3', { text: 'Formulas (Shigley, Secs. 4-11 to 4-13)' }),
    h('ul', {}, li('Radius of gyration k = √(I / A); slenderness ratio l / k.'),
      li('Euler, for l/k above (l/k)₁:  Pcr / A = C π² E / (l/k)²   (Eq. 4-44).'),
      li('J. B. Johnson parabola, for l/k up to (l/k)₁:  Pcr / A = Sy − (Sy l / 2πk)² / (C E)   (Eq. 4-48).'),
      li('The two meet at (l/k)₁ = √(2π² C E / Sy), where Pcr / A = Sy / 2   (Eq. 4-45).'),
      li('Secant formula:  σc = (P / A) [1 + (e c / k²) sec((l / 2k) √(P / A E))]   (Eq. 4-53).'),
      li('C is the end-condition constant of Table 4-2. Factor of safety n = Pcr / P.')),
    h('h3', { text: 'Limits' }),
    h('ul', {}, li('One uniform cross-section, symmetric about y and z. A perfectly straight column for the Euler and Johnson results.'),
      li('Very short members (slenderness under about 10) fail by yielding or crushing, not buckling; the calculator says so when it applies.'),
      li('Local buckling of thin walls and torsional buckling are not checked.')));
}

export const column = {
  id: 'column', label: 'Column', helpTitle: 'Column: formulas and limits',
  examples: COLUMN_EXAMPLES.map((ex) => ({ title: ex.title, load: () => loadModel(normalize(structuredClone(ex)), true) })),
  init() {
    renderSetup(); renderInputs(); solve(true);
    if (!solved) { renderResults(); drawView(); }
    let timer = 0, last = 0;
    new ResizeObserver(() => {
      const w = $('col-view').clientWidth;
      if (!w || w === last) return;
      last = w; clearTimeout(timer);
      timer = setTimeout(() => { drawView(); if (solved) renderResults(); }, 120);
    }).observe($('col-view'));
  },
  show() { drawView(); if (solved) renderResults(); },
  newModel() { loadModel(emptyColumn(model.units), false); },
  saveText: () => JSON.stringify(model, null, 2),
  openText(text) { const m = parseSaved(text, 'column'); if (!m) return false; loadModel(normalize(m), false); return true; },
  csv: () => null,
  fileName: (ext) => `${fileSlug(model.title, 'column')}.${ext}`,
  help: helpContent,
};
