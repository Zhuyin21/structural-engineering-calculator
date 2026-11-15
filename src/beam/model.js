// The beam model as the student edits it (in their chosen units), and its
// translation into SI input for the solver. No DOM code in this file.

import { DEFAULT_UNITS, UNIT_PRESETS, unitTable, convert } from '../core/units.js';
import { SHAPES, sectionProps, peakStress } from '../core/sections.js';
import { MATERIALS } from '../core/materials.js';
import { compile } from '../core/expr.js';

const ALL = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
export const SUPPORT_TYPES = {
  fixed:   { label: 'Fixed wall', holds: ALL, hint: 'Holds every movement and rotation' },
  pin:     { label: 'Pin', holds: { ux: true, uy: true, uz: true }, hint: 'Holds x, y and z; free to rotate' },
  roller:  { label: 'Roller', holds: { uy: true, uz: true }, hint: 'Holds y and z; free along x' },
  rollerY: { label: 'Roller (y only)', holds: { uy: true }, hint: 'Holds y only' },
  rollerZ: { label: 'Roller (z only)', holds: { uz: true }, hint: 'Holds z only' },
  spring:  { label: 'Spring', holds: {}, hint: 'Elastic support with stiffness in y and z' },
  custom:  { label: 'Custom', holds: null, hint: 'Choose which movements are held' },
};
export const DIRECTIONS = {
  y: { label: 'y', kind: 'distForce' },
  z: { label: 'z', kind: 'distForce' },
  x: { label: 'x (axial)', kind: 'distForce' },
  t: { label: 'Torque', kind: 'distMoment' },
};
export const PROFILES = { uniform: 'Uniform', linear: 'Linear', formula: 'Formula' };

const blank = (v) => v === null || v === undefined || v === '';
/** Number typed by the student, or null when the cell is blank or not a number. */
export function parseNum(v) {
  if (blank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(/−/g, '-'));
  return Number.isFinite(n) ? n : null;
}
const isBlankRow = (row, keys) => keys.every((k) => blank(row[k]));

export function emptyModel(units = DEFAULT_UNITS) {
  return {
    version: 1, title: 'Untitled beam', units: { ...units }, length: '',
    section: { shape: 'none', dims: {}, custom: {} },
    material: { id: 'steel', E: '', G: '' },
    supports: [], pointLoads: [], moments: [], distLoads: [],
  };
}

/** Material preset values expressed in the model's modulus unit. */
export function materialPreset(id, units) {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m || m.E === null) return null;
  const f = unitTable(units).modulus.f;
  return { id, E: +(m.E / f).toPrecision(6), G: +(m.G / f).toPrecision(6) };
}

/** Default dimensions for a library shape in the model's section unit. */
export function shapeDefaults(shape, units) {
  const def = SHAPES[shape];
  if (!def) return {};
  const f = unitTable(units).dim.f;
  const metric = units.small === 'mm' || units.small === 'm';
  const out = {};
  for (const [k, v] of Object.entries(def.defaults)) {
    // Round to tidy values in whichever system is in use.
    const val = v / f;
    out[k] = metric ? +val.toPrecision(4) : +(Math.round(val * 8) / 8 || +val.toPrecision(2)).toPrecision(4);
  }
  return out;
}

