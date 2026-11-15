// What the student enters for a shaft (in their units) and its translation
// to SI for the solver. No DOM code.
//
// Stepped shaft: `sections` left to right, each with a length and a diameter.
// Section i also carries `sh`, the shoulder at its right end (the last
// section's is not used): what sits against it, the fillet radius or the
// width of the component, its loads and whether it has a keyseat.
// Uniform shaft: one outer diameter `od`, `segments` that are solid or hollow,
// and `elements` placed at typed positions.
import { DEFAULT_UNITS, UNIT_CHOICES, UNIT_PRESETS, unitTable, convert } from '../core/units.js';
import { parseNum, defaultMaterial, materialPreset, materialSI, convertMaterial } from '../core/inputs.js';
import { COMPONENTS, FINISHES, RELIABILITY, CRITERIA } from './solver.js';

export const LOAD_KEYS = ['Fy', 'Fz', 'T', 'My', 'Mz'];
const LOAD_KIND = { Fy: 'force', Fz: 'force', T: 'moment', My: 'moment', Mz: 'moment' };
const blankLoads = () => ({ Fy: '', Fz: '', T: '', My: '', Mz: '' });
export const emptyShoulder = (type = 'none') => ({ type, r: '', width: '', key: 'none', ...blankLoads() });
export const emptyElement = (type = 'load') => ({ x: '', type, ...blankLoads() });

export function emptyShaft(units = DEFAULT_UNITS) {
  return { version: 1, kind: 'shaft', title: 'Untitled shaft', units: { ...units }, material: defaultMaterial(units),
    mode: 'stepped', criterion: 'goodman', finish: 'machined', reliability: '99',
    sections: [{ length: '', d: '', sh: emptyShoulder('bearing') }, { length: '', d: '', sh: emptyShoulder('bearing') }, { length: '', d: '', sh: emptyShoulder() }],
    od: '', segments: [{ length: '', wall: '' }], elements: [emptyElement('bearing'), emptyElement('bearing')] };
}

export function normalizeShaft(m) {
  const base = emptyShaft();
  const out = { ...base, ...m, kind: 'shaft' };
  out.units = { ...base.units, ...(m.units || {}) };
  for (const [k, list] of Object.entries(UNIT_CHOICES)) if (!list.includes(out.units[k])) out.units[k] = DEFAULT_UNITS[k];
  out.material = { ...base.material, ...(m.material || {}) };
  if (!['stepped', 'uniform'].includes(out.mode)) out.mode = 'stepped';
  if (!CRITERIA[out.criterion]) out.criterion = 'goodman';
  if (!FINISHES[out.finish]) out.finish = 'machined';
  if (!(String(out.reliability) in RELIABILITY)) out.reliability = '99';
  out.reliability = String(out.reliability);
  out.sections = (Array.isArray(m.sections) && m.sections.length ? m.sections : base.sections).map((r) => {
    const sh = { ...emptyShoulder(), ...(r.sh || {}) };
    if (sh.type !== 'none' && (!COMPONENTS[sh.type] || sh.type === 'load')) sh.type = 'none';
    return { length: r.length ?? '', d: r.d ?? '', sh };
  });
  out.segments = (Array.isArray(m.segments) && m.segments.length ? m.segments : base.segments).map((r) => ({ length: r.length ?? '', wall: r.wall ?? '' }));
  out.elements = (Array.isArray(m.elements) ? m.elements : base.elements).map((r) => ({ ...emptyElement(), ...r, type: COMPONENTS[r.type] ? r.type : 'load' }));
  return out;
}

/** True when the curve fits in U.S. customary units should be used (stress in psi or ksi). */
export const usesUS = (units) => units.stress === 'psi' || units.stress === 'ksi';

