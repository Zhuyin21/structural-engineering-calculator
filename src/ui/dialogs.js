// Dialogs shared by every calculator: cross-section, material, units,
// save/export, open, confirm and information.
import { h, s, clear, makeDialog, copyText, downloadText } from './dom.js';
import { UNIT_CHOICES, UNIT_PRESETS, unitTable, fmt } from '../core/units.js';
import { SHAPES } from '../core/sections.js';
import { MATERIALS, MATERIAL_SOURCE } from '../core/materials.js';
import { parseNum, sectionSI, shapeDefaults, materialPreset } from '../core/inputs.js';

export const labelled = (id, label, control, unit) => h('div', { class: 'field' }, h('label', { for: id, text: label }),
  unit ? h('div', { class: 'with-unit' }, control, h('span', { class: 'unit', text: unit })) : control);

// ---------------------------------------------------------------------------
// Cross-section
// ---------------------------------------------------------------------------
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

// What each calculator needs from a section, and so what the dialog shows.
const NEEDS = {
  beam: { props: ['A', 'Iz', 'Iy', 'J'], custom: ['Iz', 'Iy', 'A', 'J', 'cy', 'cz'],
    hint: 'Enter only what you have. Iz is used for loads along y, Iy for loads along z, A for axial loads and J for torque.' },
  area: { props: ['A'], custom: ['A'], hint: 'A bar only needs its cross-sectional area.' },
  column: { props: ['A', 'Iz', 'Iy'], custom: ['A', 'Iz', 'Iy', 'cy', 'cz'],
    hint: 'Buckling needs the area and both second moments of area. The extreme-fibre distances are only used for an eccentric load.' },
};
const PROP_LABEL = { A: ['Area A', 'area'], Iz: ['Iz (bending in XY)', 'inertia'], Iy: ['Iy (bending in XZ)', 'inertia'], J: ['Torsion constant J', 'inertia'],
  cy: ['Extreme fibre in y', 'dim'], cz: ['Extreme fibre in z', 'dim'] };

const sectionDlg = makeDialog('Cross-section');
/**
 * Edit a section. `need` is 'beam', 'area' or 'column'. `onApply(section)`
 * receives the edited copy.
 */
export function openSectionDialog({ units, section, need = 'beam', allowNone = false, title = 'Cross-section', onApply }) {
  const draft = structuredClone(section || { shape: 'none', dims: {}, custom: {} });
  const u = unitTable(units), spec = NEEDS[need];
  sectionDlg.dialog.querySelector('h2').textContent = title;
  const render = () => {
    const shapes = { ...(allowNone ? { none: 'None (forces and reactions only)' } : {}),
      ...Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [k, v.label])), custom: 'Custom values' };
    if (!shapes[draft.shape]) { draft.shape = 'circle'; draft.dims = shapeDefaults('circle', units); }
    const sel = h('select', { id: 'sec-shape' }, Object.entries(shapes).map(([value, text]) => h('option', { value, text, selected: draft.shape === value })));
    sel.addEventListener('change', () => {
      draft.shape = sel.value;
      if (SHAPES[draft.shape]) draft.dims = shapeDefaults(draft.shape, units);
      render();
    });
    const fields = h('div', { class: 'form-grid' });
    const propsBox = h('div', { class: 'props' });
    const sketchHost = h('div', {});
    const refresh = () => {
      clear(sketchHost).append(sectionSketch(draft.shape, draft.dims));
      const info = sectionSI(units, draft);
      clear(propsBox);
      if (info.none) { propsBox.append(h('div', {}, h('span', { text: 'No section' }), 'Reactions, shear, moment and torque are still solved. Deflection and stress are not.')); return; }
      if (info.error) { propsBox.append(h('div', {}, h('span', { text: 'Check the dimensions' }), info.error)); return; }
      for (const k of spec.props) {
        const v = info.props[k], [name, kind] = PROP_LABEL[k];
        propsBox.append(h('div', {}, h('span', { text: name }), h('b', { class: 'num', text: v === null || v === undefined ? '—' : `${fmt(v / u[kind].f, 5)} ${u[kind].label}` })));
      }
    };
    const dimInput = (obj, key, label, unit) => {
      const inp = h('input', { id: `sec-${key}`, class: 'num-in', type: 'text', inputMode: 'decimal', value: obj[key] ?? '' });
      inp.addEventListener('input', () => { obj[key] = inp.value.trim(); refresh(); });
      return labelled(`sec-${key}`, label, inp, unit);
    };
    if (SHAPES[draft.shape]) for (const [key, label] of SHAPES[draft.shape].dims) fields.append(dimInput(draft.dims, key, label, u.dim.label));
    if (draft.shape === 'custom') {
      draft.custom = draft.custom || {};
      for (const k of spec.custom) fields.append(dimInput(draft.custom, k, PROP_LABEL[k][0], u[PROP_LABEL[k][1]].label));
    }
    clear(sectionDlg.body).append(
      labelled('sec-shape', 'Shape', sel),
      h('div', { class: 'sec-row' }, sketchHost, fields),
      h('p', { class: 'muted', hidden: draft.shape !== 'custom', text: spec.hint }),
      propsBox);
    refresh();
  };
  render();
  clear(sectionDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: sectionDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: 'Use this section', onClick: () => { sectionDlg.close(); onApply(draft); } }));
  sectionDlg.open();
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------
const materialDlg = makeDialog('Material');
/** Edit a material. `show` lists the fields this calculator uses, e.g. ['E', 'G', 'nu', 'Sy', 'Sut']. */
export function openMaterialDialog({ units, material, show = ['E', 'G', 'nu', 'Sy', 'Sut'], note, onApply }) {
  const draft = { ...material };
  const u = unitTable(units);
  const FIELDS = {
    E: ['Elastic modulus E', u.modulus.label], G: ['Shear modulus G', u.modulus.label], nu: ["Poisson's ratio ν", ''],
    Sy: ['Yield strength Sy', u.stress.label], Sut: ['Tensile strength Sut', u.stress.label],
  };
  const groups = [...new Set(MATERIALS.map((m) => m.group).filter(Boolean))];
  const sel = h('select', { id: 'mat-preset' },
    groups.map((g) => h('optgroup', { label: g }, MATERIALS.filter((m) => m.group === g).map((m) => h('option', { value: m.id, text: m.name, selected: draft.id === m.id })))),
    h('option', { value: 'custom', text: 'Custom', selected: !MATERIALS.some((m) => m.id === draft.id && m.id !== 'custom') }));
  const inputs = {};
  for (const k of show) {
    const inp = h('input', { id: `mat-${k}`, class: 'num-in', type: 'text', inputMode: 'decimal', value: draft[k] ?? '' });
    inp.addEventListener('input', () => { draft[k] = inp.value.trim(); draft.id = 'custom'; sel.value = 'custom'; });
    inputs[k] = inp;
  }
  sel.addEventListener('change', () => {
    draft.id = sel.value;
    const p = materialPreset(sel.value, units);
    if (p) for (const k of Object.keys(FIELDS)) { draft[k] = p[k]; if (inputs[k]) inputs[k].value = p[k]; }
  });
  clear(materialDlg.body).append(
    labelled('mat-preset', 'Material', sel),
    h('div', { class: 'form-grid' }, show.map((k) => labelled(`mat-${k}`, FIELDS[k][0], inputs[k], FIELDS[k][1]))),
    h('p', { class: 'muted', text: `${note ? `${note} ` : ''}Library values are from ${MATERIAL_SOURCE}. Steel strengths are minimum values for hot-rolled (HR) or cold-drawn (CD) bar.` }));
  clear(materialDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: materialDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: 'Use this material', onClick: () => { materialDlg.close(); onApply(draft); } }));
  materialDlg.open();
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
const unitsDlg = makeDialog('Units');
/** `onApply(units, mode)` with mode 'convert' (same physical model) or 'relabel'. */
export function openUnitsDialog({ units, onApply }) {
  const draft = { ...units };
  let mode = 'convert';
  const names = { force: 'Force', length: 'Length along the member', small: 'Section sizes and deflection', stress: 'Stress and strength', modulus: 'E and G', angle: 'Slope and twist' };
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
    h('div', { class: 'radio-row' }, radio('convert', 'Convert the numbers I have entered (the model stays the same)'),
      radio('relabel', 'Keep my numbers and only change the units they are read in')),
    h('p', { class: 'muted', text: 'Derived units follow from these: moments in force × length, distributed loads in force per length, I and J in section size to the fourth power.' }));
  clear(unitsDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: unitsDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: 'Apply units', onClick: () => { unitsDlg.close(); onApply({ ...draft }, mode); } }));
  unitsDlg.open();
}

