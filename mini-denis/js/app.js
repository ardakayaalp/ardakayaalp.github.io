/* Mini DENIS application shell: splash, menus, tabs, sessions, About. */
import { engine } from './engine.js';
import { el, icon, dialog, message, confirm, status, pickFiles, saveFile } from './ui.js';
import { EstimateTab } from './estimate.js';
import { PreAnalysisTab } from './preanalysis.js';

const VERSION = '1.1.0';
const GITHUB = 'https://github.com/ardakayaalp/DENIS';
const ZENODO = 'https://doi.org/10.5281/zenodo.22081266';

const app = {
  sessionName: null,          // file name shown in the title
  sessionHandle: null,        // File System Access handle for Save (when supported)
  savedHash: null,
  touched: false,             // has the user edited anything since the last save/open?
};

/* ── Splash / engine boot ─────────────────────────────────────────── */
const splash = document.getElementById('splash');
const splashBar = document.getElementById('splash-bar');
const splashMsg = document.getElementById('splash-msg');
const engineStatus = document.getElementById('engine-status');

engine.on('progress', (d) => {
  if (d.stage === 'core') {
    splashBar.style.width = Math.round(Math.min(1, d.fraction / 0.85) * 100) + '%';
    splashMsg.textContent = d.message;
  } else {
    engineStatus.textContent = `Loading hyperfine engine ${Math.round(Math.max(0, (d.fraction - 0.85) / 0.15) * 100)}%`;
    engineStatus.dataset.tip = d.message;
  }
});
engine.on('fatal', (d) => {
  splash.hidden = false;
  splash.classList.add('is-error');
  splashMsg.textContent = 'Mini DENIS could not start:\n' + d.error +
    '\n\nIt needs a recent Chrome, Edge, Firefox or Safari and an internet connection for the first start.';
  engineStatus.textContent = 'Engine failed';
});
engine.on('ready', (d) => {
  if (d.stage === 'core') {
    splashBar.style.width = '100%';
    setTimeout(start, 150);
    engineStatus.textContent = 'Loading hyperfine engine 0%';
  } else {
    engineStatus.textContent = 'Engine ready';
    engineStatus.dataset.tip = `Python engine ready (${d.seconds.toFixed(0)} s)`;
    document.dispatchEvent(new CustomEvent('engine-full'));
  }
});
document.querySelectorAll('[data-version]').forEach((n) => { n.textContent = 'v' + VERSION; });

/* ── Tabs ─────────────────────────────────────────────────────────── */
const estimate = new EstimateTab(document.getElementById('pane-estimate'), { engine });
const preanalysis = new PreAnalysisTab(document.getElementById('pane-preanalysis'), { engine });