/** Position of every joint between sections, and which side is the smaller, in display units. */
export function joints(m) {
  const out = [];
  let x = 0;
  for (let i = 0; i < m.sections.length - 1; i++) {
    const a = m.sections[i], b = m.sections[i + 1], len = parseNum(a.length);
    x = len === null || x === null ? null : x + len;
    const da = parseNum(a.d), db = parseNum(b.d);
    const ok = da > 0 && db > 0 && da !== db;
    out.push({ i, x, da, db, d: ok ? Math.min(da, db) : null, D: ok ? Math.max(da, db) : null, small: ok ? (da < db ? i : i + 1) : null, sh: a.sh });
  }
  return out;
}

/** The loaded components, in order, for the loads table: stepped from the shoulders, uniform from the elements. */
export function loadRows(m) {
  if (m.mode === 'uniform') return m.elements.map((e, i) => ({ row: e, type: e.type, x: parseNum(e.x), n: i + 1 })).filter((r) => r.type !== 'bearing');
  return joints(m).filter((j) => j.sh.type !== 'none' && j.sh.type !== 'bearing').map((j) => ({ row: j.sh, type: j.sh.type, x: j.x, n: j.i + 1 }));
}

/** Model in SI for the solver, with messages for anything missing. */
export function shaftInput(m) {
  const t = unitTable(m.units), errors = [];
  const mat = materialSI(m.units, m.material);
  errors.push(...mat.errors);
  const si = (v, kind) => { const n = parseNum(v); return n === null ? null : n * t[kind].f; };
  const loads = (row) => Object.fromEntries(LOAD_KEYS.map((k) => [k, si(row[k], LOAD_KIND[k]) ?? 0]));
  const input = { uniform: m.mode === 'uniform', material: { E: mat.E, G: mat.G, Sut: mat.Sut, Sy: mat.Sy },
    criterion: m.criterion, finish: m.finish, ke: RELIABILITY[m.reliability] ?? 1, us: usesUS(m.units) };
  if (input.uniform) {
    const d = si(m.od, 'dim');
    if (!(d > 0)) errors.push('Enter the outer diameter of the shaft.');
    input.sections = m.segments.map((r, i) => {
      const L = si(r.length, 'length');
      if (!(L > 0)) errors.push(`Segment ${i + 1}: enter a length.`);
      const wall = si(r.wall, 'dim');
      if (wall !== null && !(wall > 0)) errors.push(`Segment ${i + 1}: the wall thickness must be positive, or blank for a solid segment.`);
      return { L: L ?? 0, d: d ?? 0, t: wall > 0 ? wall : 0 };
    });
    input.elements = [];
    m.elements.forEach((r, i) => {
      const x = si(r.x, 'length');
      if (x === null) { errors.push(`Component ${i + 1}: enter a position.`); return; }
      input.elements.push({ x, type: r.type, ...loads(r) });
    });
  } else {
    input.sections = m.sections.map((r, i) => {
      const L = si(r.length, 'length'), d = si(r.d, 'dim');
      if (!(L > 0)) errors.push(`Section ${i + 1}: enter a length.`);
      if (!(d > 0)) errors.push(`Section ${i + 1}: enter a diameter.`);
      return { L: L ?? 0, d: d ?? 0, t: 0 };
    });
    input.shoulders = m.sections.slice(0, -1).map((r) => {
      const sh = r.sh || emptyShoulder();
      return { type: sh.type, r: si(sh.r, 'dim'), width: si(sh.width, 'length') ?? 0, key: sh.key === 'endmill', ...loads(sh) };
    });
  }
  return { input, material: mat, errors };
}

export function convertShaft(m, from, to) {
  const cv = (v, kind) => convert(parseNum(v) ?? '', kind, from, to);
  const cvLoads = (row) => Object.fromEntries(LOAD_KEYS.map((k) => [k, cv(row[k], LOAD_KIND[k])]));
  return { ...m, units: { ...to }, material: convertMaterial(m.material, from, to), od: cv(m.od, 'dim'),
    sections: m.sections.map((r) => ({ length: cv(r.length, 'length'), d: cv(r.d, 'dim'),
      sh: { ...r.sh, r: cv(r.sh.r, 'dim'), width: cv(r.sh.width, 'length'), ...cvLoads(r.sh) } })),
    segments: m.segments.map((r) => ({ length: cv(r.length, 'length'), wall: cv(r.wall, 'dim') })),
    elements: m.elements.map((r) => ({ ...r, x: cv(r.x, 'length'), ...cvLoads(r) })) };
}

