// Bar calculator page: a stepped member along x under axial load only.
import { h, s, clear } from '../ui/dom.js';
import { renderPlotGroup } from '../ui/plot.js';
import { tablePanel, numCell, selectCell, th, pick } from '../ui/tables.js';
import { UNIT_CHOICES, DEFAULT_UNITS, UNIT_PRESETS, unitTable, fmt, convert } from '../core/units.js';
import {
  parseNum, sectionSI, sectionSummary, materialSummary, materialSI, defaultMaterial, convertSection, convertMaterial,
} from '../core/inputs.js';
import {
  openSectionDialog, openMaterialDialog, openUnitsDialog, parseSaved, fileSlug, showMessages,
} from '../ui/dialogs.js';
import { solveBarModel } from './solver.js';

const STORE_KEY = 'sec.bar.model.v1';
const $ = (id) => document.getElementById(id);
const SI = UNIT_PRESETS['kN, m'];
const circle = (d) => ({ shape: 'circle', dims: { d }, custom: {} });

export function emptyBar(units = DEFAULT_UNITS) {
  return { version: 1, kind: 'bar', title: 'Untitled bar', units: { ...units }, material: defaultMaterial(units),
    left: 'fixed', right: 'free', segments: [{ length: '', section: circle(''), E: '' }], pointLoads: [], distLoads: [] };
}

export const BAR_EXAMPLES = [
  { ...emptyBar(SI), title: 'Stepped bar, two loads',
    segments: [{ length: 0.5, section: circle(30), E: '' }, { length: 0.3, section: circle(20), E: '' }],
    pointLoads: [{ x: 0.5, Fx: 10 }, { x: 0.8, Fx: 20 }] },
  { ...emptyBar(SI), title: 'Held at both ends, steel and aluminum', right: 'fixed',
    segments: [{ length: 0.4, section: circle(25), E: '' }, { length: 0.6, section: circle(25), E: 71.7 }],
    pointLoads: [{ x: 0.4, Fx: 40 }] },
  { ...emptyBar(SI), title: 'Hanging rod with distributed load',
    segments: [{ length: 2, section: circle(12), E: '' }],
    pointLoads: [{ x: 2, Fx: 5 }], distLoads: [{ profile: 'uniform', x1: 0, x2: 2, w1: 1.5, w2: '' }] },
  { ...emptyBar(SI), title: 'Three steps in compression',
    segments: [{ length: 0.2, section: circle(50), E: '' }, { length: 0.2, section: circle(40), E: '' }, { length: 0.2, section: circle(30), E: '' }],
    pointLoads: [{ x: 0.6, Fx: -60 }, { x: 0.4, Fx: -30 }] },
];

let model = loadSaved() ?? structuredClone(BAR_EXAMPLES[0]);
let solved = null, stale = true;
const U = () => unitTable(model.units);

function normalize(m) {
  const base = emptyBar();
  const out = { ...base, ...m, kind: 'bar' };
  out.units = { ...base.units, ...(m.units || {}) };
  for (const [k, list] of Object.entries(UNIT_CHOICES)) if (!list.includes(out.units[k])) out.units[k] = DEFAULT_UNITS[k];
  out.material = { ...base.material, ...(m.material || {}) };
  out.segments = (Array.isArray(m.segments) && m.segments.length ? m.segments : base.segments).map((r) => ({ length: '', E: '', ...r, section: { shape: 'circle', dims: {}, custom: {}, ...(r.section || {}) } }));
  for (const k of ['pointLoads', 'distLoads']) out[k] = Array.isArray(m[k]) ? m[k].map((r) => ({ ...r })) : [];
  return out;
}
function loadSaved() {
  try { const m = JSON.parse(localStorage.getItem(STORE_KEY)); return m && m.version === 1 ? normalize(m) : null; } catch { return null; }
}
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(model)); } catch { /* optional */ } };

function touch(structural) {
  stale = true; save();
  $('bar-results').classList.toggle('stale', !!solved);
  clear($('bar-messages'));
  if (structural) renderTables();
  drawView();
}

