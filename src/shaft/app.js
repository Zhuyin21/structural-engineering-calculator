// Shaft page: a rotating shaft on two bearings, checked for fatigue and
// first-cycle yield at every shoulder and component (Shigley, Chapter 7).
import { h, s, clear } from '../ui/dom.js';
import { renderPlotGroup } from '../ui/plot.js';
import { tablePanel, numCell, selectCell, th, pick } from '../ui/tables.js';
import { unitTable, fmt } from '../core/units.js';
import { parseNum, materialSummary } from '../core/inputs.js';
import { openMaterialDialog, openUnitsDialog, parseSaved, fileSlug, showMessages } from '../ui/dialogs.js';
import { solveShaft, COMPONENTS, CRITERIA, FINISHES, RELIABILITY, TABLE_7_1 } from './solver.js';
import {
  emptyShaft, emptyShoulder, emptyElement, normalizeShaft, shaftInput, convertShaft, joints, loadRows, usesUS, SHAFT_EXAMPLES, LOAD_KEYS,
} from './model.js';

const STORE_KEY = 'sec.shaft.model.v1';
const $ = (id) => document.getElementById(id);

let model = loadSaved() ?? structuredClone(SHAFT_EXAMPLES[0]);
let solved = null, stale = true, tab = 'xy';
const panels = {};
const U = () => unitTable(model.units);

function loadSaved() {
  try { const m = JSON.parse(localStorage.getItem(STORE_KEY)); return m && m.version === 1 ? normalizeShaft(m) : null; } catch { return null; }
}
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(model)); } catch { /* optional */ } };

/** The model changed: mark the results stale and redraw. `redo` lists the input panels to rebuild. */
function touch(redo = []) {
  stale = true; save();
  $('shaft-results').classList.toggle('stale', !!solved);
  clear($('shaft-messages'));
  for (const key of redo) renderPanel(key);
  drawViews();
}

// ---------------------------------------------------------------------------
// Setup strip
// ---------------------------------------------------------------------------
function renderSetup() {
  const u = U();
  const title = h('input', { id: 'shaft-title', type: 'text', value: model.title ?? '', style: 'width: 13.5em', onInput: () => { model.title = title.value; save(); } });
  const mode = h('select', { id: 'shaft-mode' }, [['stepped', 'Stepped, solid'], ['uniform', 'Uniform diameter']].map(([v, t]) => h('option', { value: v, text: t, selected: model.mode === v })));
  mode.addEventListener('change', () => { model.mode = mode.value; solved = null; renderSetup(); renderTables(); touch(); renderResults(); });
  const od = h('input', { id: 'shaft-od', class: 'num-in', type: 'text', inputMode: 'decimal', value: model.od ?? '', style: 'width: 6em' });
  od.addEventListener('input', () => { model.od = od.value.trim(); od.classList.toggle('bad', od.value.trim() !== '' && parseNum(od.value) === null); touch(); });
  clear($('shaft-setup')).append(...[
    h('div', { class: 'field' }, h('label', { for: 'shaft-title', text: 'Name' }), title),
    h('div', { class: 'field' }, h('label', { for: 'shaft-mode', text: 'Shaft' }), mode),
    model.mode === 'uniform' ? h('div', { class: 'field' }, h('label', { for: 'shaft-od', text: 'Outer diameter' }), h('div', { class: 'with-unit' }, od, h('span', { class: 'unit', text: u.dim.label }))) : null,
    pick('shaft-pick-material', 'Material', materialSummary(model.units, model.material), () => openMaterialDialog({ units: model.units, material: model.material, show: ['E', 'G', 'Sy', 'Sut'],
      note: 'Sut sets the endurance limit and the notch sensitivity, Sy the first-cycle yield check, E the deflections and G the twist. The fatigue data are for steels.',
      onApply: (mat) => { model.material = mat; touch(); renderSetup(); } })),
    pick('shaft-pick-units', 'Units', `${model.units.force} · ${model.units.length} · ${model.units.stress}`, () => openUnitsDialog({ units: model.units, onApply: applyUnits })),
    h('div', { class: 'grow' }),
    h('button', { id: 'shaft-solve', class: 'btn primary solve', type: 'button', onClick: () => solve(), text: 'Solve' })].filter(Boolean));
}

// ---------------------------------------------------------------------------
// Input panels
// ---------------------------------------------------------------------------
/** A panel whose rows follow from other tables, so it has no add or delete buttons. */
function fixedPanel({ id, title, hint, heads, rows, empty, note }) {
  return h('section', { class: 'panel', id },
    h('div', { class: 'panel-head' }, h('h2', { text: title }), h('span', { class: 'hint', text: hint })),
    h('div', { class: 'panel-body' },
      h('div', { class: 'scroll-x' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, heads)),
        h('tbody', {}, rows.length ? rows : h('tr', { class: 'empty-row' }, h('td', { colSpan: heads.length, text: empty }))))),
      note ? h('p', { class: 'table-note', text: note }) : null));
}
const TYPES_STEPPED = { none: 'Nothing', bearing: 'Bearing', gear: 'Gear', pulley: 'Pulley', sprocket: 'Sprocket' };
const TYPES_UNIFORM = Object.fromEntries(Object.entries(COMPONENTS).map(([k, v]) => [k, v.label]));