// ---------------------------------------------------------------------------
const US = { ...UNIT_PRESETS['lbf, in'], stress: 'ksi', angle: 'deg' };
const MM = { ...UNIT_PRESETS['N, mm'] };
const sh = (type, rest = {}) => ({ ...emptyShoulder(type), ...rest });

export const SHAFT_EXAMPLES = [
  // Shigley Examples 7-2 and 7-3, Figure 7-10: bearings at 0.75 and 10.75 in,
  // gears centred at 2.75 and 8.50 in. The two plain shoulders (D2 to D3 and
  // D5 to D6) carry the retaining rings in the book; a 0.05 in fillet is assumed here.
  { ...emptyShaft(US), title: 'Countershaft with two gears (Shigley Ex. 7-2, 7-3)', material: materialPreset('aisi-1050-cd', US), reliability: '50',
    sections: [
      { length: 1.25, d: 1.0, sh: sh('bearing', { width: 1.0 }) },
      { length: 0.5, d: 1.4, sh: sh('none', { r: 0.05 }) },
      { length: 1.75, d: 1.625, sh: sh('gear', { width: 1.5, key: 'endmill', Fy: -197, Fz: 540, T: 3240 }) },
      { length: 4.0, d: 2.0, sh: sh('gear', { width: 2.0, key: 'endmill', Fy: -885, Fz: -2431, T: -3240 }) },
      { length: 2.25, d: 1.625, sh: sh('none', { r: 0.05 }) },
      { length: 0.5, d: 1.4, sh: sh('bearing', { width: 1.0 }) },
      { length: 1.25, d: 1.0, sh: sh() },
    ] },
  { ...emptyShaft(MM), title: 'Pulley and gear between bearings', material: materialPreset('aisi-1040-cd', MM),
    sections: [
      { length: 30, d: 25, sh: sh('bearing', { width: 16 }) },
      { length: 70, d: 32, sh: sh('pulley', { width: 40, key: 'endmill', Fy: -1800, T: 120000 }) },
      { length: 120, d: 40, sh: sh('gear', { width: 36, key: 'endmill', Fy: 900, Fz: -2400, T: -120000 }) },
      { length: 80, d: 32, sh: sh('bearing', { width: 16 }) },
      { length: 30, d: 25, sh: sh() },
    ] },
  { ...emptyShaft(MM), title: 'Overhung pulley', material: materialPreset('aisi-1045-cd', MM), criterion: 'gerber',
    sections: [
      { length: 60, d: 28, sh: sh('pulley', { width: 44, key: 'endmill', Fy: -1500, T: -90000 }) },
      { length: 20, d: 35, sh: sh('bearing', { width: 18 }) },
      { length: 110, d: 44, sh: sh('gear', { width: 40, key: 'endmill', Fz: 2200, T: 90000 }) },
      { length: 90, d: 36, sh: sh('bearing', { width: 18 }) },
      { length: 24, d: 30, sh: sh() },
    ] },
  { ...emptyShaft(MM), title: 'Uniform shaft, part hollow', mode: 'uniform', material: materialPreset('aisi-1035-cd', MM), od: 50,
    segments: [{ length: 200, wall: '' }, { length: 300, wall: 8 }, { length: 200, wall: '' }],
    elements: [
      { ...emptyElement('bearing'), x: 0 },
      { ...emptyElement('pulley'), x: 200, Fy: -2500, T: 180000 },
      { ...emptyElement('gear'), x: 500, Fz: 3600, T: -180000 },
      { ...emptyElement('bearing'), x: 700 },
    ] },
];
