// Beam calculator page: menu bar, setup strip, input tables, plane views,
// Solve, diagrams and result tables. All mechanics live in solver.js; this
// file only moves numbers between the page and the solver.
import { h, clear } from '../ui/dom.js';
import { renderPlotGroup } from '../ui/plot.js';
import { UNIT_CHOICES, DEFAULT_UNITS, unitTable, fmt } from '../core/units.js';
import { FORMULA_HELP } from '../core/expr.js';
import { sectionSummary as sectionText, materialSummary } from '../core/inputs.js';
import {
  openSectionDialog, openMaterialDialog, openUnitsDialog, parseSaved, fileSlug, showMessages as showBox,
} from '../ui/dialogs.js';
import { solveBeam } from './solver.js';
import { drawPlane } from './draw.js';
import {
  EXAMPLES, SUPPORT_TYPES, DIRECTIONS, PROFILES, emptyModel, toSolverInput,
  stressSeries, convertModel, parseNum, modelNotes, formulaUnits,
} from './model.js';

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
  slopeXZ: { title: 'Slope', sym: 'dw/dx', kind: 'angle', zDown: true },
  w: { title: 'Deflection', sym: 'w', kind: 'deflection', zDown: true },
  Mtotal: { title: 'Total bending moment', sym: 'M', kind: 'moment' },
  T: { title: 'Torque', sym: 'T', kind: 'moment' },
  twist: { title: 'Angle of twist', sym: 'φ', kind: 'angle' },
  N: { title: 'Axial force', sym: 'N', kind: 'force' },
  u: { title: 'Axial displacement', sym: 'u', kind: 'deflection' },
  // Stresses from beam theory (torsion not included); see stressSeries in model.js.
  sigmaMax: { title: 'Largest normal stress', sym: '\u03C3max', kind: 'stress' },
  sigmaMin: { title: 'Smallest normal stress', sym: '\u03C3min', kind: 'stress' },
  tau: { title: 'Transverse shear stress at the neutral axis', sym: '\u03C4', kind: 'stress' },
  vonMises: { title: 'von Mises stress', sym: "\u03C3\u2032", kind: 'stress' },
};
const STRESS_KEYS = ['sigmaMax', 'sigmaMin', 'tau', 'vonMises'];
const TABS = {
  xy: { label: 'Beam Diagrams (XY)', plane: 'XY', keys: ['Vy', 'Mz', 'slopeXY', 'v'] },
  xz: { label: 'Beam Diagrams (XZ)', plane: 'XZ', keys: ['Vz', 'My', 'slopeXZ', 'w'] },
  // Quantities that do not belong to one plane. Total moment, torque and axial
  // force are always drawn here, even when they are zero.
  combined: { label: '3D Beam Diagrams', keys: ['Mtotal', 'T', 'N', 'twist', 'u'] },
  stress: { label: 'Stress Diagrams', keys: STRESS_KEYS },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let model = loadSaved() ?? structuredClone(EXAMPLES[0]);
let solved = null;        // { result, section, material, stress } from the last successful solve (SI)
let stale = true;         // true when the model changed since that solve
let tab = 'xy';
let queryX = '';

function normalize(m) {
  const base = emptyModel();
  const out = { ...base, ...m, kind: 'beam' };
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

const sectionSummary = () => (model.section?.shape === 'none' ? 'None (forces only)' : sectionText(model.units, model.section));

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
    pick('pick-section', 'Cross-section', sectionSummary(), () => openSectionDialog({ units: model.units, section: model.section, need: 'beam', allowNone: true,
      onApply: (sec) => { model.section = sec; touch(); renderSetup(); } })),
    pick('pick-material', 'Material', materialSummary(model.units, model.material), () => openMaterialDialog({ units: model.units, material: model.material,
      note: 'E is needed for deflection, G for twist, and Sy for the factor of safety. Leave E blank to solve forces and reactions only.',
      onApply: (mat) => { model.material = mat; touch(); renderSetup(); } })),
    pick('pick-units', 'Units', `${model.units.force} · ${model.units.length} · ${model.units.stress}`, () => openUnitsDialog({ units: model.units, onApply: applyUnits })),
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
      note: '+y is up, so a downward load is a negative Fy. +z points down the page in the XZ view. Fx acts along the beam.',
    }),
    tablePanel({
      id: 'moments', title: 'Moments and torque', hint: 'Right-hand rule about each axis', addLabel: 'Add moment',
      heads: [th('x', u.length.label), th('T (about x)', u.moment.label), th('My', u.moment.label), th('Mz', u.moment.label)],
      rows: model.moments,
      rowCells: (row, i) => [['x', 'Position x'], ['Mx', 'Torque T'], ['My', 'Moment My'], ['Mz', 'Moment Mz']].map(([k, l]) => numCell('moments', row, i, k, l)),
      onAdd: () => model.moments.push({ x: '', Mx: '', My: '', Mz: '' }),
      empty: 'No moments.',
      note: 'T twists the beam. Mz bends it in the XY plane and My in the XZ plane; both are counter-clockwise positive in their view.',
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
          // A formula is read in the units it was written in; show them, and
          // offer to switch when the model's units have changed since.
          if (!row.exprUnits) row.exprUnits = { force: model.units.force, length: model.units.length };
          const fu = formulaUnits(row, model.units), same = fu.force === model.units.force && fu.length === model.units.length;
          const tagText = `x, L in ${fu.length}; w in ${fu.force}${row.dir === 't' ? '\u00B7' + fu.length : ''}/${fu.length}`;
          const tag = same ? h('span', { class: 'unit', text: tagText })
            : h('button', { class: 'btn small unit-tag', type: 'button', text: `${tagText} \u2014 use current units`,
              title: 'This formula was written in different units from the rest of the model and is still read in those. Click to read it in the current units instead.',
              onClick: () => { row.exprUnits = { force: model.units.force, length: model.units.length }; touch(); renderTables(); } });
          cells.push(h('td', { colSpan: 2 }, inp, tag));
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
const showMessages = (kind, heading, items) => showBox($('messages'), kind, heading, items);

function solve(event, quiet = false) {
  clear($('messages'));
  const { input, section, material, errors } = toSolverInput(model);
  if (errors.length) { if (!quiet) showMessages('error', 'Fix these before solving:', errors); return; }
  const result = solveBeam(input);
  if (!result.ok) { if (!quiet) showMessages('error', 'The beam cannot be solved yet:', result.errors); return; }
  solved = { result, section, material, stress: stressSeries(result, section) };
  stale = false;
  const len = (v) => `${fmt(v / U().length.f, 4)} ${U().length.label}`;
  const extra = result.active.torsion && solved.stress ? ['The stress diagrams and the von Mises stress do not include torsion. Torsional shear is listed separately in the stress table.'] : [];
  showMessages('note', null, [...result.warnings, ...result.notes, ...modelNotes(input, section, result, len), ...extra]);
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
    deflection: Math.max(peak('v'), peak('w'), peak('u')), stress: solved.stress?.peak.vonMises?.value ?? 0 };
  const out = { x: r.x.map((v) => v / u.length.f), scale };
  for (const [k, q] of Object.entries(Q)) {
    const src = q.kind === 'stress' ? solved.stress : r;
    if (!src || !src[k]) { out[k] = null; continue; }
    const cut = 1e-9 * scale[q.kind];
    out[k] = src[k].map((v) => (Math.abs(v) <= cut ? 0 : v / u[q.kind].f));
  }
  return out;
}
const shown = (v, kind, scale) => (v === null || v === undefined ? null : Math.abs(v) <= 1e-9 * scale[kind] ? 0 : v / U()[kind].f);

function activeKeys(tabId) {
  const r = solved.result;
  const want = { xy: r.active.xy, xz: r.active.xz };
  if (tabId === 'stress') return solved.stress ? STRESS_KEYS : [];
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

  const keys = tab === 'combined' ? [...new Set(['Mtotal', 'T', 'N', ...activeKeys(tab)])].sort((a, b) => TABS.combined.keys.indexOf(a) - TABS.combined.keys.indexOf(b)) : activeKeys(tab);
  if (!keys.length) {
    plots.append(h('div', { class: 'plot-empty', text: tab === 'stress'
      ? 'Stresses need a cross-section with its area, second moments of area and extreme-fibre distances. Choose a shape in Cross-section and solve again.'
      : `No loads act in the ${TABS[tab].plane} plane.` }));
  } else {
    renderPlotGroup(plots, {
      x: d.x, xUnit: u.length.label, marks: r.reactions.map((q) => q.x / u.length.f),
      // w and dw/dx are measured along +z, which points down the page in the XZ view.
      plots: keys.map((k) => ({ title: `${Q[k].title} ${Q[k].sym}`, symbol: Q[k].sym, y: d[k], invert: !!Q[k].zDown,
        unit: u[Q[k].kind].label + (Q[k].zDown ? ', +z down' : '') })),
    });
    const missing = TABS[tab].keys.filter((k) => !r[k] && (tab === 'xy' || tab === 'xz'));
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
  const balanced = Math.max(worst, worstM) < 1e-7 && r.checks.supports < 1e-7;
  const agree = r.checks.methods === null ? null : r.checks.methods < 1e-7;
  const reactions = h('section', { class: 'full' }, h('h3', { text: 'Support reactions' }),
    h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('x', u.length.label), th('Fx', u.force.label), th('Fy', u.force.label), th('Fz', u.force.label),
        th('T', u.moment.label), th('My', u.moment.label), th('Mz', u.moment.label))),
      h('tbody', {}, reactRows.length ? reactRows : h('tr', {}, h('td', { colSpan: 7, text: 'No supports carry load.' }))))),
    h('p', { class: balanced && agree !== false ? 'check-ok' : 'check-bad', text: !balanced
      ? 'Equilibrium check failed. Please report this model.'
      : agree === false ? 'The two solution methods disagree. Please report this model.'
      : agree ? 'Checks passed: forces and moments balance, and two independent solution methods give the same reactions.'
      : 'Check passed: forces and moments balance.' }));

  // Extremes
  const allKeys = [...new Set(['xy', 'xz', 'combined'].flatMap((t) => activeKeys(t)))];
  const extremes = h('section', { class: 'full' }, h('h3', { text: 'Largest values' }),
    h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('Quantity'), th('Max'), th('at x', u.length.label), th('Min'), th('at x', u.length.label))),
      h('tbody', {}, allKeys.map((k) => {
        const e = r.extremes[k], kind = Q[k].kind;
        return h('tr', {}, h('td', {}, `${Q[k].title} ${Q[k].sym} `, h('span', { class: 'unit', text: u[kind].label })),
          cell(shown(e.max, kind, sc)), cell(e.xMax / u.length.f), cell(shown(e.min, kind, sc)), cell(e.xMin / u.length.f));
      })))));

  // Stresses
  const st = solved.stress?.peak ?? null;
  let stressBody;
  if (!st) stressBody = h('p', { class: 'muted', text: 'Choose a cross-section to get stresses.' });
  else {
    const row = (name, item, absent) => h('tr', {}, h('td', { text: name }),
      item ? cell(item.value / u.stress.f) : h('td', { class: 'muted', text: absent }), item ? cell(item.x / u.length.f) : dash());
    const rows = [row('Normal stress, bending + axial', st.sigma, 'needs c and I')];
    if (r.active.xy) rows.push(row('Transverse shear from Vy', st.tauVy, 'not for this shape'));
    if (r.active.xz) rows.push(row('Transverse shear from Vz', st.tauVz, 'not for this shape'));
    if (r.active.torsion) rows.push(row('Torsional shear', st.tauT, 'not for this shape'));
    rows.push(row(`von Mises stress${r.active.torsion ? ', without torsion' : ''}`, st.vonMises, ''));
    stressBody = h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, th('Peak stress'), th('Value', u.stress.label), th('at x', u.length.label))), h('tbody', {}, rows)));
  }
  const Sy = solved.material?.Sy;
  const safety = !st?.vonMises ? null
    : Sy ? `Factor of safety against yielding: n = Sy / \u03C3\u2032 = ${fmt(Sy / st.vonMises.value, 4)} (distortion-energy theory, Shigley Eq. 5-19).`
      : 'Enter a yield strength Sy in Material to get the factor of safety.';
  const stresses = h('section', {}, h('h3', { text: 'Stresses' }), stressBody, safety ? h('p', { class: 'table-note', text: safety }) : null);

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
  const keys = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz', 'Mtotal', 'u', 'v', 'w', 'slopeXY', 'slopeXZ', 'twist', ...STRESS_KEYS].filter((k) => d[k]);
  const lines = [[`x (${u.length.label})`, ...keys.map((k) => `${Q[k].sym} (${u[Q[k].kind].label})`)].join(',')];
  d.x.forEach((x, i) => lines.push([x, ...keys.map((k) => d[k][i])].map((v) => +v.toPrecision(8)).join(',')));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Units, help, and the interface the app shell uses