function buildPanel(key) {
  const u = U();
  if (key === 'sections') {
    return tablePanel({
      id: 'shaft-sections', title: 'Sections', hint: 'Left to right along x', addLabel: 'Add section', minRows: 2,
      changed: (structural) => (structural ? (renderTables(), touch()) : touch(['shoulders', 'loads'])),
      heads: [th('Length', u.length.label), th('Diameter', u.dim.label)],
      rows: model.sections,
      rowCells: (row, i) => [numCell('shaft-sec', row, i, 'length', 'Section length', () => touch(['shoulders', 'loads'])),
        numCell('shaft-sec', row, i, 'd', 'Section diameter', () => touch(['shoulders', 'loads']))],
      onAdd: () => model.sections.push({ length: '', d: '', sh: emptyShoulder() }),
      empty: '',
      note: 'A stepped shaft is solid. Every change of diameter is a shoulder, listed below.',
    });
  }
  if (key === 'shoulders') {
    const two = (top, under) => h('td', { class: 'derived num' }, top, under ? h('span', { class: 'unit', text: under }) : null);
    const rows = joints(model).map((j) => {
      const sh = j.sh, i = j.i, step = j.d === null ? (j.da > 0 && j.db > 0 ? 'no step' : '') : `${fmt(j.da, 4)} → ${fmt(j.db, 4)}`;
      const cells = [h('td', { class: 'idx', text: i + 1 }), two(j.x === null ? '—' : fmt(j.x, 5), step),
        selectCell('shaft-sh', sh, i, 'type', TYPES_STEPPED, 'What sits against the shoulder', () => touch(['shoulders', 'loads']))];
      if (sh.type === 'none') cells.push(numCell('shaft-sh', sh, i, 'r', 'Fillet radius', () => touch()), two('—'), two('—'));
      else {
        const rd = COMPONENTS[sh.type].rd;
        cells.push(two(j.d === null ? '—' : fmt(rd * j.d, 3), `${rd} d`),
          numCell('shaft-sh', sh, i, 'width', 'Width of the component', () => touch(['loads']), { placeholder: '0' }),
          sh.type === 'bearing' ? two('—') : selectCell('shaft-sh', sh, i, 'key', { none: 'None', endmill: 'End-mill' }, 'Keyseat', () => touch()));
      }
      return h('tr', {}, cells);
    });
    return fixedPanel({
      id: 'shaft-shoulders', title: 'Shoulders', hint: 'What sits against each one',
      heads: [h('th', {}), th('x, step', `${u.length.label}, ${u.dim.label}`), th('Sits here'), th('Fillet r', u.dim.label), th('Width', u.length.label), th('Keyseat')],
      rows, empty: 'Add a second section to make a shoulder.',
      note: 'A bearing, gear, pulley or sprocket sits on the smaller diameter, against the shoulder. Its load acts at the middle of its width; with the width blank it acts at the shoulder. Bearing seats use r/d = 0.02; gear, pulley and sprocket seats use r/d = 0.1. For a bare shoulder, type its fillet radius.',
    });
  }
  if (key === 'segments') {
    return tablePanel({
      id: 'shaft-segments', title: 'Segments', hint: 'Solid or hollow, left to right', addLabel: 'Add segment', minRows: 1,
      changed: (structural) => (structural ? (renderTables(), touch()) : touch()),
      heads: [th('Length', u.length.label), th('Wall thickness', u.dim.label)],
      rows: model.segments,
      rowCells: (row, i) => [numCell('shaft-seg', row, i, 'length', 'Segment length', () => touch()), numCell('shaft-seg', row, i, 'wall', 'Wall thickness', () => touch(), { placeholder: 'solid' })],
      onAdd: () => model.segments.push({ length: '', wall: '' }),
      empty: '',
      note: 'Leave the wall thickness blank for a solid segment. The outer diameter is the same along the whole shaft, so there is no stress concentration.',
    });
  }
  if (key === 'elements') {
    return tablePanel({
      id: 'shaft-elements', title: 'Bearings and components', hint: 'Where each one sits', addLabel: 'Add component',
      changed: (structural) => (structural ? (renderTables(), touch()) : touch(['loads'])),
      heads: [th('x', u.length.label), th('Type')],
      rows: model.elements,
      rowCells: (row, i) => [numCell('shaft-el', row, i, 'x', 'Position x', () => touch(['loads'])), selectCell('shaft-el', row, i, 'type', TYPES_UNIFORM, 'Component type', () => { renderTables(); touch(); })],
      onAdd: () => model.elements.push(emptyElement()),
      empty: 'Add two bearings and at least one loaded component.',
      note: 'x is measured from the left end. The shaft needs exactly two bearings.',
    });
  }
  if (key === 'loads') {
    const rows = loadRows(model).map((r, i) => h('tr', {},
      h('td', { class: 'derived' }, COMPONENTS[r.type].label, h('span', { class: 'unit', text: model.mode === 'uniform' ? `component ${r.n}` : `shoulder ${r.n}` })),
      LOAD_KEYS.map((k) => numCell('shaft-load', r.row, i, k, `${k} on the ${COMPONENTS[r.type].label.toLowerCase()}`, () => touch(), { placeholder: '0' }))));
    return fixedPanel({
      id: 'shaft-loads', title: 'Loads', hint: 'On each component',
      heads: [th('Component'), th('Fy', u.force.label), th('Fz', u.force.label), th('T', u.moment.label), th('My', u.moment.label), th('Mz', u.moment.label)],
      rows, empty: model.mode === 'uniform' ? 'Add a gear, pulley, sprocket or load point to give it loads.' : 'Seat a gear, pulley or sprocket against a shoulder to give it loads.',
      note: 'Fy and Fz act along +y and +z. T is a torque about x; My and Mz are couples about y and z (right-hand rule). A blank cell is zero. The torques must add up to zero.',
    });
  }
  // fatigue settings
  const field = (id, k, label, options) => {
    const sel = h('select', { id }, Object.entries(options).map(([value, text]) => h('option', { value, text, selected: String(model[k]) === value })));
    sel.addEventListener('change', () => { model[k] = sel.value; touch(); });
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), sel);
  };
  return h('section', { class: 'panel', id: 'shaft-fatigue' },
    h('div', { class: 'panel-head' }, h('h2', { text: 'Fatigue' }), h('span', { class: 'hint', text: 'Shigley Chapters 6 and 7' })),
    h('div', { class: 'panel-body stack' },
      h('div', { class: 'form-grid' },
        field('shaft-criterion', 'criterion', 'Failure criterion', CRITERIA),
        field('shaft-finish', 'finish', 'Surface finish', Object.fromEntries(Object.entries(FINISHES).map(([k, v]) => [k, v.label]))),
        field('shaft-reliability', 'reliability', 'Reliability', Object.fromEntries(Object.keys(RELIABILITY).sort((a, b) => a - b).map((k) => [k, `${k} %`])))),
      h('p', { class: 'table-note', text: 'The shaft rotates, so the bending moment is completely reversed and the torque is steady. The curve fits follow the stress unit: U.S. customary for psi and ksi, SI otherwise.' })));
}

