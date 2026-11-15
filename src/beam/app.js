// Beam calculator page: menu bar, setup strip, input tables, plane views,
// Solve, diagrams and result tables. All mechanics live in solver.js; this
// file only moves numbers between the page and the solver.
import { h, s, clear, makeDialog, buildMenus, copyText, downloadText } from '../ui/dom.js';
import { renderPlotGroup } from '../ui/plot.js';
import { UNIT_CHOICES, UNIT_PRESETS, DEFAULT_UNITS, unitTable, fmt } from '../core/units.js';
import { SHAPES } from '../core/sections.js';
import { MATERIALS } from '../core/materials.js';
import { FORMULA_HELP } from '../core/expr.js';
import { solveBeam } from './solver.js';
import { drawPlane } from './draw.js';
import {
  EXAMPLES, SUPPORT_TYPES, DIRECTIONS, PROFILES, emptyModel, toSolverInput, sectionSI,
  stressSummary, convertModel, materialPreset, shapeDefaults, parseNum,
} from './model.js';

const REPO_URL = 'https://github.com/Zhuyin21/structural-engineering-calculator';
const STORE_KEY = 'sec.beam.model.v1';
const $ = (id) => document.getElementById(id);

// Quantities the solver returns, how they are named on screen, and their unit kind.
// To rename a symbol (for example the torque), change it here only.
const Q = {
  Vy: { title: 'Shear force', sym: 'Vy', kind: 'force' },
  Mz: { title: 'Bending moment', sym: 'Mz', kind: 'moment' },
  slopeXY: { title: 'Slope', sym: 'dv/dx', kind: 'angle' },
  v: { title: 'Deflection', sym: 'v', kind: 'deflection' },
  Vz: { title: 'Shear force', sym: 'Vz', kind: 'force' },
  My: { title: 'Bending moment', sym: 'My', kind: 'moment' },
  slopeXZ: { title: 'Slope', sym: 'dw/dx', kind: 'angle' },
  w: { title: 'Deflection', sym: 'w', kind: 'deflection' },
  Mtotal: { title: 'Total bending moment', sym: 'M', kind: 'moment' },
  T: { title: 'Torque', sym: 'T', kind: 'moment' },
  twist: { title: 'Angle of twist', sym: 'φ', kind: 'angle' },
  N: { title: 'Axial force', sym: 'N', kind: 'force' },
  u: { title: 'Axial displacement', sym: 'u', kind: 'deflection' },
};
const TABS = {
  xy: { label: 'XY plane', keys: ['Vy', 'Mz', 'slopeXY', 'v'] },
  xz: { label: 'XZ plane', keys: ['Vz', 'My', 'slopeXZ', 'w'] },
  combined: { label: 'Combined', keys: ['Mtotal', 'T', 'twist', 'N', 'u'] },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let model = loadSaved() ?? structuredClone(EXAMPLES[0]);
let solved = null;        // { result, section } from the last successful solve (SI)
let stale = true;         // true when the model changed since that solve
let tab = 'xy';
let queryX = '';

function normalize(m) {
  const base = emptyModel();
  const out = { ...base, ...m };
  out.units = { ...base.units, ...(m.units || {}) };
  for (const [k, list] of Object.entries(UNIT_CHOICES)) if (!list.includes(out.units[k])) out.units[k] = DEFAULT_UNITS[k];
  out.section = { ...base.section, ...(m.section || {}) };
  out.section.dims = { ...(out.section.dims || {}) };
  out.section.custom = { ...(out.section.custom || {}) };
  out.material = { ...base.material, ...(m.material || {}) };
  for (const k of ['supports', 'pointLoads', 'moments', 'distLoads']) {
    out[k] = Array.isArray(m[k]) ? m[k].filter((r) => r && typeof r === 'object').map((r) => ({ ...r })) : [];
  }
  return out;
}
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return m && m.version === 1 ? normalize(m) : null;
  } catch { return null; }
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(model)); } catch { /* storage is optional */ } }

/** Call after any edit to the model. */
function touch() {
  stale = true;
  save();
  $('results').classList.toggle('stale', !!solved);
  clear($('messages'));
  scheduleViews();
}

// ---------------------------------------------------------------------------
// Setup strip
// ---------------------------------------------------------------------------
const U = () => unitTable(model.units);

function sectionSummary() {
  const sec = model.section;
  if (!sec || sec.shape === 'none') return 'None (forces only)';
  if (sec.shape === 'custom') return 'Custom values';
  const def = SHAPES[sec.shape];
  return `${def.label} ${def.dims.map(([k]) => fmt(parseNum(sec.dims[k]), 4)).join(' × ')} ${U().dim.label}`;
}
function materialSummary() {
  const E = parseNum(model.material.E);
  if (E === null) return 'Not set';
  const name = MATERIALS.find((m) => m.id === model.material.id)?.name ?? 'Custom';
  return `${name.replace(/ \(.*\)/, '')} · E ${fmt(E, 4)} ${U().modulus.label}`;
}

