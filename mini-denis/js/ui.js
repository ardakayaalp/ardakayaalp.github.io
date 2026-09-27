/* Small UI toolkit for Mini DENIS (Win98-style widgets, dialogs, files). */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const icon = (name, alt = '') => el('img', { src: `img/lucide/${name}.svg`, alt, width: 14, height: 14 });

export function button(label, opts = {}) {
  const b = el('button', { type: 'button', class: opts.class, title: opts.title, 'data-tip': opts.tip, disabled: opts.disabled },
    opts.icon ? icon(opts.icon) : null, label || null);
  if (opts.onclick) b.addEventListener('click', opts.onclick);
  return b;
}

/** Number field: {value, min, max, step, decimals, width, tip, onchange}. `.num` reads the value. */
export function num(opts = {}) {
  const input = el('input', {
    type: 'number', step: opts.step ?? 'any', min: opts.min, max: opts.max, 'data-tip': opts.tip,
    style: opts.width ? { width: opts.width + 'px' } : undefined, disabled: opts.disabled, readonly: opts.readonly,
  });
  const dec = opts.decimals;
  const clamp = (v) => {
    if (!Number.isFinite(v)) v = opts.value ?? 0;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    return v;
  };
  const show = (v) => { input.value = dec !== undefined ? (+v).toFixed(dec) : String(v); };
  Object.defineProperty(input, 'num', {
    get: () => clamp(parseFloat(input.value)),
    set: (v) => show(clamp(+v)),
  });
  input.num = opts.value ?? 0;
  input.addEventListener('change', () => { input.num = input.num; opts.onchange && opts.onchange(input.num); });
  if (opts.oninput) input.addEventListener('input', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) opts.oninput(v); });
  return input;
}

export function check(label, opts = {}) {
  const box = el('input', { type: 'checkbox', checked: !!opts.checked, disabled: opts.disabled });
  if (opts.onchange) box.addEventListener('change', () => opts.onchange(box.checked));
  const wrap = el('label', { class: 'check', 'data-tip': opts.tip }, box, label ?? '');
  wrap.box = box;
  return wrap;
}

export function select(options, opts = {}) {
  const s = el('select', { 'data-tip': opts.tip, disabled: opts.disabled, style: opts.width ? { width: opts.width + 'px' } : undefined },
    ...options.map((o) => (typeof o === 'string' ? el('option', { value: o, text: o }) : el('option', { value: o.value, text: o.label }))));
  if (opts.value !== undefined) s.value = opts.value;
  if (opts.onchange) s.addEventListener('change', () => opts.onchange(s.value));
  return s;
}

export function group(title, ...children) {
  return el('fieldset', { class: 'group' }, el('legend', {}, title), ...children);
}

export const row = (...children) => el('div', { class: 'row' }, ...children);
export const lbl = (text, width) => el('label', { class: 'lbl', style: width ? { width: width + 'px' } : undefined }, text);

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.now = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}

/* ── Status bar ───────────────────────────────────────────────────── */
let statusTimer = null;
export function status(msg, sticky = false) {
  const s = document.getElementById('status-msg');
  if (!s) return;
  s.textContent = msg;
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => { s.textContent = 'Ready'; }, 6000);
}

/* ── Dialogs ──────────────────────────────────────────────────────── */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], width, icon: ic, onopen }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      if (prev && prev.focus) prev.focus();
      resolve(value);
    };
    const btns = buttons.map((b) => {
      const btn = button(b.label, { class: b.primary ? 'primary' : undefined });
      btn.addEventListener('click', () => {
        if (b.validate && b.validate() === false) return;
        close(typeof b.value === 'function' ? b.value() : b.value);
      });
      return btn;
    });
    const box = el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { width: width + 'px' } : undefined },
      el('div', { class: 'dlg-title' }, ic ? el('img', { src: ic, width: 16, height: 16, alt: '' }) : null, title,
        el('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: () => close(null) }, icon('x'))),
      el('div', { class: 'dlg-body' }, body),
      btns.length ? el('div', { class: 'dlg-buttons' }, ...btns) : null);
    const back = el('div', { class: 'dlg-backdrop' }, box);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const primary = buttons.findIndex((b) => b.primary);
        if (primary >= 0) { e.preventDefault(); btns[primary].click(); }
      }
      if (e.key === 'Tab') {                                  // keep focus inside the dialog
        const f = [...box.querySelectorAll('button, input, select, textarea, a[href]')].filter((x) => !x.disabled && x.offsetParent);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    const first = box.querySelector('.dlg-body input, .dlg-body select, .dlg-body textarea') || btns.find((b, i) => buttons[i].primary) || btns[0];
    if (first) first.focus();
    if (onopen) onopen(box, close);
  });
}