const panelKeys = () => (model.mode === 'uniform' ? ['segments', 'elements', 'loads', 'fatigue'] : ['sections', 'shoulders', 'loads', 'fatigue']);
function renderPanel(key) {
  const el = buildPanel(key);
  if (panels[key]?.isConnected) panels[key].replaceWith(el);
  panels[key] = el;
}
function renderTables() {
  const host = clear($('shaft-tables'));
  for (const key of panelKeys()) { panels[key] = buildPanel(key); host.append(panels[key]); }
}

// ---------------------------------------------------------------------------
// Drawing: the shaft seen in each plane
// ---------------------------------------------------------------------------
/** Shaft outline and components in display units, or null while something is missing. */
function geometry() {
  const parts = [], comps = [];
  let x = 0;
  if (model.mode === 'uniform') {
    const d = parseNum(model.od);
    if (!(d > 0)) return null;
    for (const r of model.segments) {
      const len = parseNum(r.length), wall = parseNum(r.wall);
      if (!(len > 0)) return null;
      parts.push({ x0: x, x1: x + len, d, wall: wall > 0 && 2 * wall < d ? wall : 0 });
      x += len;
    }
    for (const e of model.elements) {
      const xe = parseNum(e.x);
      if (xe === null || xe < 0 || xe > x * (1 + 1e-9)) continue;
      comps.push({ type: e.type, x: xe, x0: xe, x1: xe, d, row: e });
    }
  } else {
    for (const r of model.sections) {
      const len = parseNum(r.length), d = parseNum(r.d);
      if (!(len > 0) || !(d > 0)) return null;
      parts.push({ x0: x, x1: x + len, d, wall: 0 });
      x += len;
    }
    for (const j of joints(model)) {
      if (j.sh.type === 'none' || j.d === null) continue;
      const w = Math.max(0, parseNum(j.sh.width) ?? 0), dir = j.small === j.i ? -1 : 1;
      comps.push({ type: j.sh.type, x: j.x + dir * w / 2, x0: Math.min(j.x, j.x + dir * w), x1: Math.max(j.x, j.x + dir * w), d: j.d, row: j.sh });
    }
  }
  return { L: x, parts, comps, dMax: Math.max(...parts.map((p) => p.d)) };
}

function arrow(g, x1, y1, x2, y2, cls) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  g.append(s('line', { class: cls, x1, y1, x2: x2 - ux * 6, y2: y2 - uy * 6 }),
    s('polygon', { class: `${cls}-fill`, points: `${x2},${y2} ${x2 - ux * 9 - uy * 4},${y2 - uy * 9 + ux * 4} ${x2 - ux * 9 + uy * 4},${y2 - uy * 9 - ux * 4}` }));
}