function renderSetup() {
  const u = U();
  const title = h('input', { id: 'beam-title', type: 'text', value: model.title ?? '', style: 'width: 13.5em',
    onInput: () => { model.title = title.value; save(); } });
  const len = h('input', { id: 'beam-length', class: 'num-in', type: 'text', inputMode: 'decimal', value: model.length ?? '', style: 'width: 6em',
    onInput: () => { model.length = len.value.trim(); len.classList.toggle('bad', !(parseNum(len.value) > 0)); touch(); } });
  const pick = (id, label, value, onClick) => h('button', { id, class: 'pick', type: 'button', onClick },
    h('span', { class: 'label', text: label }), h('span', { class: 'value', text: value }));
  clear($('setup')).append(
    h('div', { class: 'field' }, h('label', { for: 'beam-title', text: 'Name' }), title),
    h('div', { class: 'field' }, h('label', { for: 'beam-length', text: 'Beam length' }),
      h('div', { class: 'with-unit' }, len, h('span', { class: 'unit', text: u.length.label }))),
    pick('pick-section', 'Cross-section', sectionSummary(), openSectionDialog),
    pick('pick-material', 'Material', materialSummary(), openMaterialDialog),
    pick('pick-units', 'Units', `${model.units.force} · ${model.units.length} · ${model.units.stress}`, openUnitsDialog),
    h('div', { class: 'grow' }),
    h('button', { id: 'solve', class: 'btn primary solve', type: 'button', onClick: solve, text: 'Solve' }),
  );
}

// ---------------------------------------------------------------------------
// Input tables
// ---------------------------------------------------------------------------
function numCell(table, row, i, key, label) {
  const inp = h('input', { id: `${table}-${i}-${key}`, class: 'num-in', type: 'text', inputMode: 'decimal', value: row[key] ?? '', 'aria-label': `${label}, row ${i + 1}` });
  inp.addEventListener('input', () => {
    row[key] = inp.value.trim();
    inp.classList.toggle('bad', inp.value.trim() !== '' && parseNum(inp.value) === null);
    touch();
  });
  return h('td', {}, inp);
}
function selectCell(table, row, i, key, options, label, rerender) {
  const sel = h('select', { id: `${table}-${i}-${key}`, 'aria-label': `${label}, row ${i + 1}` },
    Object.entries(options).map(([value, text]) => h('option', { value, text, selected: row[key] === value })));
  sel.addEventListener('change', () => { row[key] = sel.value; touch(); if (rerender) renderTables(); });
  return h('td', {}, sel);
}
const th = (text, unit) => h('th', { scope: 'col' }, text, unit ? h('span', { class: 'unit', text: unit }) : null);

function tablePanel({ id, title, hint, heads, rows, rowCells, onAdd, addLabel, empty, note }) {
  const tbody = h('tbody', {});
  rows.forEach((row, i) => {
    tbody.append(h('tr', {}, h('td', { class: 'idx', text: i + 1 }), rowCells(row, i),
      h('td', {}, h('button', { class: 'del', type: 'button', 'aria-label': `Delete ${title.toLowerCase()} row ${i + 1}`, text: '×',
        onClick: () => { rows.splice(i, 1); touch(); renderTables(); } }))));
  });
  if (!rows.length) tbody.append(h('tr', { class: 'empty-row' }, h('td', { colSpan: heads.length + 2, text: empty })));
  return h('section', { class: 'panel', id },
    h('div', { class: 'panel-head' }, h('h2', { text: title }), h('span', { class: 'hint', text: hint }),
      h('button', { class: 'btn small', type: 'button', text: addLabel,
        onClick: () => { onAdd(); touch(); renderTables(); document.querySelector(`#${id} tbody tr:last-child input, #${id} tbody tr:last-child select`)?.focus(); } })),
    h('div', { class: 'panel-body' },
      h('div', { class: 'scroll-x' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}), heads, h('th', {}))), tbody)),
      note ? h('p', { class: 'table-note', text: note }) : null));
}

function supportDetail(row, i) {
  const u = U();
  if (row.type === 'spring') {
    const cell = (key, label) => {
      const inp = h('input', { id: `supports-${i}-${key}`, class: 'num-in', type: 'text', inputMode: 'decimal', value: row[key] ?? '', 'aria-label': `Spring stiffness in ${label}, row ${i + 1}`, style: 'width: 5em' });
      inp.addEventListener('input', () => { row[key] = inp.value.trim(); inp.classList.toggle('bad', inp.value.trim() !== '' && parseNum(inp.value) === null); touch(); });
      return h('span', { class: 'with-unit' }, `k${label}`, inp);
    };
    return h('td', { class: 'detail' }, h('div', { class: 'chips' }, cell('ky', 'y'), cell('kz', 'z'), h('span', { class: 'unit', text: u.kTrans.label })));
  }
  if (row.type === 'custom') {
    row.holds = row.holds || {};
    const names = { ux: 'x', uy: 'y', uz: 'z', rx: 'rot x', ry: 'rot y', rz: 'rot z' };
    return h('td', { class: 'detail' }, h('div', { class: 'chips', role: 'group', 'aria-label': 'Movements held' },
      Object.entries(names).map(([k, text]) => {
        const box = h('input', { id: `supports-${i}-${k}`, type: 'checkbox', checked: !!row.holds[k] });
        box.addEventListener('change', () => { row.holds[k] = box.checked; touch(); });
        return h('label', { class: 'chip' }, box, text);
      })));
  }
  return h('td', { class: 'detail', text: SUPPORT_TYPES[row.type]?.hint ?? '' });
}