/** Model in SI for the solver, with row-specific error messages. */
export function barInput(m) {
  const t = unitTable(m.units), errors = [];
  const mat = materialSI(m.units, m.material);
  errors.push(...mat.errors);
  const segments = (m.segments || []).map((r, i) => {
    const sec = sectionSI(m.units, r.section);
    if (sec.error) errors.push(`Segment ${i + 1}: ${sec.error.replace(/^Section: /, '')}`);
    const Eown = parseNum(r.E);
    if (Eown !== null && !(Eown > 0)) errors.push(`Segment ${i + 1}: E must be positive.`);
    return { L: (parseNum(r.length) ?? 0) * t.length.f, A: sec.props?.A ?? null, E: Eown !== null ? Eown * t.modulus.f : mat.E };
  });
  const pointLoads = [];
  (m.pointLoads || []).forEach((r, i) => {
    if (r.x === '' && r.Fx === '') return;
    if (parseNum(r.x) === null) errors.push(`Point load ${i + 1}: enter a position.`);
    pointLoads.push({ x: (parseNum(r.x) ?? 0) * t.length.f, Fx: (parseNum(r.Fx) ?? 0) * t.force.f });
  });
  const distLoads = [];
  (m.distLoads || []).forEach((r, i) => {
    if ([r.x1, r.x2, r.w1, r.w2].every((v) => v === '' || v === undefined)) return;
    for (const [k, what] of [['x1', 'a start position'], ['x2', 'an end position'], ['w1', 'a load value']]) if (parseNum(r[k]) === null) errors.push(`Distributed load ${i + 1}: enter ${what}.`);
    if (r.profile === 'linear' && parseNum(r.w2) === null) errors.push(`Distributed load ${i + 1}: enter an end value.`);
    const w1 = (parseNum(r.w1) ?? 0) * t.distForce.f;
    distLoads.push({ x1: (parseNum(r.x1) ?? 0) * t.length.f, x2: (parseNum(r.x2) ?? 0) * t.length.f, w1, w2: r.profile === 'linear' ? (parseNum(r.w2) ?? 0) * t.distForce.f : w1 });
  });
  return { input: { segments, fixedLeft: m.left === 'fixed', fixedRight: m.right === 'fixed', pointLoads, distLoads }, material: mat, errors };
}

// ---------------------------------------------------------------------------
function renderSetup() {
  const title = h('input', { id: 'bar-title', type: 'text', value: model.title ?? '', style: 'width: 13.5em', onInput: () => { model.title = title.value; save(); } });
  const end = (key, label) => {
    const sel = h('select', { id: `bar-${key}` }, ['fixed', 'free'].map((v) => h('option', { value: v, text: v === 'fixed' ? 'Fixed' : 'Free', selected: model[key] === v })));
    sel.addEventListener('change', () => { model[key] = sel.value; touch(); });
    return h('div', { class: 'field' }, h('label', { for: `bar-${key}`, text: label }), sel);
  };
  clear($('bar-setup')).append(
    h('div', { class: 'field' }, h('label', { for: 'bar-title', text: 'Name' }), title),
    end('left', 'Left end'), end('right', 'Right end'),
    pick('bar-pick-material', 'Material', materialSummary(model.units, model.material), () => openMaterialDialog({ units: model.units, material: model.material, show: ['E', 'nu', 'Sy', 'Sut'],
      note: 'E gives strain and displacement; Sy gives the factor of safety. A segment can override E in the table.',
      onApply: (mat) => { model.material = mat; touch(); renderSetup(); } })),
    pick('bar-pick-units', 'Units', `${model.units.force} · ${model.units.length} · ${model.units.stress}`, () => openUnitsDialog({ units: model.units, onApply: applyUnits })),
    h('div', { class: 'grow' }),
    h('button', { id: 'bar-solve', class: 'btn primary solve', type: 'button', onClick: () => solve(), text: 'Solve' }));
}