function drawPlane(plane) {
  const host = $(`shaft-view-${plane}`), W = Math.max(320, Math.floor(host.clientWidth || 640)), H = 206, Y0 = 94, MX = Math.min(64, Math.max(40, W * 0.08));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': `The shaft in the ${plane.toUpperCase()} plane with its bearings, components and loads` });
  clear(host).append(svg);
  const g = geometry();
  if (!g) { svg.append(s('text', { x: W / 2, y: Y0, 'text-anchor': 'middle', text: model.mode === 'uniform' ? 'Enter the outer diameter and the segment lengths to draw the shaft.' : 'Enter a length and a diameter for every section to draw the shaft.' })); return; }
  const u = U(), px = (x) => MX + (x / g.L) * (W - 2 * MX), R = (d) => Math.max(5, 24 * d / g.dMax);
  const up = plane === 'xy' ? 1 : -1;                    // +y is up the page, +z is down it
  const fKey = plane === 'xy' ? 'Fy' : 'Fz', mKey = plane === 'xy' ? 'Mz' : 'My';

  // components behind the shaft, then the shaft, then the bearings on top
  const boxes = g.comps.map((c) => {
    const half = Math.max(7, (px(c.x1) - px(c.x0)) / 2), cx = (px(c.x0) + px(c.x1)) / 2, r = R(c.d);
    return { ...c, cx, left: cx - half, right: cx + half, r, top: r + (c.type === 'bearing' ? 13 : c.type === 'load' ? 0 : 14) };
  });
  for (const b of boxes) if (b.type !== 'bearing' && b.type !== 'load') svg.append(s('rect', { class: 'shaft-comp', x: b.left, y: Y0 - b.top, width: b.right - b.left, height: 2 * b.top, rx: 2 }));
  for (const p of g.parts) {
    const r = R(p.d);
    svg.append(s('rect', { class: 'beam', x: px(p.x0), y: Y0 - r, width: px(p.x1) - px(p.x0), height: 2 * r }));
    if (p.wall > 0) { const ri = r * (1 - 2 * p.wall / p.d); svg.append(s('rect', { class: 'shaft-bore', x: px(p.x0), y: Y0 - ri, width: px(p.x1) - px(p.x0), height: 2 * ri })); }
  }
  svg.append(s('line', { class: 'shaft-axis', x1: MX - 12, x2: W - MX + 12, y1: Y0, y2: Y0 }));
  let lastLabel = -Infinity;
  for (const b of boxes) {
    if (b.type === 'bearing') {
      for (const side of [-1, 1]) {
        const y = side < 0 ? Y0 - b.top : Y0 + b.r;
        svg.append(s('rect', { class: 'sup', x: b.left, y, width: b.right - b.left, height: 13 }),
          s('line', { class: 'sup-line', x1: b.left, y1: y, x2: b.right, y2: y + 13 }), s('line', { class: 'sup-line', x1: b.left, y1: y + 13, x2: b.right, y2: y }));
      }
    }
    else {       // a bearing is shown by its symbol; the other components are named, unless the name would run into the last one
      const text = COMPONENTS[b.type].label.replace('Load point', 'Load'), half = text.length * 3.4;
      if (b.cx - half > lastLabel + 4) { svg.append(s('text', { class: 't-dim', x: b.cx, y: Y0 - b.top - 5, 'text-anchor': 'middle', text })); lastLabel = b.cx + half; }
    }
  }

  // A force is drawn on the side it comes from, pointing at the part.
  const force = (b, value, cls, label) => {
    if (!value) return 0;
    const down = up * value < 0, X = b.cx;                // down the page
    if (down) { arrow(svg, X, Y0 - b.top - 42, X, Y0 - b.top - 17, cls); svg.append(s('text', { class: 't-strong', x: X, y: Y0 - b.top - 46, 'text-anchor': 'middle', text: label })); }
    else { arrow(svg, X, Y0 + b.top + 30, X, Y0 + b.top + 4, cls); svg.append(s('text', { class: 't-strong', x: X, y: Y0 + b.top + 42, 'text-anchor': 'middle', text: label })); }
    return down ? -1 : 1;
  };
  for (const b of boxes) {
    if (b.type === 'bearing') continue;
    const F = parseNum(b.row[fKey]) || 0, side = force(b, F, 'ld', `${fmt(Math.abs(F), 4)} ${u.force.label}`);
    const notes = [];
    const T = parseNum(b.row.T) || 0, C = parseNum(b.row[mKey]) || 0;
    if (T && plane === 'xy') notes.push(`T = ${fmt(T, 4)}`);
    if (C) notes.push(`${mKey} = ${fmt(C, 4)}`);
    if (notes.length) svg.append(s('text', { class: 't-load', x: b.cx, y: side === 1 || side === 0 ? Y0 - b.top - 18 : Y0 + b.top + 15, 'text-anchor': 'middle', text: notes.join(', ') }));
  }
  if (solved && !stale) {
    const r = solved.result;
    r.reactions.forEach((q) => {
      const b = boxes.filter((c) => c.type === 'bearing').reduce((a, c) => (!a || Math.abs(c.x * u.length.f - q.x) < Math.abs(a.x * u.length.f - q.x) ? c : a), null);
      const F = (plane === 'xy' ? q.Fy : q.Fz) / u.force.f;
      if (b && Math.abs(F) > 1e-9 * Math.max(...r.reactions.map((p) => p.radial / u.force.f), 1e-300)) force(b, F, 'rx', `${fmt(Math.abs(F), 4)} ${u.force.label}`);
    });
    const c = r.fatigue?.critical;
    if (c) svg.append(s('circle', { class: 'shaft-crit', cx: px(c.x / u.length.f), cy: Y0, r: 7 }));
  }

  // dimension line with the ends, the joints and the load lines
  const yd = H - 26, labelled = [];
  svg.append(s('line', { class: 'dim', x1: MX, x2: W - MX, y1: yd, y2: yd }));
  const inner = [...new Set([...g.parts.map((p) => p.x1), ...g.comps.map((c) => c.x)].map((v) => +v.toPrecision(10)))].sort((a, b) => a - b);
  for (const t of [0, g.L, ...inner.filter((v) => v > 0 && v < g.L)]) {     // the ends are labelled first, then whatever fits
    const X = px(t);
    svg.append(s('line', { class: 'dim', x1: X, x2: X, y1: yd - 4, y2: yd + 4 }));
    if (labelled.some((q) => Math.abs(q - X) < 34)) continue;
    labelled.push(X);
    svg.append(s('text', { class: 't-dim', x: X, y: yd + 16, 'text-anchor': 'middle', text: fmt(t, 4) }));
  }
  svg.append(s('text', { class: 't-dim', x: W - MX + 8, y: yd + 4, text: u.length.label }));
}
const drawViews = () => { drawPlane('xy'); drawPlane('xz'); };

