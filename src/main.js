// App shell: the menu bar, and switching between analyses. Each analysis
// (beam, bar, column, ...) is a module that owns one section of the page and
// exposes the same small interface:
//   id, label, helpTitle, examples: [{ title, load() }],
//   init(), show(), newModel(), saveText(), openText(text) -> bool,
//   csv() -> string | null, fileName(ext), help() -> element
// To add a calculator: write its module, add its section to index.html, and
// list it in ANALYSES below.
import { h, buildMenus } from './ui/dom.js';
import { openExport, openImport, openConfirm, openInfo } from './ui/dialogs.js';
import { MATERIAL_SOURCE } from './core/materials.js';
import { beam } from './beam/app.js';
import { bar } from './bar/app.js';
import { column } from './column/app.js';
import { kt } from './kt/app.js';

const REPO_URL = 'https://github.com/Zhuyin21/structural-engineering-calculator';
const ANALYSES = [beam, bar, column, kt];
const PLANNED = ['Shaft', 'Truss', 'Frame'];
const $ = (id) => document.getElementById(id);

let current = null;
const started = new Set();

function show(id, fromHash = false) {
  const next = ANALYSES.find((a) => a.id === id) ?? ANALYSES[0];
  for (const a of ANALYSES) $(`analysis-${a.id}`).hidden = a !== next;
  current = next;
  $('brand-tool').textContent = next.label;
  if (!started.has(next.id)) { started.add(next.id); next.init(); } else next.show();
  if (!fromHash) { try { history.replaceState(null, '', `#${next.id}`); } catch { location.hash = next.id; } }
}

function about() {
  return h('div', { class: 'help' },
    h('p', { text: 'Open-source calculators for engineering students to check their homework: beams, bars, columns and stress concentration, with shafts, trusses and frames planned.' }),
    h('p', { text: `Formulas and material properties follow ${MATERIAL_SOURCE.replace(', Tables A-5 and A-20', '')} (Budynas and Nisbett). Each analysis lists the equations it uses under Help.` }),
    h('p', {}, 'Source code, tests and issue tracker: ', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener', text: REPO_URL.replace('https://', '') })),
    h('p', { class: 'muted', text: 'MIT licence. Results are for learning; check anything that matters independently.' }));
}

buildMenus($('menus'), [
  { label: 'File', items: () => {
    const csv = current.csv();
    return [
      { label: `New ${current.label.toLowerCase()}`, onSelect: () => openConfirm({ title: `Start a new ${current.label.toLowerCase()}?`,
        text: 'The current model will be cleared. Save it first if you want to keep it.', action: `New ${current.label.toLowerCase()}`, onConfirm: () => current.newModel() }) },
      { label: 'Open…', onSelect: () => openImport({ onText: (text) => {
        if (current.openText(text)) return true;
        const other = ANALYSES.find((a) => a !== current && a.openText(text));     // a file saved from another analysis
        if (other) { show(other.id); return true; }
        return false;
      } }) },
      { label: 'Save…', onSelect: () => openExport(`Save this ${current.label.toLowerCase()}`, current.fileName('json'), current.saveText(), 'application/json') },
      'sep',
      { label: 'Export results (CSV)…', disabled: !csv, tag: csv ? '' : ['column', 'kt'].includes(current.id) ? 'not for this analysis' : 'solve first',
        onSelect: () => openExport('Export results', current.fileName('csv'), csv, 'text/csv') },
    ];
  } },
  { label: 'Analysis', items: () => [
    ...ANALYSES.map((a) => ({ label: a.label, current: a === current, tag: a === current ? 'open' : '', onSelect: () => show(a.id) })),
    'sep',
    ...PLANNED.map((label) => ({ label, disabled: true, tag: 'planned' })),
  ] },
  // One submenu per analysis; picking an example switches to that analysis and loads it.
  { label: 'Examples', items: () => ANALYSES.map((a) => ({ label: a.label,
    items: a.examples.map((ex) => ({ label: ex.title, onSelect: () => { show(a.id); ex.load(); } })) })) },
  { label: 'Help', items: () => [
    { label: `${current.label}: conventions and formulas`, onSelect: () => openInfo(current.helpTitle, current.help()) },
    { label: 'About', onSelect: () => openInfo('About', about()) },
  ] },
]);

const fromHash = () => (location.hash || '').replace('#', '');
window.addEventListener('hashchange', () => { if (fromHash() !== current?.id && ANALYSES.some((a) => a.id === fromHash())) show(fromHash(), true); });
show(fromHash() || 'beam', true);