function renderTables() {
  const u = U();
  const types = Object.fromEntries(Object.entries(SUPPORT_TYPES).map(([k, v]) => [k, v.label]));
  const dirs = Object.fromEntries(Object.entries(DIRECTIONS).map(([k, v]) => [k, v.label]));
  clear($('tables')).append(
    tablePanel({
      id: 'supports', title: 'Supports', hint: 'Position along x', addLabel: 'Add support',
      heads: [th('Type'), th('x', u.length.label), th('Holds')],
      rows: model.supports,
      rowCells: (row, i) => [selectCell('supports', row, i, 'type', types, 'Support type', true), numCell('supports', row, i, 'x', 'Position x'), supportDetail(row, i)],
      onAdd: () => model.supports.push({ type: model.supports.length ? 'roller' : 'pin', x: '' }),
      empty: 'No supports yet. A beam needs at least one fixed wall, or a pin and a roller.',
    }),
    tablePanel({
      id: 'pointLoads', title: 'Point loads', hint: 'Force components at x', addLabel: 'Add point load',
      heads: [th('x', u.length.label), th('Fx', u.force.label), th('Fy', u.force.label), th('Fz', u.force.label)],
      rows: model.pointLoads,
      rowCells: (row, i) => ['x', 'Fx', 'Fy', 'Fz'].map((k) => numCell('pointLoads', row, i, k, k === 'x' ? 'Position x' : `Force ${k}`)),
      onAdd: () => model.pointLoads.push({ x: '', Fx: '', Fy: '', Fz: '' }),
      empty: 'No point loads.',
      note: '+y is up, so a downward load is a negative Fy. Fx acts along the beam.',
    }),
    tablePanel({
      id: 'moments', title: 'Moments and torque', hint: 'Right-hand rule about each axis', addLabel: 'Add moment',
      heads: [th('x', u.length.label), th('T (about x)', u.moment.label), th('My', u.moment.label), th('Mz', u.moment.label)],
      rows: model.moments,
      rowCells: (row, i) => [['x', 'Position x'], ['Mx', 'Torque T'], ['My', 'Moment My'], ['Mz', 'Moment Mz']].map(([k, l]) => numCell('moments', row, i, k, l)),
      onAdd: () => model.moments.push({ x: '', Mx: '', My: '', Mz: '' }),
      empty: 'No moments.',
      note: 'T twists the beam. Mz bends it in the XY plane (counter-clockwise positive in that view); My bends it in the XZ plane.',
    }),
    tablePanel({
      id: 'distLoads', title: 'Distributed loads', hint: 'Load per unit length from x start to x end', addLabel: 'Add distributed load',
      heads: [th('Direction'), th('Profile'), th('x start', u.length.label), th('x end', u.length.label), th('w start', u.distForce.label), th('w end', u.distForce.label)],
      rows: model.distLoads,
      rowCells: (row, i) => {
        const cells = [selectCell('distLoads', row, i, 'dir', dirs, 'Direction', false), selectCell('distLoads', row, i, 'profile', PROFILES, 'Profile', true),
          numCell('distLoads', row, i, 'x1', 'Start position'), numCell('distLoads', row, i, 'x2', 'End position')];
        if (row.profile === 'formula') {
          const inp = h('input', { id: `distLoads-${i}-expr`, class: 'formula', type: 'text', value: row.expr ?? '', placeholder: '-5*sin(pi*x/L)', spellcheck: false, 'aria-label': `Load formula, row ${i + 1}`, title: FORMULA_HELP });
          inp.addEventListener('input', () => { row.expr = inp.value; touch(); });
          cells.push(h('td', { colSpan: 2 }, inp));
        } else {
          cells.push(numCell('distLoads', row, i, 'w1', 'Load at start'));
          if (row.profile === 'linear') cells.push(numCell('distLoads', row, i, 'w2', 'Load at end'));
          else cells.push(h('td', { class: 'detail', text: 'same' }));
        }
        return cells;
      },
      onAdd: () => model.distLoads.push({ dir: 'y', profile: 'uniform', x1: '', x2: '', w1: '', w2: '', expr: '' }),
      empty: 'No distributed loads.',
      note: 'Negative values act along −y or −z. A formula may use x and L, for example -5*sin(pi*x/L).',
    }),
  );
}

// ---------------------------------------------------------------------------
// Plane views
// ---------------------------------------------------------------------------
let viewFrame = 0;
function scheduleViews() {
  cancelAnimationFrame(viewFrame);
  viewFrame = requestAnimationFrame(drawViews);
}
function drawViews() {
  const current = solved && !stale ? solved : null;
  drawPlane($('view-xy'), model, 'xy', current);
  drawPlane($('view-xz'), model, 'xz', current);
}