// ---------------------------------------------------------------------------
// Solve and results
// ---------------------------------------------------------------------------
function solve(quiet = false) {
  const box = clear($('shaft-messages'));
  const { input, material, errors } = shaftInput(model);
  if (errors.length) { if (!quiet) showMessages(box, 'error', 'Fix these before solving:', [...new Set(errors)]); return; }
  const result = solveShaft(input);
  if (!result.ok) { if (!quiet) showMessages(box, 'error', 'The shaft cannot be solved yet:', result.errors); return; }
  solved = { result, material, us: input.us };
  stale = false;
  showMessages(box, 'note', null, [...result.warnings, ...result.notes]);
  renderResults();
  drawViews();
}

const Q = {
  Vy: { title: 'Shear force', sym: 'Vy', kind: 'force' },
  Mz: { title: 'Bending moment', sym: 'Mz', kind: 'moment' },
  slopeXY: { title: 'Slope', sym: 'dv/dx', kind: 'angle' },
  v: { title: 'Deflection', sym: 'v', kind: 'deflection' },
  Vz: { title: 'Shear force', sym: 'Vz', kind: 'force' },
  My: { title: 'Bending moment', sym: 'My', kind: 'moment' },
  slopeXZ: { title: 'Slope', sym: 'dw/dx', kind: 'angle', zDown: true },
  w: { title: 'Deflection', sym: 'w', kind: 'deflection', zDown: true },
  Mtotal: { title: 'Total bending moment', sym: 'M', kind: 'moment' },
  T: { title: 'Torque', sym: 'T', kind: 'moment' },
  deflection: { title: 'Total deflection', sym: 'δ', kind: 'deflection' },
  twist: { title: 'Angle of twist', sym: 'φ', kind: 'angle' },
};
const TABS = {
  xy: { label: 'Shaft Diagrams (XY)', keys: ['Vy', 'Mz', 'slopeXY', 'v'] },
  xz: { label: 'Shaft Diagrams (XZ)', keys: ['Vz', 'My', 'slopeXZ', 'w'] },
  combined: { label: '3D Shaft Diagrams', keys: ['Mtotal', 'T', 'deflection', 'twist'] },
};