// ---------------------------------------------------------------------------
// Save / export, open, confirm, information
// ---------------------------------------------------------------------------
const textDlg = makeDialog('Export', { wide: true });
export function openExport(title, filename, text, type) {
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

const openDlg = makeDialog('Open a saved model');
/** `onText(text)` returns true when the text was a valid saved model. */
export function openImport({ onText }) {
  const area = h('textarea', { id: 'open-text', class: 'export', placeholder: 'Or paste the contents of a saved .json file here', 'aria-label': 'Saved model as text' });
  const status = h('span', { class: 'muted', role: 'status' });
  const file = h('input', { id: 'open-file', type: 'file', accept: '.json,application/json' });
  file.addEventListener('change', async () => { if (file.files[0]) area.value = await file.files[0].text(); });
  clear(openDlg.body).append(labelled('open-file', 'Saved file', file), area, status);
  clear(openDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: openDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: 'Open', onClick: () => {
      if (onText(area.value)) openDlg.close();
      else status.textContent = 'That is not a model saved from this calculator.';
    } }));
  openDlg.open();
}

const confirmDlg = makeDialog('Confirm');
export function openConfirm({ title, text, action, onConfirm }) {
  confirmDlg.dialog.querySelector('h2').textContent = title;
  clear(confirmDlg.body).append(h('p', { text }));
  clear(confirmDlg.foot).append(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: confirmDlg.close }),
    h('button', { class: 'btn primary', type: 'button', text: action, onClick: () => { confirmDlg.close(); onConfirm(); } }));
  confirmDlg.open();
}

const infoDlg = makeDialog('Information', { wide: true });
export function openInfo(title, content) {
  infoDlg.dialog.querySelector('h2').textContent = title;
  infoDlg.dialog.setAttribute('aria-label', title);
  clear(infoDlg.body).append(content);
  clear(infoDlg.foot).append(h('button', { class: 'btn primary', type: 'button', text: 'Close', onClick: infoDlg.close }));
  infoDlg.open();
}

/** Parse saved text; returns the object when it is a version-1 model of the given kind. */
export function parseSaved(text, kind) {
  try {
    const m = JSON.parse(text);
    if (!m || m.version !== 1 || !m.units) return null;
    if ((m.kind ?? 'beam') !== kind) return null;
    return m;
  } catch { return null; }
}

/** Shared message box renderer: kind is 'error' or 'note'. */
export function showMessages(box, kind, heading, items) {
  if (!items.length) return;
  box.append(h('div', { class: `msg ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    heading ? h('strong', { text: heading }) : null,
    items.length === 1 && !heading ? items[0] : h('ul', {}, items.map((t) => h('li', { text: t })))));
}

export const fileSlug = (title, fallback) => (title || fallback).trim().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || fallback;