// ---------------------------------------------------------------------------
function applyUnits(units, mode) {
  if (mode === 'convert') {
    model = convertModel(model, units);          // same beam, so current results stay valid
    save(); renderSetup(); renderTables(); drawViews(); renderResults();
  } else {
    model.units = { ...units };
    for (const row of model.distLoads) if (row.profile === 'formula') row.exprUnits = { force: units.force, length: units.length };
    renderSetup(); renderTables(); touch(); renderResults();
  }
}

function helpContent() {
  const li = (...c) => h('li', {}, ...c);
  return h('div', { class: 'help' },
    h('h3', { text: 'Axes' }),
    h('ul', {}, li('x runs along the beam from the left end. y is up. z comes toward you in the XY view.'),
      li('The XZ view looks down on the beam from above: x to the right and +z down the page.')),
    h('h3', { text: 'What you enter' }),
    h('ul', {}, li('Forces are positive along +x, +y and +z. A downward load is a negative Fy.'),
      li('Moments are positive by the right-hand rule about their axis. T is the torque about x. A positive Mz is counter-clockwise in the XY view, and a positive My is counter-clockwise in the XZ view.'),
      li('Distributed loads follow the same signs, per unit length.')),
    h('h3', { text: 'What you get back' }),
    h('ul', {}, li('Both planes are read the same way on the page. Shear Vy, Vz: positive when the forces to the left of the cut add up to a resultant that points up the page (along +y in XY, along \u2212z in XZ).'),
      li('Bending moment Mz (XY plane) and My (XZ plane): positive when the beam sags on the page. Both equal the right-hand-rule component of the internal moment on a cut face that looks toward +x.'),
      li('So a load that points down the page gives the familiar picture in either view: positive shear at the left support and a positive moment.'),
      li('Total bending moment: the square root of Mz² + My². Use it for round sections.'),
      li('Torque T: positive when the torque vector on a cut face that looks toward +x points along +x.'),
      li('Axial force N: positive in tension.'),
      li('Slopes are dv/dx and dw/dx. Deflections v and w are positive along +y and +z. In the XZ tab, w and dw/dx are drawn with positive values downward, to match the view.'),
      li('Reactions are the forces and moments the supports apply to the beam, in the same axes.')),
    h('h3', { text: 'Theory and limits' }),
    h('ul', {}, li('Euler-Bernoulli beam theory: small deflections, linear elastic material, no shear deformation.'),
      li('One uniform cross-section whose principal axes line up with y and z.'),
      li('Beam theory is meant for span-to-depth ratios of 10 or more. Below that the calculator warns that the deflection shown is too small.'),
      li('Stress diagrams: normal stress at the extreme fibres from bending in both planes plus axial load, transverse shear at the neutral axis, and the von Mises stress, taken as the larger of the two locations. Torsion is not included in these; torsional shear is listed separately for round sections and closed rectangular tubes.'),
      li('Factor of safety against yielding is Sy divided by the largest von Mises stress.')));
}