export function message(title, text, kind = 'info') {
  const body = el('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', maxWidth: '560px' } },
    el('div', { style: { fontSize: '26px', lineHeight: '1' }, text: kind === 'error' ? '⛔' : kind === 'warning' ? '⚠' : 'ℹ' }),
    el('div', { style: { whiteSpace: 'pre-wrap' } }, text));
  return dialog({ title, body });
}

export function confirm(title, text, yes = 'OK', no = 'Cancel') {
  return dialog({ title, body: el('div', { style: { whiteSpace: 'pre-wrap', maxWidth: '520px' } }, text),
    buttons: [{ label: yes, value: true, primary: true }, { label: no, value: false }] });
}

/* ── Tooltips (the desktop's buttermilk boxes) ─────────────────────── */
let tipEl = null;
let tipTimer = null;
const noHover = window.matchMedia('(hover: none)');
document.addEventListener('mouseover', (e) => {
  if (noHover.matches) return;                           // touch screens: taps would leave tips behind
  const t = e.target.closest && e.target.closest('[data-tip]');
  clearTimeout(tipTimer);
  if (tipEl) { tipEl.remove(); tipEl = null; }
  if (!t || !t.dataset.tip) return;
  tipTimer = setTimeout(() => {
    tipEl = el('div', { class: 'tooltip', text: t.dataset.tip });
    document.body.append(tipEl);
    const r = t.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    tipEl.style.left = Math.max(4, Math.min(innerWidth - w - 4, r.left)) + 'px';
    tipEl.style.top = (r.bottom + 6 + tipEl.offsetHeight > innerHeight ? r.top - tipEl.offsetHeight - 6 : r.bottom + 6) + 'px';
  }, 550);
});
document.addEventListener('mousedown', () => { clearTimeout(tipTimer); if (tipEl) { tipEl.remove(); tipEl = null; } });

/* ── Phone layout: one part of a pane at a time ───────────────────── */
export const isNarrow = () => window.matchMedia('(max-width: 900px)').matches;

/** View switcher for narrow screens. parts = [[key, label, element]]; hidden on wide screens by CSS. */
export function mobileNav(root, parts, initial) {
  root.classList.add('mroot');
  const btns = parts.map(([key, label, part]) => {
    part.dataset.mpart = key;
    const b = button(label, { onclick: () => nav.show(key) });
    b.dataset.key = key;
    return b;
  });
  const nav = el('div', { class: 'mnav', role: 'toolbar', 'aria-label': 'View' }, ...btns);
  nav.show = (key) => {
    for (const [k, , part] of parts) part.classList.toggle('mhide', k !== key);
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === key)));
    nav.current = key;
    if (isNarrow()) window.scrollTo({ top: 0 });
    window.dispatchEvent(new Event('resize'));
  };
  root.prepend(nav);
  nav.show(initial || parts[0][0]);
  return nav;
}

/* ── Files ─────────────────────────────────────────────────────────── */
export function pickFiles({ accept = '', multiple = false, directory = false } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    if (directory) input.webkitdirectory = true;
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

/** Save bytes/text. With `handle` (File System Access API) writes in place; otherwise downloads. */
export async function saveFile(data, name, { type = 'application/octet-stream', handle = null, pick = false, description, extensions } = {}) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (handle) {
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return handle;
  }
  if (pick && window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name,
        types: extensions ? [{ description: description || name, accept: { [type]: extensions } }] : undefined });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return h;
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  return 'download';
}

export function makeSplitter(splitter, target, { min = 180, max = 900, side = 'left' } = {}) {
  splitter.addEventListener('pointerdown', (e) => {
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('drag');
    const start = e.clientX;
    const w0 = target.getBoundingClientRect().width;
    const move = (ev) => {
      const d = side === 'left' ? ev.clientX - start : start - ev.clientX;
      target.style.width = Math.max(min, Math.min(max, w0 + d)) + 'px';
      window.dispatchEvent(new Event('resize'));
    };
    const up = () => {
      splitter.classList.remove('drag');
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });
}

export const fmt = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? 'N/A' : (+v).toFixed(d));
export const signed = (v, d = 3) => (v === null || v === undefined ? 'N/A' : (v >= 0 ? '+' : '') + (+v).toFixed(d));
