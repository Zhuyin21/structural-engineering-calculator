// Editable input tables shared by the calculators.
import { h } from './dom.js';
import { parseNum } from '../core/inputs.js';

export const th = (text, unit) => h('th', { scope: 'col' }, text, unit ? h('span', { class: 'unit', text: unit }) : null);

/** A numeric cell bound to row[key]; `onChange` runs after every keystroke. */
export function numCell(prefix, row, i, key, label, onChange, opts = {}) {
  const inp = h('input', { id: `${prefix}-${i}-${key}`, class: 'num-in', type: 'text', inputMode: 'decimal', value: row[key] ?? '',
    placeholder: opts.placeholder ?? '', 'aria-label': `${label}, row ${i + 1}` });
  inp.addEventListener('input', () => {
    row[key] = inp.value.trim();
    inp.classList.toggle('bad', inp.value.trim() !== '' && parseNum(inp.value) === null);
    onChange();
  });
  return h('td', {}, inp);
}

export function selectCell(prefix, row, i, key, options, label, onChange) {
  const sel = h('select', { id: `${prefix}-${i}-${key}`, 'aria-label': `${label}, row ${i + 1}` },
    Object.entries(options).map(([value, text]) => h('option', { value, text, selected: row[key] === value })));
  sel.addEventListener('change', () => { row[key] = sel.value; onChange(true); });
  return h('td', {}, sel);
}

/**
 * A titled panel holding one input table.
 *   rows       the array being edited (mutated in place)
 *   rowCells   (row, i) => array of <td>
 *   onAdd      pushes a new row
 *   changed    (structural) => void, called after add or delete with true
 */
export function tablePanel({ id, title, hint, heads, rows, rowCells, onAdd, addLabel, empty, note, changed, minRows = 0 }) {
  const tbody = h('tbody', {});
  rows.forEach((row, i) => {
    tbody.append(h('tr', {}, h('td', { class: 'idx', text: i + 1 }), rowCells(row, i),
      h('td', {}, rows.length > minRows ? h('button', { class: 'del', type: 'button', 'aria-label': `Delete ${title.toLowerCase()} row ${i + 1}`, text: '×',
        onClick: () => { rows.splice(i, 1); changed(true); } }) : null)));
  });
  if (!rows.length) tbody.append(h('tr', { class: 'empty-row' }, h('td', { colSpan: heads.length + 2, text: empty })));
  return h('section', { class: 'panel', id },
    h('div', { class: 'panel-head' }, h('h2', { text: title }), h('span', { class: 'hint', text: hint }),
      h('button', { class: 'btn small', type: 'button', text: addLabel,
        onClick: () => { onAdd(); changed(true); document.querySelector(`#${id} tbody tr:last-child input, #${id} tbody tr:last-child select`)?.focus(); } })),
    h('div', { class: 'panel-body' },
      h('div', { class: 'scroll-x' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}), heads, h('th', {}))), tbody)),
      note ? h('p', { class: 'table-note', text: note }) : null));
}

export const pick = (id, label, value, onClick) => h('button', { id, class: 'pick', type: 'button', onClick },
  h('span', { class: 'label', text: label }), h('span', { class: 'value', text: value }));