function renderTables() {
  const u = U(), ch = (structural) => touch(structural === true);
  const areaText = (row) => { const sec = sectionSI(model.units, row.section); return sec.props?.A ? `${fmt(sec.props.A / u.area.f, 4)} ${u.area.label}` : '—'; };
  clear($('bar-tables')).append(
    tablePanel({
      id: 'bar-segments', title: 'Segments', hint: 'Left to right along x', addLabel: 'Add segment', minRows: 1, changed: ch,
      heads: [th('Length', u.length.label), th('Cross-section'), th('Area'), th('E', u.modulus.label)],
      rows: model.segments,
      rowCells: (row, i) => [numCell('bar-seg', row, i, 'length', 'Segment length', ch),
        h('td', {}, h('button', { id: `bar-seg-${i}-section`, class: 'btn small', type: 'button', text: sectionSummary(model.units, row.section),
          onClick: () => openSectionDialog({ units: model.units, section: row.section, need: 'area', title: `Cross-section of segment ${i + 1}`,
            onApply: (sec) => { row.section = sec; touch(true); } }) })),
        h('td', { class: 'detail num', text: areaText(row) }),
        numCell('bar-seg', row, i, 'E', 'Elastic modulus', ch, { placeholder: 'material' })],
      onAdd: () => { const last = model.segments[model.segments.length - 1]; model.segments.push({ length: '', section: structuredClone(last.section), E: last.E }); },
      empty: '',
      note: 'Leave E blank to use the material chosen above. Type a value to give a segment a different material.',
    }),
    tablePanel({
      id: 'bar-pointLoads', title: 'Point loads', hint: 'Axial force at x', addLabel: 'Add point load', changed: ch,
      heads: [th('x', u.length.label), th('Fx', u.force.label)],
      rows: model.pointLoads,
      rowCells: (row, i) => [numCell('bar-pl', row, i, 'x', 'Position x', ch), numCell('bar-pl', row, i, 'Fx', 'Force Fx', ch)],
      onAdd: () => model.pointLoads.push({ x: '', Fx: '' }),
      empty: 'No point loads.',
      note: 'x is measured from the left end. A positive Fx points to the right (+x).',
    }),
    tablePanel({
      id: 'bar-distLoads', title: 'Distributed loads', hint: 'Axial load per unit length', addLabel: 'Add distributed load', changed: ch,
      heads: [th('Profile'), th('x start', u.length.label), th('x end', u.length.label), th('w start', u.distForce.label), th('w end', u.distForce.label)],
      rows: model.distLoads,
      rowCells: (row, i) => [selectCell('bar-dl', row, i, 'profile', { uniform: 'Uniform', linear: 'Linear' }, 'Profile', ch),
        numCell('bar-dl', row, i, 'x1', 'Start position', ch), numCell('bar-dl', row, i, 'x2', 'End position', ch), numCell('bar-dl', row, i, 'w1', 'Load at start', ch),
        row.profile === 'linear' ? numCell('bar-dl', row, i, 'w2', 'Load at end', ch) : h('td', { class: 'detail', text: 'same' })],
      onAdd: () => model.distLoads.push({ profile: 'uniform', x1: '', x2: '', w1: '', w2: '' }),
      empty: 'No distributed loads.',
    }));
}

// ---------------------------------------------------------------------------
function arrow(g, x1, y1, x2, y2, cls) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  g.append(s('line', { class: cls, x1, y1, x2: x2 - ux * 6, y2: y2 - uy * 6 }),
    s('polygon', { class: `${cls}-fill`, points: `${x2},${y2} ${x2 - ux * 9 - uy * 4},${y2 - uy * 9 + ux * 4} ${x2 - ux * 9 + uy * 4},${y2 - uy * 9 - ux * 4}` }));
}

