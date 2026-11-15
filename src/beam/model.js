// The beam model as the student edits it (in their chosen units), and its
// translation into SI input for the solver. No DOM code in this file.

import { DEFAULT_UNITS, UNIT_PRESETS, FORCE, LENGTH, unitTable, convert } from '../core/units.js';
import { peakStress } from '../core/sections.js';
import { compile } from '../core/expr.js';
import {
  parseNum, sectionSI as sectionOf, emptySection, shapeDefaults, materialPreset, defaultMaterial, materialSI,
  convertSection, convertMaterial,
} from '../core/inputs.js';

export { parseNum, shapeDefaults, materialPreset };
/** Section properties of a beam model, in SI. */
export const sectionSI = (model) => sectionOf(model.units, model.section);

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
const isBlankRow = (row, keys) => keys.every((k) => blank(row[k]));

export function emptyModel(units = DEFAULT_UNITS) {
  return {
    version: 1, kind: 'beam', title: 'Untitled beam', units: { ...units }, length: '',
    section: emptySection(), material: defaultMaterial(units),
    supports: [], pointLoads: [], moments: [], distLoads: [],
  };
}

/** The units a formula load was written in (falls back to the model's units). */
export const formulaUnits = (row, units) => ({ force: row.exprUnits?.force in FORCE ? row.exprUnits.force : units.force,
  length: row.exprUnits?.length in LENGTH ? row.exprUnits.length : units.length });

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
  const material = materialSI(model.units, model.material);
  errors.push(...material.errors);

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
        // A formula is always read in the units it was written in, so changing
        // the model's units later does not change the load.
        const fn = compile(String(r.expr ?? ''));
        const fu = formulaUnits(r, model.units);
        const Lf = LENGTH[fu.length], ff = dir === 't' ? FORCE[fu.force] : FORCE[fu.force] / Lf;
        q.w = (xsi) => fn({ x: xsi / Lf, L: Lsi / Lf }) * ff;
      } catch (e) { errors.push(`${name}: ${e.message}.`); return; }
    } else {
      q.w1 = need(r, 'w1', name, 'a load value') * f;
      q.w2 = r.profile === 'linear' ? need(r, 'w2', name, 'an end value') * f : q.w1;
    }
    distLoads.push(q);
  });

  const input = {
    L: Lsi,
    E: material.E, G: material.G,
    A: p.A ?? null, Iy: p.Iy ?? null, Iz: p.Iz ?? null, J: p.J ?? null,
    supports, pointLoads, moments, distLoads,
  };
  return { input, section, material, errors };
}

/**
 * Stresses along the beam from beam theory, in Pa (Shigley, Secs. 3-10, 3-11
 * and 5-5). Torsion is deliberately left out. For a section symmetric about
 * y and z, two points of each cross-section are checked:
 *
 *   extreme fibre   bending from both planes plus axial; transverse shear is
 *                   zero there, so the von Mises stress is |sigma|
 *   neutral axis    transverse shear at its maximum plus the axial stress;
 *                   von Mises stress = sqrt(sigma_axial^2 + 3 tau^2)
 *
 * and the larger von Mises value is reported. Returns null without a usable
 * section, else { x, sigmaMax, sigmaMin, tau, vonMises } (arrays) and
 * { peak: { sigma, tauVy, tauVz, tauT, tau, vonMises } } with value and x.
 */
export function stressSeries(result, section) {
  const p = section?.props;
  if (!result?.ok || !p || !(p.A > 0)) return null;
  const n = result.x.length;
  const out = { x: result.x, sigmaMax: new Array(n), sigmaMin: new Array(n), tau: new Array(n), vonMises: new Array(n) };
  const peak = { sigma: null, tauVy: null, tauVz: null, tauT: null, tau: null, vonMises: null };
  const bump = (k, value, x) => { if (value !== null && (peak[k] === null || value > peak[k].value)) peak[k] = { value, x }; };
  const round = !!p.round, solid = section.shape === 'rect' || round;
  for (let i = 0; i < n; i++) {
    const f = { N: result.N[i], Mz: result.Mz[i], My: result.My[i], Vy: result.Vy[i], Vz: result.Vz[i], T: result.T[i] };
    const st = peakStress(section.shape, section.dims, p, f);
    if (!st || st.sigma === null) return null;
    const axial = f.N / p.A, bending = st.sigma - Math.abs(axial);
    out.sigmaMax[i] = axial + bending;
    out.sigmaMin[i] = axial - bending;
    // Shear from the two planes acts at the same point (the centroid) for solid
    // rectangles and round sections; for thin-walled shapes the peaks are apart.
    const ty = st.tauVy ?? 0, tz = st.tauVz ?? 0;
    out.tau[i] = round ? Math.hypot(ty, tz) : solid ? Math.hypot(ty, tz) : Math.max(ty, tz);
    out.vonMises[i] = Math.max(Math.abs(out.sigmaMax[i]), Math.abs(out.sigmaMin[i]), Math.sqrt(axial * axial + 3 * out.tau[i] ** 2));
    const x = result.x[i];
    bump('sigma', st.sigma, x); bump('tauVy', st.tauVy, x); bump('tauVz', st.tauVz, x); bump('tauT', st.tauT, x);
    bump('tau', out.tau[i], x); bump('vonMises', out.vonMises[i], x);
  }
  return { ...out, peak };
}

/** Largest stresses along the beam, in Pa, with where they occur (m). */
export function stressSummary(result, section) {
  return stressSeries(result, section)?.peak ?? null;
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
    if (depth > 0 && span / depth < 10) {
      notes.push(`Stubby beam: the span of ${len(span)} is only ${(span / depth).toFixed(1)} times the section depth. Beam theory is meant for ratios of 10 or more (Shigley, Secs. 4-4 and 7-5). Below that, shear deformation, which this calculator ignores, makes the real deflection larger than shown. Treat the deflection and slope as a lower bound.`);
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

/**
 * The same physical model expressed in different units. A formula load keeps
 * its text and the units it was written in (see formulaUnits), so it is
 * unchanged as well.
 */
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
    const out2 = { ...row, x1: cv(row.x1, 'length'), x2: cv(row.x2, 'length'), w1: cv(row.w1, kind), w2: cv(row.w2, kind) };
    if (row.profile === 'formula') out2.exprUnits = formulaUnits(row, from);
    return out2;
  });
  out.section = convertSection(model.section, from, units);
  out.material = convertMaterial(model.material, from, units);
  return out;
}

// --- worked examples -------------------------------------------------------
const SI = UNIT_PRESETS['kN, m'];
const steel = () => defaultMaterial(SI);            // AISI 1020 HR
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
