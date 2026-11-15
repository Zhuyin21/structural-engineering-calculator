// Tiny DOM helpers shared by every calculator page.
const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(node, attrs, children, svg) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (!svg && k in node && k !== 'list' && k !== 'form') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Create an HTML element: h('button', { class: 'btn', onClick }, 'Label') */
export const h = (tag, attrs, ...children) => apply(document.createElement(tag), attrs, children, false);
/** Create an SVG element. */
export const s = (tag, attrs, ...children) => apply(document.createElementNS(SVG_NS, tag), attrs, children, true);

export const clear = (node) => { node.replaceChildren(); return node; };

/** A modal dialog with a title, body and footer buttons. Returns { dialog, body, foot, open, close }. */
export function makeDialog(title, { wide = false } = {}) {
  const body = h('div', { class: 'dlg-body' });
  const foot = h('div', { class: 'dlg-foot' });
  const dialog = h('dialog', { 'aria-label': title },
    h('div', { class: 'dlg-head' }, h('h2', { text: title }),
      h('button', { class: 'del', 'aria-label': 'Close', onClick: () => dialog.close(), text: '×' })),
    body, foot);
  if (wide) dialog.style.width = 'min(760px, calc(100vw - 32px))';
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  return { dialog, body, foot, open: () => { if (!dialog.open) dialog.showModal(); }, close: () => dialog.close() };
}

/**
 * Menu bar. `menus` = [{ label, items: [{ label, tag, disabled, current, onSelect } | { heading } | 'sep'] }].
 * Items may also be a function returning the list, evaluated each time the menu opens.
 */
export function buildMenus(container, menus) {
  const closeAll = () => container.querySelectorAll('.menu-list').forEach((l) => {
    l.hidden = true; l.previousElementSibling.setAttribute('aria-expanded', 'false');
  });
  for (const m of menus) {
    const list = h('div', { class: 'menu-list', role: 'menu', hidden: true });
    const btn = h('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', text: m.label,
      onClick: (e) => {
        e.stopPropagation();
        const wasOpen = !list.hidden;
        closeAll();
        if (wasOpen) return;
        clear(list);
        const items = typeof m.items === 'function' ? m.items() : m.items;
        for (const it of items) {
          if (it === 'sep') { list.append(h('div', { class: 'menu-sep' })); continue; }
          if (it.heading) { list.append(h('div', { class: 'menu-heading', text: it.heading })); continue; }
          list.append(h('button', { class: 'menu-item', type: 'button', role: 'menuitem', disabled: !!it.disabled,
            'aria-current': it.current ? 'true' : null,
            onClick: () => { closeAll(); it.onSelect && it.onSelect(); } },
            h('span', { text: it.label }), it.tag ? h('span', { class: 'tag', text: it.tag }) : null));
        }
        list.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      } });
    container.append(h('div', { class: 'menu' }, btn, list));
  }
  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}

/** Copy text; falls back to selecting it in the given textarea. */
export async function copyText(text, textarea) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    if (textarea) { textarea.focus(); textarea.select(); }
    return false;
  }
}

/** Offer a text file for download (works on the hosted site; some embedded viewers block it). */
export function downloadText(filename, text, type = 'text/plain') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch { /* the export dialog still shows the text to copy */ }
}