function drawView() {
  const host = $('bar-view'), W = Math.max(320, Math.floor(host.clientWidth || 640)), H = 210, Y0 = 92, MX = Math.min(100, Math.max(56, W * 0.16));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'The bar with its segments, supports and loads' });
  clear(host).append(svg);
  const u = U();
  const lens = model.segments.map((r) => parseNum(r.length));
  if (lens.some((v) => !(v > 0))) { svg.append(s('text', { x: W / 2, y: Y0, 'text-anchor': 'middle', text: 'Enter a length for every segment to draw the bar.' })); return; }
  const L = lens.reduce((a, b) => a + b, 0), px = (x) => MX + (x / L) * (W - 2 * MX);
  const areas = model.segments.map((r) => sectionSI(model.units, r.section).props?.A ?? 0), aMax = Math.max(...areas, 1e-300);
  let x = 0;
  const ticks = [0];
  model.segments.forEach((r, i) => {
    const half = areas[i] > 0 ? Math.max(7, 26 * Math.sqrt(areas[i] / aMax)) : 7;
    svg.append(s('rect', { class: areas[i] > 0 ? 'beam' : 'sup-off', x: px(x), y: Y0 - half, width: px(x + lens[i]) - px(x), height: 2 * half }));
    svg.append(s('text', { class: 't-dim', x: (px(x) + px(x + lens[i])) / 2, y: Y0 + half + 14, 'text-anchor': 'middle', text: `${i + 1}` }));
    x += lens[i]; ticks.push(x);
  });
  for (const [key, X, side] of [['left', px(0), -1], ['right', px(L), 1]]) {
    if (model[key] !== 'fixed') continue;
    svg.append(s('line', { class: 'sup-line', x1: X, x2: X, y1: Y0 - 38, y2: Y0 + 38, 'stroke-width': 2.5 }));
    for (let y = Y0 - 36; y <= Y0 + 36; y += 7) svg.append(s('line', { class: 'hatch', x1: X, y1: y, x2: X + side * 8, y2: y + 6 }));
  }
  const on = (v) => v !== null && v >= 0 && v <= L * (1 + 1e-9);
  model.distLoads.forEach((q) => {
    const a = parseNum(q.x1), b = parseNum(q.x2), w1 = parseNum(q.w1);
    if (!on(a) || !on(b) || !(b > a) || w1 === null) return;
    const w2 = q.profile === 'linear' ? parseNum(q.w2) ?? 0 : w1, y = Y0 - 40;
    svg.append(s('polyline', { class: 'ld', points: `${px(a)},${y + 5} ${px(a)},${y} ${px(b)},${y} ${px(b)},${y + 5}` }));
    const n = Math.max(2, Math.round((px(b) - px(a)) / 46)), dir = Math.sign(w1 + w2) || 1;
    for (let k = 0; k < n; k++) { const c = px(a) + (px(b) - px(a)) * (k + 0.5) / n; arrow(svg, c - dir * 12, y - 8, c + dir * 12, y - 8, 'ld'); }
    svg.append(s('text', { x: (px(a) + px(b)) / 2, y: y - 18, 'text-anchor': 'middle', text: `${fmt(Math.abs(w1), 4)}${w2 !== w1 ? ` to ${fmt(Math.abs(w2), 4)}` : ''} ${u.distForce.label}` }));
    ticks.push(a, b);
  });
  let lane = 0;
  model.pointLoads.forEach((p) => {
    const xv = parseNum(p.x), F = parseNum(p.Fx) || 0;
    if (!on(xv) || F === 0) return;
    const X = px(xv), y = Y0 + 44 + (lane++ % 2) * 20;
    svg.append(s('line', { class: 'dim', x1: X, x2: X, y1: Y0, y2: y }));
    arrow(svg, X, y, X + Math.sign(F) * 36, y, 'ld');        // drawn from the point of application, in the direction it acts
    svg.append(s('text', { class: 't-strong', x: X + Math.sign(F) * 42, y: y + 4, 'text-anchor': F > 0 ? 'start' : 'end', text: `${fmt(Math.abs(F), 4)} ${u.force.label}` }));
    ticks.push(xv);
  });
  if (solved && !stale) {
    for (const [val, X, side] of [[solved.result.reactions.left, px(0), -1], [solved.result.reactions.right, px(L), 1]]) {
      if (val === null) continue;
      const R = val / u.force.f, y = Y0 - 52;
      if (Math.abs(R) > 1e-12) { if (R > 0) arrow(svg, X + side * 30 - 18, y, X + side * 30 + 18, y, 'rx'); else arrow(svg, X + side * 30 + 18, y, X + side * 30 - 18, y, 'rx'); }
      svg.append(s('text', { class: 't-strong', x: X + side * 30, y: y - 9, 'text-anchor': 'middle', text: `${fmt(Math.abs(R), 4)} ${u.force.label}` }));
    }
  }
  const yd = H - 26, labelled = [];
  svg.append(s('line', { class: 'dim', x1: MX, x2: W - MX, y1: yd, y2: yd }));
  for (const t of [0, L, ...[...new Set(ticks.map((v) => +v.toPrecision(10)))].sort((a, b) => a - b)]) {
    const X = px(t);
    svg.append(s('line', { class: 'dim', x1: X, x2: X, y1: yd - 4, y2: yd + 4 }));
    if (labelled.some((q) => Math.abs(q - X) < 34)) continue;
    labelled.push(X);
    svg.append(s('text', { class: 't-dim', x: X, y: yd + 16, 'text-anchor': 'middle', text: fmt(t, 4) }));
  }
  svg.append(s('text', { class: 't-dim', x: W - MX + 8, y: yd + 4, text: u.length.label }));
}