function loadModel(m, autoSolve) {
  model = m; solved = null; stale = true; queryX = ''; tab = 'xy';
  save();
  clear($('messages'));
  renderSetup(); renderTables();
  if (autoSolve) solve(); else { renderResults(); drawViews(); }
}

export const beam = {
  id: 'beam', label: 'Beam', helpTitle: 'Beam: sign conventions and theory',
  examples: EXAMPLES.map((ex) => ({ title: ex.title, load: () => loadModel(normalize(structuredClone(ex)), true) })),
  init() {
    renderSetup();
    renderTables();
    solve(null, true);                // open on a worked example with its results showing
    if (!solved) { renderResults(); drawViews(); }
    let timer = 0, last = 0;
    new ResizeObserver(() => {
      const wNow = $('view-xy').clientWidth;
      if (!wNow || wNow === last) return;
      last = wNow;
      clearTimeout(timer);
      timer = setTimeout(() => { drawViews(); if (solved) renderResults(); }, 120);
    }).observe($('view-xy'));
  },
  show() { drawViews(); if (solved) renderResults(); },
  newModel() { loadModel(emptyModel(model.units), false); },
  saveText: () => JSON.stringify(model, null, 2),
  openText(text) {
    const m = parseSaved(text, 'beam');
    if (!m) return false;
    loadModel(normalize(m), false);
    return true;
  },
  csv: () => (solved && !stale ? resultsCsv() : null),
  fileName: (ext) => `${fileSlug(model.title, 'beam')}.${ext}`,
  help: helpContent,
};