/** Section properties in SI, or { none: true } / { error }. */
export function sectionSI(model) {
  const t = unitTable(model.units);
  const sec = model.section || { shape: 'none' };
  if (sec.shape === 'none') return { none: true, shape: 'none' };
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

/**
 * Translate the model into solver input (SI). Returns { input, section,
 * errors }. Rows that are completely blank are ignored.
 */
export function toSolverInput(model) {
  const errors = [];
  const t = unitTable(model.units);
  const L = parseNum(model.length);
  if (L === null || !(L > 0)) errors.push('Enter a beam length greater than zero.');
  const Lsi = (L || 0) * t.length.f;

  const section = sectionSI(model);
  if (section.error) errors.push(section.error);
  const p = section.props || {};
  const E = parseNum(model.material?.E), G = parseNum(model.material?.G);
  if (E !== null && !(E > 0)) errors.push('Material: E must be positive.');
  if (G !== null && !(G > 0)) errors.push('Material: G must be positive.');

  const need = (row, key, name, what) => {
    const v = parseNum(row[key]);
    if (v === null) errors.push(`${name}: enter ${what}.`);
    return v ?? 0;
  };
  const opt = (row, key) => parseNum(row[key]) ?? 0;

  const supports = [];
  (model.supports || []).forEach((s, i) => {
    if (isBlankRow(s, ['x'])) { errors.push(`Support ${i + 1}: enter a position.`); return; }
    const name = `Support ${i + 1}`;
    const type = SUPPORT_TYPES[s.type] ? s.type : 'pin';
    const out = { x: need(s, 'x', name, 'a position') * t.length.f };
    const holds = type === 'custom' ? (s.holds || {}) : SUPPORT_TYPES[type].holds;
    for (const k of Object.keys(ALL)) out[k] = !!holds[k];
    if (type === 'spring') {
      const ky = opt(s, 'ky'), kz = opt(s, 'kz');
      if (ky < 0 || kz < 0) errors.push(`${name}: spring stiffness cannot be negative.`);
      if (ky === 0 && kz === 0) errors.push(`${name}: enter a spring stiffness.`);
      out.kuy = ky * t.kTrans.f; out.kuz = kz * t.kTrans.f;
    }
    if (type === 'custom' && !Object.values(out).some((v) => v === true)) errors.push(`${name}: tick at least one movement to hold.`);
    supports.push(out);
  });

  const pointLoads = [];
  (model.pointLoads || []).forEach((r, i) => {
    if (isBlankRow(r, ['x', 'Fx', 'Fy', 'Fz'])) return;
    const name = `Point load ${i + 1}`;
    pointLoads.push({ x: need(r, 'x', name, 'a position') * t.length.f,
      Fx: opt(r, 'Fx') * t.force.f, Fy: opt(r, 'Fy') * t.force.f, Fz: opt(r, 'Fz') * t.force.f });
  });

  const moments = [];
  (model.moments || []).forEach((r, i) => {
    if (isBlankRow(r, ['x', 'Mx', 'My', 'Mz'])) return;
    const name = `Moment ${i + 1}`;
    moments.push({ x: need(r, 'x', name, 'a position') * t.length.f,
      Mx: opt(r, 'Mx') * t.moment.f, My: opt(r, 'My') * t.moment.f, Mz: opt(r, 'Mz') * t.moment.f });
  });

  const distLoads = [];
  (model.distLoads || []).forEach((r, i) => {
    if (isBlankRow(r, ['x1', 'x2', 'w1', 'w2', 'expr'])) return;
    const name = `Distributed load ${i + 1}`;
    const dir = DIRECTIONS[r.dir] ? r.dir : 'y';
    const f = t[DIRECTIONS[dir].kind].f;
    const q = { x1: need(r, 'x1', name, 'a start position') * t.length.f,
      x2: need(r, 'x2', name, 'an end position') * t.length.f, dir };
    if (r.profile === 'formula') {
      try {
        const fn = compile(String(r.expr ?? ''));
        const Lf = t.length.f;
        q.w = (xsi) => fn({ x: xsi / Lf, L: L || 0 }) * f;
      } catch (e) { errors.push(`${name}: ${e.message}.`); return; }
    } else {
      q.w1 = need(r, 'w1', name, 'a load value') * f;
      q.w2 = r.profile === 'linear' ? need(r, 'w2', name, 'an end value') * f : q.w1;
    }
    distLoads.push(q);
  });

  const input = {
    L: Lsi,
    E: E === null ? null : E * t.modulus.f, G: G === null ? null : G * t.modulus.f,
    A: p.A ?? null, Iy: p.Iy ?? null, Iz: p.Iz ?? null, J: p.J ?? null,
    supports, pointLoads, moments, distLoads,
  };
  return { input, section, errors };
}

/** Largest stresses along the beam, in Pa, with where they occur (m). */
export function stressSummary(result, section) {
  if (!result?.ok || !section?.props || !(section.props.A > 0)) return null;
  const best = { sigma: null, tauVy: null, tauVz: null, tauT: null };
  for (let i = 0; i < result.x.length; i++) {
    const s = peakStress(section.shape, section.dims, section.props, {
      N: result.N[i], Mz: result.Mz[i], My: result.My[i], Vy: result.Vy[i], Vz: result.Vz[i], T: result.T[i],
    });
    if (!s) return null;
    for (const k of Object.keys(best)) {
      if (s[k] !== null && (best[k] === null || s[k] > best[k].value)) best[k] = { value: s[k], x: result.x[i] };
    }
  }
  return best;
}

/**
 * Things worth telling the student about a solved model that are not errors.
 * `len` formats a length given in metres.
 */
export function modelNotes(input, section, result, len = (v) => `${v} m`) {
  const notes = [];
  const tol = 1e-9 * input.L;
  const xs = [...input.supports.map((s) => s.x)].sort((a, b) => a - b);
  const twins = xs.filter((x, i) => i > 0 && x - xs[i - 1] <= tol);
  for (const x of [...new Set(twins)]) notes.push(`Two supports share the position x = ${len(x)}. They act together as one support, with one combined reaction.`);

  // Euler-Bernoulli theory leaves out shear deformation, which matters for stubby beams.
  const p = section?.props;
  const distinct = xs.filter((x, i) => i === 0 || x - xs[i - 1] > tol);
  if (p && distinct.length) {
    let span = Infinity;
    if (distinct.length === 1) span = Math.max(distinct[0], input.L - distinct[0]);
    else for (let i = 1; i < distinct.length; i++) span = Math.min(span, distinct[i] - distinct[i - 1]);
    const depth = Math.max(result.active.xy && result.available.xy ? 2 * (p.cy || 0) : 0,
      result.active.xz && result.available.xz ? 2 * (p.cz || 0) : 0);
    if (depth > 0 && span / depth < 8) {
      notes.push(`This beam is short for its depth (span of ${len(span)} is ${(span / depth).toFixed(1)} times the section depth). The calculator ignores shear deformation, so the real deflection will be noticeably larger; reactions, shear and moment are not affected${distinct.length > 2 ? ' much' : ''}.`);
    }
  }
  return notes;
}

// --- unit changes ----------------------------------------------------------
const FIELD_KINDS = {
  supports: { x: 'length', ky: 'kTrans', kz: 'kTrans' },
  pointLoads: { x: 'length', Fx: 'force', Fy: 'force', Fz: 'force' },
  moments: { x: 'length', Mx: 'moment', My: 'moment', Mz: 'moment' },
};

/** The same physical model expressed in different units. Formula text is left as typed. */
export function convertModel(model, units) {
  const from = model.units, cv = (v, kind) => convert(parseNum(v) ?? '', kind, from, units);
  const out = structuredClone(model);
  out.units = { ...units };
  out.length = cv(model.length, 'length');
  for (const [table, kinds] of Object.entries(FIELD_KINDS)) {
    out[table] = (model[table] || []).map((row) => {
      const r = { ...row };
      for (const [k, kind] of Object.entries(kinds)) if (k in r) r[k] = cv(r[k], kind);
      return r;
    });
  }
  out.distLoads = (model.distLoads || []).map((row) => {
    const kind = DIRECTIONS[row.dir]?.kind || 'distForce';
    return { ...row, x1: cv(row.x1, 'length'), x2: cv(row.x2, 'length'), w1: cv(row.w1, kind), w2: cv(row.w2, kind) };
  });
  const sec = out.section || {};
  if (sec.dims) for (const k of Object.keys(sec.dims)) sec.dims[k] = cv(sec.dims[k], 'dim');
  if (sec.custom) {
    const kinds = { A: 'area', Iy: 'inertia', Iz: 'inertia', J: 'inertia', cy: 'dim', cz: 'dim' };
    for (const k of Object.keys(sec.custom)) sec.custom[k] = cv(sec.custom[k], kinds[k] || 'none');
  }
  if (out.material) { out.material.E = cv(model.material.E, 'modulus'); out.material.G = cv(model.material.G, 'modulus'); }
  return out;
}

// --- worked examples -------------------------------------------------------
const SI = UNIT_PRESETS['kN, m'];
const steel = () => ({ id: 'steel', E: 200, G: 77 });
const base = (title, length, section) => ({ ...emptyModel(SI), title, length, section, material: steel() });
const rect = { shape: 'rect', dims: { b: 100, h: 200 }, custom: {} };

export const EXAMPLES = [
  { ...base('Simply supported, point load', 6, rect),
    supports: [{ type: 'pin', x: 0 }, { type: 'roller', x: 6 }],
    pointLoads: [{ x: 2, Fx: '', Fy: -12, Fz: '' }] },
  { ...base('Cantilever, uniform load', 3, rect),
    supports: [{ type: 'fixed', x: 0 }],
    distLoads: [{ x1: 0, x2: 3, dir: 'y', profile: 'uniform', w1: -5, w2: '', expr: '' }] },
  { ...base('Overhanging beam', 8, rect),
    supports: [{ type: 'pin', x: 0 }, { type: 'roller', x: 6 }],
    pointLoads: [{ x: 8, Fx: '', Fy: -10, Fz: '' }],
    distLoads: [{ x1: 0, x2: 6, dir: 'y', profile: 'uniform', w1: -4, w2: '', expr: '' }] },
  { ...base('Propped cantilever, triangular load', 5, rect),
    supports: [{ type: 'fixed', x: 0 }, { type: 'roller', x: 5 }],
    distLoads: [{ x1: 0, x2: 5, dir: 'y', profile: 'linear', w1: 0, w2: -9, expr: '' }] },
  { ...base('Continuous beam, two spans', 8, { shape: 'ibeam', dims: { h: 300, bf: 150, tf: 10.7, tw: 7.1 }, custom: {} }),
    supports: [{ type: 'pin', x: 0 }, { type: 'roller', x: 4 }, { type: 'roller', x: 8 }],
    distLoads: [{ x1: 0, x2: 8, dir: 'y', profile: 'uniform', w1: -6, w2: '', expr: '' }],
    moments: [] },
  { ...base('Sinusoidal load (formula)', 4, rect),
    supports: [{ type: 'pin', x: 0 }, { type: 'roller', x: 4 }],
    distLoads: [{ x1: 0, x2: 4, dir: 'y', profile: 'formula', w1: '', w2: '', expr: '-5*sin(pi*x/L)' }] },
  { ...base('Two planes with torque (round bar)', 1, { shape: 'circle', dims: { d: 40 }, custom: {} }),
    supports: [{ type: 'pin', x: 0 }, { type: 'roller', x: 0.8 }],
    pointLoads: [{ x: 0.3, Fx: '', Fy: -2, Fz: 1.5 }, { x: 1, Fx: '', Fy: -0.8, Fz: '' }],
    moments: [{ x: 0.3, Mx: 0.2, My: '', Mz: '' }, { x: 1, Mx: -0.2, My: '', Mz: '' }] },
];