function renderResults() {
  $('shaft-results').classList.toggle('stale', !!solved && stale);
  const body = clear($('shaft-results-body'));
  if (!solved) {
    body.append(h('div', { class: 'empty-state' }, h('p', { text: 'Lay out the shaft on the left, then press Solve to see the factor of safety at every shoulder and component, with the diagrams in each plane.' }),
      h('button', { class: 'btn', type: 'button', text: 'Solve', onClick: () => solve() })));
    return;
  }
  const u = U(), r = solved.result, f = r.fatigue;
  const peak = (k) => r.extremes[k]?.abs ?? 0;
  const scale = { force: Math.max(peak('Vy'), peak('Vz')), moment: Math.max(peak('Mtotal'), peak('T')), angle: Math.max(peak('slopeXY'), peak('slopeXZ'), peak('twist')), deflection: peak('deflection') };
  const shown = (v, kind) => (v === null || v === undefined ? null : Math.abs(v) <= 1e-9 * scale[kind] ? 0 : v / u[kind].f);
  const where = (loc) => `${loc.label} at x = ${fmt(loc.x / u.length.f, 4)} ${u.length.label}`;
  const safety = (n) => (n === null || n === undefined ? '—' : Number.isFinite(n) ? n.toFixed(2) : 'no load');

  // headline
  const big = (label, value, sub, bad) => h('div', {}, h('span', { text: label }), h('b', { class: `num${bad ? ' fail' : ''}`, text: value }), sub ? h('span', { text: sub }) : null);
  const tiles = [];
  if (f) {
    tiles.push(f.critical ? big(`Lowest fatigue factor of safety, ${CRITERIA[f.criterion]}`, `n = ${safety(f.critical.n)}`, where(f.critical), f.critical.n < 1)
      : big(`Fatigue factor of safety, ${CRITERIA[f.criterion]}`, '—', 'No location carries load.'));
    if (f.yieldCritical) tiles.push(big('Lowest first-cycle yield factor of safety', `ny = ${safety(f.yieldCritical.ny)}`, where(f.yieldCritical), f.yieldCritical.ny < 1));
  }
  tiles.push(big('Bearing loads (radial)', r.reactions.map((q) => fmt(q.radial / u.force.f, 4)).join('  ·  ') + ` ${u.force.label}`, `at x = ${r.reactions.map((q) => fmt(q.x / u.length.f, 4)).join(' and ')} ${u.length.label}`));
  if (r.extremes.deflection) tiles.push(big('Largest deflection', `${fmt(shown(r.extremes.deflection.abs, 'deflection'), 4)} ${u.deflection.label}`, `at x = ${fmt(r.extremes.deflection.x / u.length.f, 4)} ${u.length.label}`));
  body.append(h('div', { class: 'panel-body' }, h('div', { class: 'props headline', id: 'shaft-headline' }, tiles)));

  // diagrams
  const tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Diagram views' },
    Object.entries(TABS).map(([id, t]) => h('button', { id: `shaft-tab-${id}`, class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(tab === id), text: t.label,
      onClick: () => { tab = id; renderResults(); } })));
  const plots = h('div', { class: 'plots', id: 'shaft-plots' });
  body.append(tabBar, plots);
  const keys = TABS[tab].keys.filter((k) => r[k]);
  renderPlotGroup(plots, {
    x: r.x.map((v) => v / u.length.f), xUnit: u.length.label, marks: r.reactions.map((q) => q.x / u.length.f),
    plots: keys.map((k) => ({ title: `${Q[k].title} ${Q[k].sym}`, symbol: Q[k].sym, y: r[k].map((v) => shown(v, Q[k].kind)), invert: !!Q[k].zDown,
      unit: u[Q[k].kind].label + (Q[k].zDown ? ', +z down' : '') })),
  });
  if (!r.v && tab !== 'combined') plots.append(h('div', { class: 'plot-empty', text: 'Slope and deflection need the modulus E. Set it in Material and solve again.' }));

  // tables
  const cell = (v, sig = 4) => h('td', { text: fmt(v, sig) });
  const dash = () => h('td', { class: 'muted', text: '—' });
  const fix = (v, n = 2) => (v === null || v === undefined ? dash() : h('td', { text: v.toFixed(n) }));
  const tables = h('div', { class: 'tables' });
  if (f) {
    const mark = (loc) => (loc.flags?.length ? ' *' : '');
    const rows = r.locations.map((loc) => (loc.error
      ? h('tr', {}, h('td', { text: loc.label }), cell(loc.x / u.length.f), h('td', { class: 'muted', colSpan: 8, style: 'text-align: left', text: loc.error }))
      : h('tr', { class: loc.critical ? 'lowest' : null }, h('td', { text: loc.label + mark(loc) }), cell(loc.x / u.length.f),
        cell(shown(loc.M, 'moment')), cell(shown(loc.T, 'moment')), fix(loc.kb, 3), cell(loc.Se / u.stress.f),
        cell(loc.sigA / u.stress.f), cell(loc.sigM / u.stress.f),
        h('td', { class: loc.n < 1 ? 'fail' : null, text: safety(loc.n) }),
        h('td', { class: loc.ny !== null && loc.ny < 1 ? 'fail' : null, text: safety(loc.ny) }))));
    tables.append(h('section', { class: 'full', id: 'shaft-fatigue-table' }, h('h3', { text: 'Fatigue and first-cycle yield at every location' }),
      h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, th('Location'), th('x', u.length.label), th('M', u.moment.label), th('T', u.moment.label), th('kb'), th('Se', u.stress.label),
          th('\u03C3\u2032a', u.stress.label), th('\u03C3\u2032m', u.stress.label), th(`n, ${CRITERIA[f.criterion].replace('DE-', '')}`), th('ny'))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colSpan: 10, class: 'muted', text: 'Nothing to check.' }))))),
      h('p', { class: 'table-note', text: `${f.critical ? 'The shaded row has the lowest fatigue factor of safety. ' : ''}M is the total bending moment and alternates; T is steady. ` +
        `\u03C3\u2032a = Kf M c / I and \u03C3\u2032m = \u221A3 Kfs T c / J (Eqs. 7-4, 7-5). ` +
        `Se = ka kb ke S\u2032e with S\u2032e = ${fmt(f.SePrime / u.stress.f, 4)} ${u.stress.label}, ka = ${f.ka.toFixed(3)}, ke = ${f.ke.toFixed(3)}` +
        `${f.criterion === 'morrow' ? `; Morrow uses \u03C3\u2032f = ${fmt(f.sigF / u.stress.f, 4)} ${u.stress.label} (Eq. 6-44)` : ''}. ny = Sy / \u03C3\u2032max (Eqs. 7-15, 7-16).` +
        `${r.locations.some((l) => l.flags?.length) ? ' * see the note above the diagrams.' : ''}` })));

    const raised = r.locations.filter((l) => !l.error);
    tables.append(h('section', { class: 'full', id: 'shaft-kt-table' }, h('h3', { text: 'Stress concentration at each location' }),
      h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, th('Location'), th('x', u.length.label), th('d', u.dim.label), th('D/d'), th('r', u.dim.label), th('r/d'), th('Kt'), th('Kts'), th('q'), th('q shear'), th('Kf'), th('Kfs'))),
        h('tbody', {}, raised.map((loc) => h('tr', { class: loc.critical ? 'lowest' : null }, h('td', { text: loc.label + mark(loc) }), cell(loc.x / u.length.f), cell(loc.d / u.dim.f),
          loc.D ? fix(loc.D / loc.d, 3) : dash(), loc.r ? cell(loc.r / u.dim.f, 3) : dash(), loc.r ? fix(loc.r / loc.d, 3) : dash(),
          fix(loc.Kt), fix(loc.Kts), fix(loc.q), fix(loc.qs), fix(loc.Kf), fix(loc.Kfs)))))),
      h('p', { class: 'table-note', text: r.uniform ? 'A uniform shaft has no shoulders, so Kt = Kts = 1 everywhere. A hollow segment uses the I and J of the tube.'
        : `Shoulders: Kt from Figure A-15-9 and Kts from Figure A-15-8, read at r/d and D/d. Keyseats: the end-mill values of Table 7-1, Kt = ${TABLE_7_1.keyseat.Kt} and Kts = ${TABLE_7_1.keyseat.Kts.toFixed(1)}, with r = ${TABLE_7_1.keyseat.rd} d, checked under the middle of the component. Kf = 1 + q (Kt \u2212 1), with q from the notch radius and Sut (Eqs. 6-32 to 6-36).` })));
  }

  const balanced = Math.max(r.checks.V, r.checks.M, r.checks.T) < 1e-9;
  tables.append(h('section', { id: 'shaft-reactions' }, h('h3', { text: 'Bearing reactions' }),
    h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('x', u.length.label), th('Fy', u.force.label), th('Fz', u.force.label), th('Radial', u.force.label))),
      h('tbody', {}, r.reactions.map((q) => h('tr', {}, cell(q.x / u.length.f, 5), cell(shown(q.Fy, 'force'), 5), cell(shown(q.Fz, 'force'), 5), cell(q.radial / u.force.f, 5)))))),
    h('p', { class: balanced ? 'check-ok' : 'check-bad', text: balanced ? 'Check passed: forces, moments and torques balance.' : 'Equilibrium check failed. Please report this model.' })));
  if (r.v) {
    tables.append(h('section', { class: 'full', id: 'shaft-points' }, h('h3', { text: 'Slope and deflection at the bearings and components' }),
      h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, th('Location'), th('x', u.length.label), th('dv/dx', u.angle.label), th('dw/dx', u.angle.label), th('Slope, total', u.angle.label),
          th('v', u.deflection.label), th('w', u.deflection.label), th('Deflection, total', u.deflection.label))),
        h('tbody', {}, r.points.map((p) => h('tr', {}, h('td', { text: p.label }), cell(p.x / u.length.f),
          cell(shown(p.slopeXY, 'angle')), cell(shown(p.slopeXZ, 'angle')), cell(shown(p.slope, 'angle')), cell(shown(p.v, 'deflection')), cell(shown(p.w, 'deflection')), cell(shown(p.deflection, 'deflection'))))))),
      h('p', { class: 'table-note', text: 'Totals combine the two planes as vectors. Shigley Table 7-2 gives typical limits: slope at a deep-groove ball bearing 0.001 to 0.003 rad, at a cylindrical roller bearing 0.0008 to 0.0012 rad, at an uncrowned spur gear below 0.0005 rad. Shear deflection is not included.' })));
  }
  body.append(tables);
}