function showTab(name) {
  document.querySelectorAll('.main-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('.tab-pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  window.dispatchEvent(new Event('resize'));
  try { localStorage.setItem('mini-denis-tab', name); } catch { /* private mode */ }
}
document.querySelectorAll('.main-tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

/* ── Sessions (same YAML as desktop DENIS) ─────────────────────────── */
// The sections the browser edits. The others (analysis, ui_layout, nist_asd, ...) stay in the
// engine exactly as read (denis_web/session.py) and are merged back, in desktop order, on save.
function buildSession() {
  const pa = preanalysis.toDict();
  const s = { estimate: estimate.toDict(), preanalysis: pa.preanalysis };
  if (pa.scan_filters && Object.keys(pa.scan_filters).length) s.scan_filters = pa.scan_filters;
  if (pa.calibrations && Object.keys(pa.calibrations).length) s.calibrations = pa.calibrations;
  if (pa.calibration_acks && pa.calibration_acks.length) s.calibration_acks = pa.calibration_acks;
  return s;
}
const hash = (obj) => JSON.stringify(obj);
// Unsaved-changes tracking. Some values fill in by themselves shortly after a reset or an open
// (masses, element table), so the saved state follows the session until the user edits something.
function markSaved() { app.savedHash = hash(buildSession()); app.touched = false; updateTitle(); }
function isDirty() {
  if (app.savedHash === null) return false;
  if (!app.touched) { app.savedHash = hash(buildSession()); return false; }
  return hash(buildSession()) !== app.savedHash;
}
const touch = () => { app.touched = true; };
for (const pane of document.querySelectorAll('.tab-pane')) {
  for (const type of ['input', 'change', 'drop']) pane.addEventListener(type, touch, true);
  pane.addEventListener('click', (e) => { if (e.target.closest('button')) touch(); }, true);
  pane.addEventListener('pointerup', (e) => { if (e.target.closest('.plot')) touch(); }, true);   // gate drags
}

function updateTitle() {
  document.title = (app.sessionName ? app.sessionName + ' - ' : '') + 'Mini DENIS v' + VERSION;
}

async function newSession(ask = true) {
  if (ask && isDirty() && !(await confirm('New session', 'Discard the unsaved changes of this session?', 'Discard', 'Cancel'))) return;
  estimate.reset();
  preanalysis.reset();
  engine.call('session', 'clear');
  app.sessionName = null;
  app.sessionHandle = null;
  markSaved();
  status('New session');
}

async function openSession() {
  if (isDirty() && !(await confirm('Open session', 'Discard the unsaved changes of this session?', 'Discard', 'Cancel'))) return;
  let file, handle = null;
  if (window.showOpenFilePicker) {
    try {
      [handle] = await window.showOpenFilePicker({ types: [{ description: 'DENIS session', accept: { 'text/yaml': ['.yaml', '.yml'] } }] });
      file = await handle.getFile();
    } catch (err) { if (err.name === 'AbortError') return; }
  }
  if (!file) [file] = await pickFiles({ accept: '.yaml,.yml' });
  if (!file) return;
  const res = await engine.call('session', 'load', { text: await file.text() });
  if (res.error) { await message('Open session', res.error, 'error'); return; }
  const s = res.session;
  estimate.reset();
  preanalysis.reset();
  if (s.estimate) estimate.fromDict(s.estimate);
  app.sessionName = file.name;
  app.sessionHandle = handle;
  markSaved();                                   // before data files are re-attached
  if (s.preanalysis) await preanalysis.fromDict(s.preanalysis, s);
  showTab(s.preanalysis && (s.preanalysis.projects || []).some((p) => (p.files || []).length) && !s.estimate ? 'preanalysis' : currentTab());
  markSaved();
  status(`Opened ${file.name}`);
}

/** Browsers never see where a file lives; ask once so desktop DENIS can open the runs directly. */
async function placeDataFiles() {
  const loose = preanalysis.unplacedFiles();
  if (!loose.length) return true;
  let last = '';
  try { last = localStorage.getItem('mini-denis-data-folder') || ''; } catch { /* ignore */ }
  const roots = [...new Set(loose.map((f) => f.relRoot).filter(Boolean))];
  const input = el('input', { type: 'text', value: last, placeholder: 'C:/Users/me/Data/Offline Data', style: { width: '100%' } });
  const choice = await dialog({ title: 'Data file locations', width: 560, body: el('div', {},
    el('p', {}, `${loose.length} data file${loose.length > 1 ? 's were' : ' was'} opened in the browser, which cannot see where files are stored. ` +
      'To let desktop DENIS open them straight away, enter the folder they are in' +
      (roots.length ? ` (the "${roots.join('", "')}" folder you selected):` : ':')),
    input,
    el('p', { class: 'muted small' }, 'Without it the session still opens in desktop DENIS, which then asks you to locate the files.')),
  buttons: [{ label: 'Save with folder', value: 'place', primary: true }, { label: 'Save without', value: 'skip' }, { label: 'Cancel', value: null }] });
  if (!choice) return false;
  if (choice === 'place' && input.value.trim()) {
    preanalysis.placeFiles(input.value);
    try { localStorage.setItem('mini-denis-data-folder', input.value.trim()); } catch { /* ignore */ }
  }
  return true;
}

async function saveSession(saveAs = false) {
  if (!(await placeDataFiles())) return;
  const text = await engine.call('session', 'dump', { session: buildSession() });
  const name = app.sessionName || 'denis_session.yaml';
  const res = await saveFile(text, name, { type: 'text/yaml', handle: saveAs ? null : app.sessionHandle, pick: true,
    description: 'DENIS session', extensions: ['.yaml', '.yml'] });
  if (!res) return;
  if (res !== 'download') { app.sessionHandle = res; app.sessionName = res.name; } else { app.sessionName = name; }
  markSaved();
  status(`Saved ${app.sessionName}`);
}

const currentTab = () => document.querySelector('.main-tab[aria-selected="true"]').dataset.tab;

window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

/* ── Dialogs ──────────────────────────────────────────────────────── */
function about() {
  const body = el('div', { class: 'about' },
    el('img', { src: 'img/denis_512.png', alt: 'DENIS logo' }),
    el('div', {},
      el('h3', {}, `DENIS  v${VERSION}`, el('span', { class: 'muted', style: { fontWeight: 400 } }, '  (Mini DENIS)')),
      el('p', { html: '<b>D</b>oppler <b>E</b>stimation and <b>N</b>umerical <b>I</b>nference for <b>S</b>pectroscopy' }),
      el('p', {}, 'A comprehensive tool for Collinear Laser Spectroscopy: estimation, pre-analysis, fitting, and results.'),
      el('p', { class: 'warn' }, 'This is the mini version: the Estimate and Pre-Analysis tabs, running in your browser. ',
        'Your files are processed on your computer and are not uploaded anywhere.'),
      el('p', {}, 'The full desktop application (fitting, isotope shifts, results browser and more) is at ',
        el('a', { href: GITHUB, target: '_blank', rel: 'noopener' }, 'github.com/ardakayaalp/DENIS'), '.'),
      el('p', { html: 'Fitting &amp; spectrum estimation powered by <a href="https://iks-nm.github.io/satlas2/index.html" target="_blank" rel="noopener">satlas2</a>.<br>' +
        'IGISOL-style ASDF file reading via <a href="https://github.com/andry3vi/cls_tools" target="_blank" rel="noopener">cls_tools</a> (GPL-3.0).' }),
      el('p', { html: `Developer: <a href="https://ardakayaalp.com/" target="_blank" rel="noopener">Arda Kayaalp</a><br>Email: <a href="mailto:arda.kayaalp@kuleuven.be">arda.kayaalp@kuleuven.be</a>` }),
      el('p', { class: 'muted small', html: `Cite: <a href="${ZENODO}" target="_blank" rel="noopener">doi:10.5281/zenodo.22081266</a> &middot; MIT licence<br>` +
        'Runs on Pyodide (Python in WebAssembly) and Plotly.' })));
  return dialog({ title: 'About DENIS', body, width: 640, icon: 'img/lucide/atom.svg' });
}

async function startDialog() {
  const choice = await dialog({
    title: 'Mini DENIS', width: 560, icon: 'img/denis.ico',
    body: el('div', { class: 'start' },
      el('p', { style: { margin: '0 0 4px' } }, 'Welcome to Mini DENIS, the browser version of the Estimate and Pre-Analysis tabs.'),
      startButton('file-plus', 'New session', 'Start with empty tabs', 'new'),
      startButton('folder-open', 'Open session…', 'A DENIS session file (.yaml), from Mini DENIS or the desktop app', 'open'),
      startButton('eye', 'Open data files…', 'Go straight to Pre-Analysis with ASDF runs', 'data'),
      el('p', { class: 'muted small', style: { margin: '6px 0 0' } }, 'Everything runs on your computer; files are never uploaded.')),
    buttons: [],
    onopen: (box, close) => box.querySelectorAll('.start button').forEach((b) => b.addEventListener('click', () => close(b.dataset.choice))),
  });
  if (choice === 'open') await openSession();
  else if (choice === 'data') { showTab('preanalysis'); await preanalysis.openFiles(); markSaved(); }
}
function startButton(ic, label, desc, value) {
  return el('button', { type: 'button', 'data-choice': value }, icon(ic), el('span', {}, label, el('span', { class: 'desc' }, desc)));
}

/* ── Menus ────────────────────────────────────────────────────────── */
const MENUS = [
  { title: 'File', items: [
    { label: 'New Session', icon: 'file-plus', action: () => newSession() },
    { label: 'Open Session…', icon: 'folder-open', key: 'Ctrl+O', action: openSession },
    { label: 'Save Session', icon: 'save', key: 'Ctrl+S', action: () => saveSession(false) },
    { label: 'Save Session As…', icon: 'save', key: 'Ctrl+Shift+S', action: () => saveSession(true) },
    '-',
    { label: 'Open Data Files…', icon: 'file-up', action: () => { showTab('preanalysis'); preanalysis.openFiles(); } },
    { label: 'Load Estimation…', icon: 'file-up', action: () => { showTab('estimate'); estimate.loadEstimation(); } },
    { label: 'Download Estimation Results', icon: 'file-down', action: () => estimate.downloadResults(), enabled: () => estimate.hasRun() },
  ] },
  { title: 'View', items: [
    { label: 'Estimate', icon: 'sigma', action: () => showTab('estimate') },
    { label: 'Pre-Analysis', icon: 'eye', action: () => showTab('preanalysis') },
  ] },
  { title: 'Help', items: [
    { label: 'Documentation', icon: 'circle-help', action: () => window.open(GITHUB + '#readme', '_blank', 'noopener') },
    { label: 'Full Desktop DENIS on GitHub', icon: 'file-down', action: () => window.open(GITHUB, '_blank', 'noopener') },
    '-',
    { label: 'About', icon: 'atom', action: about },
  ] },
];

function buildMenus() {
  const bar = document.getElementById('menubar');
  let open = null;
  const closeAll = () => { if (open) { open.classList.remove('open'); open.querySelector('.menu-list').remove(); open = null; } };
  const openMenu = (menu, def) => {
    closeAll();
    const list = el('div', { class: 'menu-list', role: 'menu' });
    for (const it of def.items) {
      if (it === '-') { list.append(el('hr')); continue; }
      const enabled = it.enabled ? it.enabled() : true;
      const b = el('button', { type: 'button', role: 'menuitem', disabled: !enabled },
        it.checked ? el('span', { style: { width: '14px' } }, it.checked() ? '✓' : '') : icon(it.icon), it.label,
        it.key ? el('span', { class: 'kbd' }, it.key) : null);
      b.addEventListener('click', () => { closeAll(); it.action(); });
      list.append(b);
    }
    menu.append(list);
    menu.classList.add('open');
    open = menu;
    list.querySelector('button:not(:disabled)')?.focus();
  };
  for (const def of MENUS) {
    const btn = el('button', { type: 'button', 'aria-haspopup': 'true' }, def.title);
    const menu = el('div', { class: 'menu' }, btn);
    btn.addEventListener('click', (e) => { e.stopPropagation(); open === menu ? closeAll() : openMenu(menu, def); });
    btn.addEventListener('mouseenter', () => { if (open && open !== menu) openMenu(menu, def); });
    bar.append(menu);
  }
  document.addEventListener('click', (e) => { if (open && !open.contains(e.target)) closeAll(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveSession(e.shiftKey); }
    if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); openSession(); }
  });
}

/* ── Start ────────────────────────────────────────────────────────── */
async function start() {
  splash.hidden = true;
  document.getElementById('app').hidden = false;
  buildMenus();
  let tab = 'estimate';
  try { tab = localStorage.getItem('mini-denis-tab') || tab; } catch { /* ignore */ }
  showTab(tab);
  estimate.reset();
  preanalysis.reset();
  markSaved();
  updateTitle();
  await startDialog();
}

// For tests: expose the pieces (no effect on users).
window.miniDenis = { app, engine, estimate, preanalysis, buildSession, saveSession, openSession, newSession, showTab, isDirty };
