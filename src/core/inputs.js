// What the student enters for a section and a material (in their units),
// and its translation to SI. Shared by every calculator. No DOM code.
import { unitTable, convert, fmt } from './units.js';
import { SHAPES, sectionProps } from './sections.js';
import { MATERIALS, DEFAULT_MATERIAL } from './materials.js';

const blank = (v) => v === null || v === undefined || v === '';

/** Number typed by the student, or null when the cell is blank or not a number. */
export function parseNum(v) {
  if (blank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(/−/g, '-'));
  return Number.isFinite(n) ? n : null;
}

// --- sections ----------------------------------------------------------------
export const emptySection = () => ({ shape: 'none', dims: {}, custom: {} });

/** Default dimensions for a library shape in the given section unit. */
export function shapeDefaults(shape, units) {
  const def = SHAPES[shape];
  if (!def) return {};
  const f = unitTable(units).dim.f;
  const metric = units.small === 'mm' || units.small === 'm';
  const out = {};
  for (const [k, v] of Object.entries(def.defaults)) {
    const val = v / f;                       // tidy values in whichever system is in use
    out[k] = metric ? +val.toPrecision(4) : +(Math.round(val * 8) / 8 || +val.toPrecision(2)).toPrecision(4);
  }
  return out;
}

/** Section properties in SI: { shape, dims, props } or { none: true } or { error }. */
export function sectionSI(units, sec) {
  const t = unitTable(units);
  if (!sec || sec.shape === 'none') return { none: true, shape: 'none' };
  if (sec.shape === 'custom') {
    const c = sec.custom || {};
    const get = (k, kind) => { const v = parseNum(c[k]); return v === null ? null : v * t[kind].f; };
    const props = { A: get('A', 'area'), Iy: get('Iy', 'inertia'), Iz: get('Iz', 'inertia'), J: get('J', 'inertia'),
      cy: get('cy', 'dim'), cz: get('cz', 'dim') };
    for (const [k, v] of Object.entries(props)) if (v !== null && !(v > 0)) return { error: `Section: ${k} must be positive.` };
    return { shape: 'custom', dims: {}, props };
  }
  const def = SHAPES[sec.shape];
  if (!def) return { error: 'Section: unknown shape.' };
  const dims = {};
  for (const [k, label] of def.dims) {
    const v = parseNum((sec.dims || {})[k]);
    if (v === null) return { error: `Section: enter ${label.toLowerCase()}.` };
    dims[k] = v * t.dim.f;
  }
  const props = sectionProps(sec.shape, dims);
  if (props.error) return { error: `Section: ${props.error}.` };
  return { shape: sec.shape, dims, props };
}

export function sectionSummary(units, sec) {
  if (!sec || sec.shape === 'none') return 'None';
  const u = unitTable(units);
  if (sec.shape === 'custom') {
    const A = parseNum(sec.custom?.A);
    return A === null ? 'Custom values' : `Custom, A = ${fmt(A, 4)} ${u.area.label}`;
  }
  const def = SHAPES[sec.shape];
  return `${def.label} ${def.dims.map(([k]) => fmt(parseNum(sec.dims[k]), 4)).join(' × ')} ${u.dim.label}`;
}

export function convertSection(sec, from, to) {
  const out = structuredClone(sec || emptySection());
  const cv = (v, kind) => convert(parseNum(v) ?? '', kind, from, to);
  for (const k of Object.keys(out.dims || {})) out.dims[k] = cv(out.dims[k], 'dim');
  const kinds = { A: 'area', Iy: 'inertia', Iz: 'inertia', J: 'inertia', cy: 'dim', cz: 'dim' };
  for (const k of Object.keys(out.custom || {})) out.custom[k] = cv(out.custom[k], kinds[k] || 'none');
  return out;
}

// --- materials ---------------------------------------------------------------
/** A library material expressed in the given units, ready to store in a model. */
export function materialPreset(id, units) {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m || m.E === null) return null;
  const t = unitTable(units);
  const r = (v, f) => (v === null ? '' : +(v / f).toPrecision(5));
  return { id, E: r(m.E, t.modulus.f), G: r(m.G, t.modulus.f), nu: m.nu ?? '', Sy: r(m.Sy, t.stress.f), Sut: r(m.Sut, t.stress.f) };
}
export const defaultMaterial = (units) => materialPreset(DEFAULT_MATERIAL, units);
export const materialName = (mat) => MATERIALS.find((m) => m.id === mat?.id)?.name ?? 'Custom';

/** Material in SI (null for anything left blank), plus any error messages. */
export function materialSI(units, mat) {
  const t = unitTable(units), errors = [];
  const get = (k, f, label) => {
    const v = parseNum(mat?.[k]);
    if (v !== null && !(v > 0)) { errors.push(`Material: ${label} must be positive.`); return null; }
    return v === null ? null : v * f;
  };
  const out = { E: get('E', t.modulus.f, 'E'), G: get('G', t.modulus.f, 'G'), Sy: get('Sy', t.stress.f, 'Sy'), Sut: get('Sut', t.stress.f, 'Sut'), nu: parseNum(mat?.nu) };
  return { ...out, errors };
}

export function materialSummary(units, mat) {
  const E = parseNum(mat?.E);
  if (E === null) return 'Not set';
  return `${materialName(mat)} · E ${fmt(E, 4)} ${unitTable(units).modulus.label}`;
}

export function convertMaterial(mat, from, to) {
  const cv = (v, kind) => convert(parseNum(v) ?? '', kind, from, to);
  return { ...mat, E: cv(mat?.E, 'modulus'), G: cv(mat?.G, 'modulus'), Sy: cv(mat?.Sy, 'stress'), Sut: cv(mat?.Sut, 'stress') };
}