function resultsCsv() {
  const u = U(), r = solved.result;
  const cols = Object.keys(Q).filter((k) => r[k]).map((k) => [Q[k].sym, u[Q[k].kind].label, r[k], u[Q[k].kind].f]);
  cols.unshift(['x', u.length.label, r.x, u.length.f]);
  const lines = [cols.map(([n, un]) => `${n} (${un})`).join(',')];
  r.x.forEach((_, i) => lines.push(cols.map(([, , arr, f]) => +(arr[i] / f).toPrecision(8)).join(',')));
  return lines.join('\n');
}

function applyUnits(units, mode) {
  if (mode === 'convert') {
    // The curve fits follow the stress unit, so results can shift slightly; solve again.
    const keepFits = usesUS(model.units) === usesUS(units);
    model = convertShaft(model, model.units, units);
    save(); renderSetup(); renderTables();
    if (solved && !stale && keepFits) solve(true); else { stale = true; $('shaft-results').classList.toggle('stale', !!solved); }
    drawViews(); renderResults();
  } else { model.units = { ...units }; renderSetup(); renderTables(); touch(); renderResults(); }
}

function loadModel(m, autoSolve) {
  model = m; solved = null; stale = true; tab = 'xy'; save();
  clear($('shaft-messages'));
  renderSetup(); renderTables();
  if (autoSolve) solve();
  if (!solved) { renderResults(); drawViews(); }
}