// ---------------------------------------------------------------------------
function solve(quiet = false) {
  const box = clear($('bar-messages'));
  const { input, material, errors } = barInput(model);
  if (errors.length) { if (!quiet) showMessages(box, 'error', 'Fix these before solving:', errors); return; }
  const result = solveBarModel(input);
  if (!result.ok) { if (!quiet) showMessages(box, 'error', 'The bar cannot be solved yet:', result.errors); return; }
  solved = { result, material };
  stale = false;
  const notes = [...result.warnings];
  if (result.segments.some((sg) => sg.sigma < 0)) notes.push('Part of this bar is in compression. This calculator does not check buckling; use the Column analysis for that.');
  showMessages(box, 'note', null, notes);
  renderResults();
  drawView();
}

function renderResults() {
  $('bar-results').classList.toggle('stale', !!solved && stale);
  const body = clear($('bar-results-body'));
  if (!solved) {
    body.append(h('div', { class: 'empty-state' }, h('p', { text: 'Set up the bar on the left, then press Solve to see the axial force, stress, strain and displacement.' }),
      h('button', { class: 'btn', type: 'button', text: 'Solve', onClick: () => solve() })));
    return;
  }
  const u = U(), r = solved.result, X = r.x.map((v) => v / u.length.f);
  const plots = h('div', { class: 'plots', id: 'bar-plots' });
  body.append(plots);
  const list = [{ title: 'Axial force N', symbol: 'N', unit: u.force.label, y: r.N.map((v) => v / u.force.f) },
    { title: 'Normal stress σ', symbol: 'σ', unit: u.stress.label, y: r.sigma.map((v) => v / u.stress.f) }];
  if (r.strain) list.push({ title: 'Strain ε', symbol: 'ε', unit: 'με', y: r.strain.map((v) => v * 1e6) },
    { title: 'Displacement u', symbol: 'u', unit: u.deflection.label, y: r.u.map((v) => v / u.deflection.f) });
  renderPlotGroup(plots, { x: X, xUnit: u.length.label, marks: r.bounds.slice(1, -1).map((v) => v / u.length.f), plots: list });

  const cell = (v, sig = 5) => h('td', { text: fmt(v, sig) });
  const Sy = solved.material?.Sy;
  const reactRow = (name, v) => (v === null ? null : h('tr', {}, h('td', { text: name }), cell(v / u.force.f)));
  const reactions = h('section', {}, h('h3', { text: 'Reactions' }),
    h('table', { class: 'data' }, h('thead', {}, h('tr', {}, th('End'), th('Force on the bar', u.force.label))),
      h('tbody', {}, reactRow('Left', r.reactions.left), reactRow('Right', r.reactions.right))),
    h('p', { class: Math.abs(r.checks.N) < 1e-7 * Math.max(r.extremes.N.abs, 1e-300) ? 'check-ok' : 'check-bad',
      text: Math.abs(r.checks.N) < 1e-7 * Math.max(r.extremes.N.abs, 1e-300) ? 'Equilibrium check passed.' : 'Equilibrium check failed. Please report this model.' }),
    r.elongation !== null ? h('p', { class: 'table-note' }, 'Total change in length: ', h('b', { class: 'num', text: `${fmt(r.elongation / u.deflection.f, 5)} ${u.deflection.label}` })) : null);
  const segRows = r.segments.map((sg, i) => h('tr', {}, h('td', { text: `${i + 1}` }),
    h('td', { text: Math.abs(sg.N1 - sg.N2) < 1e-9 * Math.max(Math.abs(sg.N1), Math.abs(sg.N2), 1e-300) ? fmt(sg.N1 / u.force.f, 5) : `${fmt(sg.N1 / u.force.f, 4)} to ${fmt(sg.N2 / u.force.f, 4)}` }),
    cell(sg.sigma / u.stress.f), sg.strain === null ? h('td', { class: 'muted', text: '—' }) : cell(sg.strain * 1e6),
    sg.elongation === null ? h('td', { class: 'muted', text: '—' }) : cell(sg.elongation / u.deflection.f),
    Sy && sg.sigma !== 0 ? cell(Sy / Math.abs(sg.sigma), 4) : h('td', { class: 'muted', text: '—' })));
  const segments = h('section', { class: 'full' }, h('h3', { text: 'Segments' }),
    h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('Segment'), th('N', u.force.label), th('σ (largest)', u.stress.label), th('ε', 'με'), th('Change in length', u.deflection.label), th('n = Sy / |σ|'))),
      h('tbody', {}, segRows))),
    h('p', { class: 'table-note', text: Sy ? 'Tension is positive. The factor of safety compares the largest stress in each segment with the yield strength, in tension or compression.'
      : 'Tension is positive. Enter a yield strength Sy in Material to get a factor of safety.' }));
  body.append(h('div', { class: 'tables' }, segments, reactions));
}