// ---------------------------------------------------------------------------
// Solve and results
// ---------------------------------------------------------------------------
function showMessages(kind, heading, items) {
  const box = $('messages');
  if (!items.length) return;
  box.append(h('div', { class: `msg ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    heading ? h('strong', { text: heading }) : null,
    items.length === 1 && !heading ? items[0] : h('ul', {}, items.map((t) => h('li', { text: t })))));
}

function solve(event, quiet = false) {
  clear($('messages'));
  const { input, section, errors } = toSolverInput(model);
  if (errors.length) { if (!quiet) showMessages('error', 'Fix these before solving:', errors); return; }
  const result = solveBeam(input);
  if (!result.ok) { if (!quiet) showMessages('error', 'The beam cannot be solved yet:', result.errors); return; }
  solved = { result, section };
  stale = false;
  showMessages('note', null, [...result.warnings, ...result.notes]);
  renderResults();
  drawViews();
}

/** Result arrays converted to display units, with numerical dust set to zero. */
function displaySeries() {
  const r = solved.result, u = U();
  const peak = (k) => (r.extremes[k] ? r.extremes[k].abs : 0);
  const Lsi = r.x[r.x.length - 1];
  const fScale = Math.max(peak('Vy'), peak('Vz'), peak('N'), ...r.reactions.flatMap((q) => [Math.abs(q.Fx), Math.abs(q.Fy), Math.abs(q.Fz)]));
  const mScale = Math.max(peak('Mz'), peak('My'), peak('T'), fScale * Lsi);
  const scale = { force: fScale, moment: mScale, angle: Math.max(peak('slopeXY'), peak('slopeXZ'), peak('twist')),
    deflection: Math.max(peak('v'), peak('w'), peak('u')) };
  const out = { x: r.x.map((v) => v / u.length.f), scale };
  for (const [k, q] of Object.entries(Q)) {
    if (!r[k]) { out[k] = null; continue; }
    const cut = 1e-9 * scale[q.kind];
    out[k] = r[k].map((v) => (Math.abs(v) <= cut ? 0 : v / u[q.kind].f));
  }
  return out;
}
const shown = (v, kind, scale) => (v === null || v === undefined ? null : Math.abs(v) <= 1e-9 * scale[kind] ? 0 : v / U()[kind].f);

function activeKeys(tabId) {
  const r = solved.result;
  const want = { xy: r.active.xy, xz: r.active.xz };
  return TABS[tabId].keys.filter((k) => {
    if (!r[k]) return false;
    if (tabId === 'combined') {
      if (k === 'Mtotal') return r.active.xy || r.active.xz;
      if (k === 'T' || k === 'twist') return r.active.torsion;
      return r.active.axial;
    }
    return want[tabId];
  });
}

function renderResults() {
  const root = $('results');
  root.classList.toggle('stale', !!solved && stale);
  const body = clear($('results-body'));
  if (!solved) {
    body.append(h('div', { class: 'empty-state' },
      h('p', { text: 'Set up the beam on the left, then press Solve to see reactions, diagrams and deflections.' }),
      h('button', { class: 'btn', type: 'button', text: 'Solve', onClick: solve })));
    return;
  }
  const u = U(), r = solved.result, d = displaySeries();
  const tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Diagram views' },
    Object.entries(TABS).map(([id, t]) => h('button', { id: `tab-${id}`, class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(tab === id), text: t.label,
      onClick: () => { tab = id; renderResults(); } })));
  const plots = h('div', { class: 'plots', id: 'plots' });
  body.append(tabBar, plots);

  const keys = activeKeys(tab);
  if (!keys.length) {
    const why = tab === 'combined' ? 'There is nothing to combine yet.' : `No loads act in the ${TABS[tab].label}.`;
    plots.append(h('div', { class: 'plot-empty', text: why }));
  } else {
    renderPlotGroup(plots, {
      x: d.x, xUnit: u.length.label, marks: r.reactions.map((q) => q.x / u.length.f),
      plots: keys.map((k) => ({ title: `${Q[k].title} ${Q[k].sym}`, symbol: Q[k].sym, unit: u[Q[k].kind].label, y: d[k] })),
    });
    const missing = TABS[tab].keys.filter((k) => !r[k] && (tab !== 'combined'));
    if (missing.length && (tab === 'xy' ? r.active.xy : r.active.xz)) {
      plots.append(h('div', { class: 'plot-empty', text: 'Slope and deflection need a cross-section and a material. Set them in the strip above and solve again.' }));
    }
  }
  body.append(renderResultTables(d));
}

function renderResultTables(d) {
  const u = U(), r = solved.result, sc = d.scale;
  const cell = (v) => h('td', { text: fmt(v, 5) });
  const dash = () => h('td', { class: 'muted', text: '—' });

  // Reactions
  const reactRows = r.reactions.map((q) => h('tr', {},
    h('td', { class: 'num', text: fmt(q.x / u.length.f, 5) }),
    ...[['Fx', 'ux', 'force'], ['Fy', 'uy', 'force'], ['Fz', 'uz', 'force'], ['Mx', 'rx', 'moment'], ['My', 'ry', 'moment'], ['Mz', 'rz', 'moment']]
      .map(([k, dof, kind]) => (q.held[dof] ? cell(shown(q[k], kind, sc)) : dash()))));
  const worst = Math.max(Math.abs(r.checks.Vy), Math.abs(r.checks.Vz), Math.abs(r.checks.N)) / (sc.force || 1);
  const worstM = Math.max(Math.abs(r.checks.Mz), Math.abs(r.checks.My), Math.abs(r.checks.T)) / (sc.moment || 1);
  const balanced = Math.max(worst, worstM) < 1e-7;
  const reactions = h('section', { class: 'full' }, h('h3', { text: 'Support reactions' }),
    h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('x', u.length.label), th('Fx', u.force.label), th('Fy', u.force.label), th('Fz', u.force.label),
        th('T', u.moment.label), th('My', u.moment.label), th('Mz', u.moment.label))),
      h('tbody', {}, reactRows.length ? reactRows : h('tr', {}, h('td', { colSpan: 7, text: 'No supports carry load.' }))))),
    h('p', { class: balanced ? 'check-ok' : 'check-bad', text: balanced
      ? 'Equilibrium check passed: forces and moments close to zero at the right end.'
      : 'Equilibrium check failed. Please report this model.' }));

  // Extremes
  const allKeys = [...new Set(Object.keys(TABS).flatMap((t) => activeKeys(t)))];
  const extremes = h('section', { class: 'full' }, h('h3', { text: 'Largest values' }),
    h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('Quantity'), th('Max'), th('at x', u.length.label), th('Min'), th('at x', u.length.label))),
      h('tbody', {}, allKeys.map((k) => {
        const e = r.extremes[k], kind = Q[k].kind;
        return h('tr', {}, h('td', {}, `${Q[k].title} ${Q[k].sym} `, h('span', { class: 'unit', text: u[kind].label })),
          cell(shown(e.max, kind, sc)), cell(e.xMax / u.length.f), cell(shown(e.min, kind, sc)), cell(e.xMin / u.length.f));
      })))));

  // Stresses
  const st = stressSummary(r, solved.section);
  let stressBody;
  if (!st) stressBody = h('p', { class: 'muted', text: 'Choose a cross-section to get stresses.' });
  else {
    const row = (name, item, absent) => h('tr', {}, h('td', { text: name }),
      item ? cell(item.value / u.stress.f) : h('td', { class: 'muted', text: absent }), item ? cell(item.x / u.length.f) : dash());
    const rows = [row('Normal stress, bending + axial', st.sigma, 'needs c and I')];
    if (r.active.xy) rows.push(row('Transverse shear from Vy', st.tauVy, 'not for this shape'));
    if (r.active.xz) rows.push(row('Transverse shear from Vz', st.tauVz, 'not for this shape'));
    if (r.active.torsion) rows.push(row('Torsional shear', st.tauT, 'not for this shape'));
    stressBody = h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('Peak stress'), th('Value', u.stress.label), th('at x', u.length.label))), h('tbody', {}, rows)));
  }
  const stresses = h('section', {}, h('h3', { text: 'Stresses' }), stressBody);

  // Values at a position
  const qBody = h('tbody', {});
  const qHead = h('tr', {});
  const fill = () => {
    clear(qBody); clear(qHead);
    const xv = parseNum(queryX);
    const Lu = d.x[d.x.length - 1];
    if (xv === null || xv < 0 || xv > Lu * (1 + 1e-9)) {
      qHead.append(th('Quantity'), th('Value'));
      qBody.append(h('tr', {}, h('td', { colSpan: 2, class: 'muted', text: `Enter a position between 0 and ${fmt(Lu, 5)} ${u.length.label}.` })));
      return;
    }
    const a = r.at(xv * u.length.f, 'left'), b = r.at(xv * u.length.f, 'right');
    const rows = allKeys.map((k) => [k, shown(a[k], Q[k].kind, sc), shown(b[k], Q[k].kind, sc)]);
    const split = rows.some(([, l, rt]) => l !== null && Math.abs(l - rt) > 1e-9 * Math.max(Math.abs(l), Math.abs(rt)));
    qHead.append(th('Quantity'), ...(split ? [th('Just left'), th('Just right')] : [th('Value')]));
    for (const [k, l, rt] of rows) {
      qBody.append(h('tr', {}, h('td', {}, `${Q[k].title} ${Q[k].sym} `, h('span', { class: 'unit', text: u[Q[k].kind].label })),
        ...(split ? [cell(l), cell(rt)] : [cell(rt)])));
    }
  };
  const qInput = h('input', { id: 'query-x', class: 'num-in', type: 'text', inputMode: 'decimal', value: queryX, placeholder: fmt(d.x[d.x.length - 1] / 2, 3),
    onInput: () => { queryX = qInput.value.trim(); fill(); } });
  fill();
  const query = h('section', {}, h('h3', { text: 'Values at a position' }),
    h('div', { class: 'query' }, h('label', { for: 'query-x', text: 'x =' }), qInput, h('span', { class: 'unit', text: u.length.label })),
    h('div', { class: 'scroll-x' }, h('table', { class: 'data' }, h('thead', {}, qHead), qBody)));

  return h('div', { class: 'tables' }, reactions, extremes, stresses, query);
}

function resultsCsv() {
  const d = displaySeries(), u = U();
  const keys = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz', 'Mtotal', 'u', 'v', 'w', 'slopeXY', 'slopeXZ', 'twist'].filter((k) => d[k]);
  const lines = [[`x (${u.length.label})`, ...keys.map((k) => `${Q[k].sym} (${u[Q[k].kind].label})`)].join(',')];
  d.x.forEach((x, i) => lines.push([x, ...keys.map((k) => d[k][i])].map((v) => +v.toPrecision(8)).join(',')));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
const labelled = (id, label, control, unit) => h('div', { class: 'field' }, h('label', { for: id, text: label }),
  unit ? h('div', { class: 'with-unit' }, control, h('span', { class: 'unit', text: unit })) : control);

const sectionDlg = makeDialog('Cross-section');
function sectionSketch(shape, dims) {
  const svg = s('svg', { viewBox: '0 0 132 132', width: 132, height: 132, class: 'sec-sketch', role: 'img', 'aria-label': 'Sketch of the cross-section' });
  const g = (k) => parseNum(dims[k]) || 0;
  const fit = (wd, ht) => 84 / Math.max(wd, ht, 1e-12);
  const rect = (wd, ht, k, cls) => s('rect', { class: cls, x: 66 - wd * k / 2, y: 66 - ht * k / 2, width: wd * k, height: ht * k });
  if (shape === 'rect' && g('b') > 0 && g('h') > 0) svg.append(rect(g('b'), g('h'), fit(g('b'), g('h')), 'shape'));
  else if (shape === 'circle' && g('d') > 0) svg.append(s('circle', { class: 'shape', cx: 66, cy: 66, r: 42 }));
  else if (shape === 'tube' && g('do') > g('di') && g('di') > 0) svg.append(s('circle', { class: 'shape', cx: 66, cy: 66, r: 42 }), s('circle', { class: 'hole', cx: 66, cy: 66, r: 42 * g('di') / g('do') }));
  else if (shape === 'box' && g('b') > 2 * g('t') && g('h') > 2 * g('t') && g('t') > 0) {
    const k = fit(g('b'), g('h'));
    svg.append(rect(g('b'), g('h'), k, 'shape'), rect(g('b') - 2 * g('t'), g('h') - 2 * g('t'), k, 'hole'));
  } else if (shape === 'ibeam' && g('h') > 2 * g('tf') && g('bf') > g('tw') && g('tf') > 0 && g('tw') > 0) {
    const k = fit(g('bf'), g('h')), H2 = g('h') * k / 2, B2 = g('bf') * k / 2, tf = Math.max(g('tf') * k, 1.5), tw = Math.max(g('tw') * k, 1.5) / 2;
    svg.append(s('polygon', { class: 'shape', points: [[-B2, -H2], [B2, -H2], [B2, -H2 + tf], [tw, -H2 + tf], [tw, H2 - tf], [B2, H2 - tf], [B2, H2], [-B2, H2], [-B2, H2 - tf], [-tw, H2 - tf], [-tw, -H2 + tf], [-B2, -H2 + tf]]
      .map(([a, b]) => `${66 + a},${66 + b}`).join(' ') }));
  } else svg.append(s('text', { x: 66, y: 70, 'text-anchor': 'middle', text: shape === 'custom' ? 'custom' : shape === 'none' ? 'none' : '?' }));
  svg.append(s('line', { class: 'axis', x1: 66, x2: 66, y1: 126, y2: 8 }), s('line', { class: 'axis', x1: 8, x2: 124, y1: 66, y2: 66 }),
    s('text', { class: 't-dim', x: 71, y: 16, text: 'y' }), s('text', { class: 't-dim', x: 116, y: 62, text: 'z' }));
  return svg;
}
function openSectionDialog() {
  const draft = structuredClone(model.section);
  const u = U();
  const render = () => {
    const shapes = { none: 'None (forces and reactions only)', ...Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [k, v.label])), custom: 'Custom values' };
    const sel = h('select', { id: 'sec-shape' }, Object.entries(shapes).map(([value, text]) => h('option', { value, text, selected: draft.shape === value })));
    sel.addEventListener('change', () => {
      draft.shape = sel.value;
      if (SHAPES[draft.shape]) draft.dims = shapeDefaults(draft.shape, model.units);
      render();
    });
    const fields = h('div', { class: 'form-grid' });
    const propsBox = h('div', { class: 'props' });
    const sketchHost = h('div', {});
    const refresh = () => {
      clear(sketchHost).append(sectionSketch(draft.shape, draft.dims));
      const info = sectionSI({ units: model.units, section: draft });
      clear(propsBox);
      if (info.none) { propsBox.append(h('div', {}, h('span', { text: 'No section' }), 'Reactions, shear, moment and torque are still solved. Deflection and stress are not.')); return; }
      if (info.error) { propsBox.append(h('div', {}, h('span', { text: 'Check the dimensions' }), info.error)); return; }
      const p = info.props;
      const item = (name, v, kind) => h('div', {}, h('span', { text: name }), h('b', { class: 'num', text: v === null || v === undefined ? '—' : `${fmt(v / u[kind].f, 5)} ${u[kind].label}` }));
      propsBox.append(item('Area A', p.A, 'area'), item('Iz (bending in XY)', p.Iz, 'inertia'), item('Iy (bending in XZ)', p.Iy, 'inertia'), item('Torsion constant J', p.J, 'inertia'));
    };
    const dimInput = (obj, key, label, unit) => {
      const inp = h('input', { id: `sec-${key}`, class: 'num-in', type: 'text', inputMode: 'decimal', value: obj[key] ?? '' });
      inp.addEventListener('input', () => { obj[key] = inp.value.trim(); refresh(); });
      return labelled(`sec-${key}`, label, inp, unit);
    };
    if (SHAPES[draft.shape]) for (const [key, label] of SHAPES[draft.shape].dims) fields.append(dimInput(draft.dims, key, label, u.dim.label));
    if (draft.shape === 'custom') {
      draft.custom = draft.custom || {};
      fields.append(dimInput(draft.custom, 'Iz', 'Iz (bending in XY)', u.inertia.label), dimInput(draft.custom, 'Iy', 'Iy (bending in XZ)', u.inertia.label),
        dimInput(draft.custom, 'A', 'Area A', u.area.label), dimInput(draft.custom, 'J', 'Torsion constant J', u.inertia.label),
        dimInput(draft.custom, 'cy', 'Extreme fibre in y', u.dim.label), dimInput(draft.custom, 'cz', 'Extreme fibre in z', u.dim.label));
    }
    clear(sectionDlg.body).append(
      labelled('sec-shape', 'Shape', sel),
      h('div', { class: 'sec-row' }, sketchHost, fields),
      h('p', { class: 'muted', hidden: draft.shape !== 'custom', text: 'Enter only what you have. Iz is used for loads along y, Iy for loads along z, A for axial loads and J for torque.' }),
      propsBox);
    refresh();
  };
  render();
  clear(sectionDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: sectionDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: 'Use this section', onClick: () => { model.section = draft; sectionDlg.close(); touch(); renderSetup(); } }));
  sectionDlg.open();
}

const materialDlg = makeDialog('Material');
function openMaterialDialog() {
  const draft = { ...model.material };
  const u = U();
  const eIn = h('input', { id: 'mat-E', class: 'num-in', type: 'text', inputMode: 'decimal', value: draft.E ?? '' });
  const gIn = h('input', { id: 'mat-G', class: 'num-in', type: 'text', inputMode: 'decimal', value: draft.G ?? '' });
  const sel = h('select', { id: 'mat-preset' }, MATERIALS.map((m) => h('option', { value: m.id, text: m.name, selected: draft.id === m.id })));
  sel.addEventListener('change', () => {
    draft.id = sel.value;
    const p = materialPreset(sel.value, model.units);
    if (p) { draft.E = p.E; draft.G = p.G; eIn.value = p.E; gIn.value = p.G; }
  });
  eIn.addEventListener('input', () => { draft.E = eIn.value.trim(); draft.id = 'custom'; sel.value = 'custom'; });
  gIn.addEventListener('input', () => { draft.G = gIn.value.trim(); draft.id = 'custom'; sel.value = 'custom'; });
  clear(materialDlg.body).append(
    labelled('mat-preset', 'Material', sel),
    h('div', { class: 'form-grid' },
      labelled('mat-E', 'Elastic modulus E', eIn, u.modulus.label), labelled('mat-G', 'Shear modulus G', gIn, u.modulus.label)),
    h('p', { class: 'muted', text: 'Preset values are typical textbook figures. E is needed for deflection; G only for twist. Leave both blank to solve forces and reactions only.' }));
  clear(materialDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: materialDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: 'Use this material', onClick: () => { model.material = draft; materialDlg.close(); touch(); renderSetup(); } }));
  materialDlg.open();
}

const unitsDlg = makeDialog('Units');
function openUnitsDialog() {
  const draft = { ...model.units };
  let mode = 'convert';
  const names = { force: 'Force', length: 'Length along the beam', small: 'Section sizes and deflection', stress: 'Stress', modulus: 'E and G', angle: 'Slope and twist' };
  const selects = {};
  const grid = h('div', { class: 'form-grid' }, Object.entries(UNIT_CHOICES).map(([key, list]) => {
    const sel = h('select', { id: `unit-${key}` }, list.map((v) => h('option', { value: v, text: v, selected: draft[key] === v })));
    sel.addEventListener('change', () => { draft[key] = sel.value; });
    selects[key] = sel;
    return labelled(`unit-${key}`, names[key], sel);
  }));
  const presets = h('div', { class: 'presets' }, Object.entries(UNIT_PRESETS).map(([name, set]) =>
    h('button', { class: 'btn small', type: 'button', text: name, onClick: () => { Object.assign(draft, set); for (const k of Object.keys(selects)) selects[k].value = draft[k]; } })));
  const radio = (value, text) => {
    const r = h('input', { type: 'radio', name: 'unit-mode', id: `unit-mode-${value}`, value, checked: mode === value });
    r.addEventListener('change', () => { mode = value; });
    return h('label', { for: `unit-mode-${value}` }, r, ` ${text}`);
  };
  clear(unitsDlg.body).append(
    h('div', { class: 'field' }, h('span', { class: 'label', text: 'Quick sets' }), presets), grid,
    h('div', { class: 'radio-row' }, radio('convert', 'Convert the numbers I have entered (the beam stays the same)'),
      radio('relabel', 'Keep my numbers and only change the units they are read in')),
    h('p', { class: 'muted', text: 'Derived units follow from these: moments in force × length, distributed loads in force per length, I and J in section size to the fourth power. Formula loads are never converted; check them after a change.' }));
  clear(unitsDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: unitsDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: 'Apply units', onClick: () => {
      unitsDlg.close();
      if (mode === 'convert') {
        model = convertModel(model, draft);
        save(); renderSetup(); renderTables(); drawViews(); renderResults();      // same beam, so results stay valid
      } else { model.units = { ...draft }; renderSetup(); renderTables(); touch(); renderResults(); }
    } }));
  unitsDlg.open();
}

const textDlg = makeDialog('Export', { wide: true });
function openExport(title, filename, text, type) {
  textDlg.dialog.setAttribute('aria-label', title);
  textDlg.dialog.querySelector('h2').textContent = title;
  const area = h('textarea', { id: 'export-text', class: 'export', readOnly: true, value: text, 'aria-label': title });
  const status = h('span', { class: 'muted', role: 'status' });
  clear(textDlg.body).append(area, status);
  clear(textDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Copy', onClick: async () => { status.textContent = (await copyText(text, area)) ? 'Copied.' : 'Selected. Press Ctrl+C or Cmd+C to copy.'; } }),
    h('button', { class: 'btn primary', type: 'button', text: `Download ${filename}`, onClick: () => downloadText(filename, text, type) }));
  textDlg.open();
}
const fileName = (ext) => `${(model.title || 'beam').trim().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'beam'}.${ext}`;

const openDlg = makeDialog('Open a saved beam');
function openOpenDialog() {
  const area = h('textarea', { id: 'open-text', class: 'export', placeholder: 'Or paste the contents of a saved .json file here', 'aria-label': 'Saved beam as text' });
  const status = h('span', { class: 'muted', role: 'status' });
  const file = h('input', { id: 'open-file', type: 'file', accept: '.json,application/json' });
  file.addEventListener('change', async () => { if (file.files[0]) area.value = await file.files[0].text(); });
  clear(openDlg.body).append(labelled('open-file', 'Saved file', file), area, status);
  clear(openDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: openDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: 'Open', onClick: () => {
      try {
        const m = JSON.parse(area.value);
        if (!m || m.version !== 1 || !m.units) throw new Error('bad');
        openDlg.close();
        loadModel(normalize(m), false);
      } catch { status.textContent = 'That is not a beam saved from this calculator.'; }
    } }));
  openDlg.open();
}

const confirmDlg = makeDialog('Start a new beam?');
function openNewDialog() {
  clear(confirmDlg.body).append(h('p', { text: 'The current beam will be cleared. Save it first if you want to keep it.' }));
  clear(confirmDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: confirmDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: 'New beam', onClick: () => { confirmDlg.close(); loadModel(emptyModel(model.units), false); } }));
  confirmDlg.open();
}

const helpDlg = makeDialog('Sign conventions', { wide: true });
function openHelp() {
  const li = (...c) => h('li', {}, ...c);
  clear(helpDlg.body).append(h('div', { class: 'help' },
    h('h3', { text: 'Axes' }),
    h('ul', {}, li('x runs along the beam from the left end. y is up. z comes toward you in the XY view.'),
      li('The XZ view shows x to the right and z up.')),
    h('h3', { text: 'What you enter' }),
    h('ul', {}, li('Forces are positive along +x, +y and +z. A downward load is a negative Fy.'),
      li('Moments are positive by the right-hand rule about their axis. T is the torque about x. A positive Mz is counter-clockwise in the XY view. A positive My is clockwise in the XZ view.'),
      li('Distributed loads follow the same signs, per unit length.')),
    h('h3', { text: 'What you get back' }),
    h('ul', {}, li('Shear Vy, Vz: the sum of the transverse forces to the left of the cut.'),
      li('Bending moment Mz (XY plane) and My (XZ plane): positive when the beam sags in that view, that is, bends concave toward +y or +z.'),
      li('Total bending moment: the square root of Mz² + My². Use it for round sections.'),
      li('Torque T: positive when the torque vector on a cut face that looks toward +x points along +x.'),
      li('Axial force N: positive in tension.'),
      li('Slopes are dv/dx and dw/dx. Deflections v and w are positive along +y and +z.'),
      li('Reactions are the forces and moments the supports apply to the beam, in the same axes.')),
    h('h3', { text: 'Theory and limits' }),
    h('ul', {}, li('Euler-Bernoulli beam theory: small deflections, linear elastic material, no shear deformation.'),
      li('One uniform cross-section whose principal axes line up with y and z.'),
      li('Torsional stress is given for round sections and closed rectangular tubes only.'))));
  clear(helpDlg.foot).append(h('button', { class: 'btn primary', type: 'button', text: 'Close', onClick: helpDlg.close }));
  helpDlg.open();
}

const aboutDlg = makeDialog('About');
function openAbout() {
  clear(aboutDlg.body).append(h('div', { class: 'help' },
    h('p', { text: 'An open-source calculator for engineering students to check their homework. The beam solver uses the stiffness method for the reactions and the method of sections for the diagrams, and is tested against closed-form textbook results.' }),
    h('p', {}, 'Source code, tests and issue tracker: ', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener', text: REPO_URL.replace('https://', '') })),
    h('p', { class: 'muted', text: 'MIT licence. Results are for learning; check anything that matters independently.' })));
  clear(aboutDlg.foot).append(h('button', { class: 'btn primary', type: 'button', text: 'Close', onClick: aboutDlg.close }));
  aboutDlg.open();
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
function loadModel(m, autoSolve) {
  model = m; solved = null; stale = true; queryX = ''; tab = 'xy';
  save();
  clear($('messages'));
  renderSetup(); renderTables();
  if (autoSolve) solve(); else { renderResults(); drawViews(); }
}

buildMenus($('menus'), [
  { label: 'File', items: () => [
    { label: 'New beam', onSelect: openNewDialog },
    { label: 'Open…', onSelect: openOpenDialog },
    { label: 'Save…', onSelect: () => openExport('Save this beam', fileName('json'), JSON.stringify(model, null, 2), 'application/json') },
    'sep',
    { label: 'Export results (CSV)…', disabled: !solved || stale, tag: !solved || stale ? 'solve first' : '', onSelect: () => openExport('Export results', fileName('csv'), resultsCsv(), 'text/csv') },
  ] },
  { label: 'Analysis', items: [
    { label: 'Beam', current: true, tag: 'open' },
    { label: 'Shaft', disabled: true, tag: 'planned' },
    { label: 'Truss', disabled: true, tag: 'planned' },
    { label: 'Frame', disabled: true, tag: 'planned' },
  ] },
  { label: 'Examples', items: EXAMPLES.map((ex) => ({ label: ex.title, onSelect: () => loadModel(normalize(structuredClone(ex)), true) })) },
  { label: 'Help', items: [
    { label: 'Sign conventions', onSelect: openHelp },
    { label: 'About', onSelect: openAbout },
  ] },
]);

renderSetup();
renderTables();
solve(null, true);                // open on a worked example with its results showing
if (!solved) { renderResults(); drawViews(); }

let resizeTimer = 0, lastWidth = 0;
new ResizeObserver(() => {
  const wNow = $('view-xy').clientWidth;
  if (wNow === lastWidth) return;
  lastWidth = wNow;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { drawViews(); if (solved) renderResults(); }, 120);
}).observe($('view-xy'));