function helpContent() {
  const li = (t) => h('li', { text: t });
  return h('div', { class: 'help' },
    h('h3', { text: 'What it solves' }),
    h('ul', {}, li('A rotating shaft along x on exactly two bearings, carrying forces Fy and Fz, torques about x and couples My and Mz. There is no axial load.'),
      li('Stepped shafts are solid. Each bearing, gear, pulley or sprocket sits on the smaller diameter against a shoulder you choose; its load acts at the middle of its width.'),
      li('A uniform shaft has one outer diameter, may be hollow over part of its length, and has no stress concentration. Components go at typed positions.'),
      li('Because the shaft rotates under loads fixed in space, the bending stress is completely reversed and the torsional stress is steady.')),
    h('h3', { text: 'Signs' }),
    h('ul', {}, li('The same as the beam calculator: x to the right, y up in the XY view, z down in the XZ view (seen from above).'),
      li('Torque T and the couples My and Mz follow the right-hand rule about +x, +y and +z.'),
      li('The total bending moment is M = √(My² + Mz²); totals of slope and deflection combine the two planes the same way.')),
    h('h3', { text: 'Formulas (Shigley, 11th ed.)' }),
    h('ul', {}, li('Stresses, Eqs. 7-4 and 7-5 with Mm = Ta = 0: σ′a = Kf (32 M / π d³), σ′m = √3 Kfs (16 T / π d³). A hollow segment uses M c / I and T c / J of the tube.'),
      li('DE-Goodman: 1/n = σ′a/Se + σ′m/Sut.  DE-Morrow: 1/n = σ′a/Se + σ′m/σ′f with σ′f = Sut + 345 MPa (50 kpsi), Eq. 6-44.  DE-Gerber: n σ′a/Se + (n σ′m/Sut)² = 1.'),
      li('First-cycle yield, Eqs. 7-15 and 7-16: ny = Sy / σ′max, with σ′max = √(σ′a² + σ′m²).'),
      li('Endurance limit: Se = ka kb ke S′e, with S′e = 0.5 Sut up to 1400 MPa (200 kpsi), ka from Table 6-2, kb from Eq. 6-19 and ke from Table 6-4. kc = kd = 1.'),
      li('Shoulder fillets: Kt from Figure A-15-9 and Kts from Figure A-15-8, read at r/d and D/d. Bearing seats use r/d = 0.02, gear, pulley and sprocket seats r/d = 0.1 (Sec. 7-4).'),
      li('Keyseats: the end-mill values of Table 7-1, Kt = 2.14 and Kts = 3.0, with a notch radius of 0.02 d.'),
      li('Notch sensitivity, Eqs. 6-32 to 6-36: Kf = 1 + q (Kt − 1), q = 1 / (1 + √a / √r), with the Neuber constant from Sut.'),
      li('Slope and deflection integrate M / EI section by section, so every step in diameter is included (Sec. 7-5). Twist is Σ T l / G J, Eq. 7-19, measured from the left end.')),
    h('h3', { text: 'Limits' }),
    h('ul', {}, li('The endurance limit, surface factor and notch sensitivity are fits for steels.'),
      li('Retaining-ring grooves, press fits and sled-runner keyseats are not included. Table 7-1 gives no torsion value for a sled-runner keyseat.'),
      li('Bearings are simple supports at one point. Fillets, grooves and keyseats are ignored for deflection, as the book recommends.'),
      li('Infinite life only; critical speeds are not checked.')));
}

export const shaft = {
  id: 'shaft', label: 'Shaft', helpTitle: 'Shaft: signs and theory',
  examples: SHAFT_EXAMPLES.map((ex) => ({ title: ex.title, load: () => loadModel(normalizeShaft(structuredClone(ex)), true) })),
  init() {
    renderSetup(); renderTables(); solve(true);
    if (!solved) { renderResults(); drawViews(); }
    let timer = 0, last = 0;
    new ResizeObserver(() => {
      const w = $('shaft-view-xy').clientWidth;
      if (!w || w === last) return;
      last = w; clearTimeout(timer);
      timer = setTimeout(() => { drawViews(); if (solved) renderResults(); }, 120);
    }).observe($('shaft-view-xy'));
  },
  show() { drawViews(); if (solved) renderResults(); },
  newModel() { loadModel(emptyShaft(model.units), false); },
  saveText: () => JSON.stringify(model, null, 2),
  openText(text) { const m = parseSaved(text, 'shaft'); if (!m) return false; loadModel(normalizeShaft(m), false); return true; },
  csv: () => (solved && !stale ? resultsCsv() : null),
  fileName: (ext) => `${fileSlug(model.title, 'shaft')}.${ext}`,
  help: helpContent,
};