function resultsCsv() {
  const u = U(), r = solved.result;
  const cols = [['x', u.length.label, r.x, u.length.f], ['N', u.force.label, r.N, u.force.f], ['sigma', u.stress.label, r.sigma, u.stress.f]];
  if (r.strain) cols.push(['strain', 'microstrain', r.strain, 1e-6], ['u', u.deflection.label, r.u, u.deflection.f]);
  const lines = [cols.map(([n, un]) => `${n} (${un})`).join(',')];
  r.x.forEach((_, i) => lines.push(cols.map(([, , arr, f]) => +(arr[i] / f).toPrecision(8)).join(',')));
  return lines.join('\n');
}

function applyUnits(units, mode) {
  if (mode === 'convert') {
    const from = model.units, cv = (v, kind) => convert(parseNum(v) ?? '', kind, from, units);
    model = { ...model, units: { ...units }, material: convertMaterial(model.material, from, units),
      segments: model.segments.map((r) => ({ ...r, length: cv(r.length, 'length'), E: cv(r.E, 'modulus'), section: convertSection(r.section, from, units) })),
      pointLoads: model.pointLoads.map((r) => ({ ...r, x: cv(r.x, 'length'), Fx: cv(r.Fx, 'force') })),
      distLoads: model.distLoads.map((r) => ({ ...r, x1: cv(r.x1, 'length'), x2: cv(r.x2, 'length'), w1: cv(r.w1, 'distForce'), w2: cv(r.w2, 'distForce') })) };
    save(); renderSetup(); renderTables(); drawView(); renderResults();
  } else { model.units = { ...units }; renderSetup(); touch(true); renderResults(); }
}

function loadModel(m, autoSolve) {
  model = m; solved = null; stale = true; save();
  clear($('bar-messages'));
  renderSetup(); renderTables();
  if (autoSolve) solve(); else { renderResults(); drawView(); }
}

function helpContent() {
  const li = (t) => h('li', { text: t });
  return h('div', { class: 'help' },
    h('h3', { text: 'What it solves' }),
    h('ul', {}, li('A straight bar along x that carries axial load only. It can be stepped: each segment has its own area and, if you wish, its own E.'),
      li('The bar is held at its left end, its right end, or both. With both ends fixed the reactions depend on the stiffness EA/L of each segment.')),
    h('h3', { text: 'Signs' }),
    h('ul', {}, li('Forces are positive along +x, to the right. x is measured from the left end.'),
      li('Axial force N, stress σ and strain ε are positive in tension.'),
      li('Displacement u is positive to the right. A reaction is the force the wall applies to the bar.')),
    h('h3', { text: 'Formulas (Shigley, Secs. 3-9 and 4-3)' }),
    h('ul', {}, li('σ = N / A,  ε = σ / E,  change in length of a segment with constant force = N L / (A E).'),
      li('Factor of safety against yielding: n = Sy / |σ|.')),
    h('h3', { text: 'Limits' }),
    h('ul', {}, li('Stress is the average over the cross-section. Stress concentration at the steps is not included.'),
      li('Buckling of compressed segments is not checked here; use the Column analysis.'), li('No temperature change.')));
}

export const bar = {
  id: 'bar', label: 'Bar', helpTitle: 'Bar: signs and theory',
  examples: BAR_EXAMPLES.map((ex) => ({ title: ex.title, load: () => loadModel(normalize(structuredClone(ex)), true) })),
  init() {
    renderSetup(); renderTables(); solve(true);
    if (!solved) { renderResults(); drawView(); }
    let timer = 0, last = 0;
    new ResizeObserver(() => {
      const w = $('bar-view').clientWidth;
      if (!w || w === last) return;
      last = w; clearTimeout(timer);
      timer = setTimeout(() => { drawView(); if (solved) renderResults(); }, 120);
    }).observe($('bar-view'));
  },
  show() { drawView(); if (solved) renderResults(); },
  newModel() { loadModel(emptyBar(model.units), false); },
  saveText: () => JSON.stringify(model, null, 2),
  openText(text) { const m = parseSaved(text, 'bar'); if (!m) return false; loadModel(normalize(m), false); return true; },
  csv: () => (solved && !stale ? resultsCsv() : null),
  fileName: (ext) => `${fileSlug(model.title, 'bar')}.${ext}`,
  help: helpContent,
};
