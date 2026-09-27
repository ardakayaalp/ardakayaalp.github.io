/* Pre-Analysis tab of Mini DENIS (mirrors DENIS gui/preanalysis_tab.py; the numbers come from the engine). */
import { el, icon, button, num, check, select, group, debounce, dialog, message, confirm, status, pickFiles, saveFile, makeSplitter, fmt, mobileNav } from './ui.js';
import { Plot } from './plots.js';

// preanalysis_tab.py: DEFAULT_COLORS (Win98 palette), NEON_COLORS, model colours
const DEFAULT_COLORS = ['#000080', '#800000', '#008000', '#800080', '#008080', '#FF0000', '#0000FF', '#808000', '#FF00FF', '#808080'];
const NEON_COLORS = ['#00E5FF', '#FF2D95', '#7CFF3F', '#FFE500', '#FF9A2E', '#22B0FF', '#00FFA3', '#C86BFF', '#FF5C5C', '#F0F0F0'];
const MODEL_COLORS = ['#000000', '#d62728', '#2ca02c', '#9467bd'];
const NEON_MODEL_COLORS = ['#FFE500', '#00E5FF', '#FF2D95', '#7CFF3F'];
const XAXES = ['Voltage', 'Calibrated voltage', 'Calibrated beam energy', 'Wavenumber', 'Frequency'];
// Scan-filter keys as desktop DENIS writes them: Windows paths go through os.path.normcase
const filterKey = (path) => (/^[A-Za-z]:[\\/]/.test(path) ? path.replace(/\//g, '\\').toLowerCase() : path);
const LINESTYLES = ['Solid', 'Dashed', 'Dotted', 'Dash-dot'];          // HFS models store these names
// Data files store matplotlib codes, like desktop DENIS (preanalysis_tab._LS_OPTIONS)
const FILE_LS = [{ label: 'Solid', value: '-' }, { label: 'Dashed', value: '--' }, { label: 'Dash-dot', value: '-.' }, { label: 'Dotted', value: ':' }];
const lsName = (code) => (FILE_LS.find((o) => o.value === code) || FILE_LS[0]).label;
const lsCode = (v) => (FILE_LS.find((o) => o.value === v || o.label === v) || FILE_LS[0]).value;
const TS_UNITS = { Seconds: 1, Minutes: 60, Hours: 3600, Days: 86400 };
// HFSModelPanel params_info: key, label, default, slider lo, slider hi
const PARAMS = [['Al', 'Al', 0, -500, 500], ['Au', 'Au', 0, -500, 500], ['Bl', 'Bl', 0, -500, 500], ['Bu', 'Bu', 0, -500, 500],
  ['centroid', 'Centroid', 0, -50000, 50000], ['scale', 'Scale', 100, 0, 10000], ['bkg', 'Bkg p0', 0, 0, 100],
  ['bkg_p1', 'Bkg p1', 0, -1, 1], ['bkg_p2', 'Bkg p2', 0, -1e-3, 1e-3], ['fwhm_g', 'FWHM_G', 50, 1, 500], ['fwhm_l', 'FWHM_L', 50, 1, 500]];
const PARAM_DEC = { bkg_p1: 6, bkg_p2: 9 };
const GATE_TOF = '#ff8c00';
const GATE_TS = '#29a8e0';

let runCounter = 0;
let projectCounter = 0;
const basename = (p) => String(p || '').split(/[\\/]/).pop();

function loadDark() { try { return localStorage.getItem('pa_dark_plots') !== '0'; } catch { return true; } }   // dark unless switched off
function saveDark(v) { try { localStorage.setItem('pa_dark_plots', v ? '1' : '0'); } catch { /* ignore */ } }

export class PreAnalysisTab {
  constructor(root, { engine }) {
    this.engine = engine;
    this.root = root;
    this.projects = [];
    this.active = null;
    this.dark = loadDark();
    this.passthrough = { analysis: null, calibrations: null, calibration_acks: null };
    this.tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Pre-Analysis projects' });
    this.addBtn = button('Create Pre-Analysis', { icon: 'plus', class: 'tool', onclick: () => this.addProject() });
    this.body = el('div', { class: 'col', style: { flex: 1, minHeight: 0 } });
    root.append(el('div', { class: 'col', style: { flex: 1, minWidth: 0 } }, this.tabs, this.body));
    root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); root.classList.add('dropzone'); } });
    root.addEventListener('dragleave', (e) => { if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('dropzone'); });
    root.addEventListener('drop', (e) => {
      e.preventDefault(); root.classList.remove('dropzone');
      const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.asdf$/i.test(f.name));
      if (files.length && this.active) this.active.loadFiles(files);
    });
  }

  reset() {
    for (const p of this.projects) p.destroy();
    this.projects = [];
    this.passthrough = { analysis: null, calibrations: null, calibration_acks: null };
    projectCounter = 0;
    this.addProject();
  }

  addProject(name, dict) {
    const p = new Project(this, name || `Pre-Analysis ${++projectCounter}`);
    this.projects.push(p);
    this.body.append(p.root);
    if (dict) p.fromDict(dict);
    this.activate(p);
    return p;
  }

  async closeProject(p) {
    if (p.files.length && !(await confirm('Close Pre-Analysis', `Close "${p.name}" and its ${p.files.length} file(s)?`, 'Close'))) return;
    p.destroy();
    this.projects = this.projects.filter((x) => x !== p);
    if (!this.projects.length) this.addProject();
    else this.activate(this.projects[Math.max(0, this.projects.length - 1)]);
  }

  activate(p) {
    this.active = p;
    for (const x of this.projects) x.root.hidden = x !== p;
    this.renderTabs();
    p.onShow();
  }

  renderTabs() {
    this.tabs.replaceChildren(...this.projects.map((p) => {
      const t = el('button', { role: 'tab', class: 'tab', 'aria-selected': String(p === this.active), title: 'Double-click to rename' },
        el('span', { class: 'dot', style: { background: `hsl(${[...p.name].reduce((a, c) => a + c.charCodeAt(0) * 31, 0) % 360},55%,55%)` } }), p.name);
      const x = el('button', { type: 'button', class: 'close', 'aria-label': 'Close ' + p.name }, icon('x'));
      x.addEventListener('click', (e) => { e.stopPropagation(); this.closeProject(p); });
      t.append(x);
      t.addEventListener('click', () => this.activate(p));
      t.addEventListener('dblclick', async () => {
        const input = el('input', { type: 'text', value: p.name, style: { width: '260px' } });
        const ok = await dialog({ title: 'Rename Pre-Analysis', body: input, buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }] });
        if (ok && input.value.trim()) { p.name = input.value.trim(); this.renderTabs(); }
      });
      return t;
    }), el('div', { class: 'tabs-tools' }, this.addBtn));
  }

  openFiles() { return this.active.openFiles(); }
  isDark() { return this.dark; }
  toggleDark() { this.setDark(!this.dark); }
  setDark(v) { this.dark = !!v; saveDark(this.dark); for (const p of this.projects) p.applyDark(); }

  toDict() {
    const scan_filters = {};
    for (const p of this.projects) {
      for (const f of p.files) if (f.excluded.size) scan_filters[filterKey(f.path)] = { excluded: [...f.excluded].sort((a, b) => a - b) };
    }
    return {
      preanalysis: { projects: this.projects.map((p) => p.toDict()) },
      scan_filters,
      calibrations: this.passthrough.calibrations,
      calibration_acks: this.passthrough.calibration_acks,
    };
  }

  /** Files whose saved path has no folder (opened in the browser, which never sees where files live). */
  unplacedFiles() {
    return this.projects.flatMap((p) => p.files).filter((f) => !/[\\/]/.test(f.path));
  }

  /** Give those files a full path for desktop DENIS: base folder + their place inside a picked folder. */
  placeFiles(base) {
    const b = base.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    for (const f of this.unplacedFiles()) f.path = `${b}/${f.rel || f.name}`;
  }

  /** Restore from a session; asks the user to pick the data files again (browsers cannot open paths). */
  async fromDict(pa, session = {}) {
    for (const p of this.projects) p.destroy();
    this.projects = [];
    projectCounter = 0;
    this.passthrough.calibrations = session.calibrations ?? null;
    this.passthrough.calibration_acks = session.calibration_acks ?? null;
    const scanFilters = session.scan_filters || {};
    const projects = (pa.projects && pa.projects.length) ? pa.projects : [pa];
    for (const d of projects) this.addProject(d.name || undefined, d);
    for (const p of this.projects) {
      for (const f of p.files) {
        const sf = scanFilters[f.path] || Object.entries(scanFilters).find(([k]) => basename(k) === f.name)?.[1];
        if (sf && sf.excluded) f.excluded = new Set(sf.excluded.map(Number));
      }
    }
    if (Object.keys(this.passthrough.calibrations || {}).length) {
      status('Note: calibration overrides from the desktop are kept in the session but not applied in Mini DENIS', true);
    }
    this.activate(this.projects[0]);
    const wanted = this.projects.flatMap((p) => p.files.filter((f) => f.status === 'missing'));
    if (wanted.length) await this.attachFiles(wanted);
  }

  async attachFiles(wanted) {
    const missing = () => [...new Set(this.projects.flatMap((p) => p.files.filter((f) => f.status === 'missing')).map((f) => f.name))];
    let first = true;
    for (;;) {
      const names = missing();
      if (!names.length) return;
      const list = el('ul', { style: { maxHeight: '220px', overflow: 'auto', margin: '6px 0', paddingLeft: '18px' } }, ...names.map((n) => el('li', {}, n)));
      const intro = first
        ? `This session uses ${names.length} data file${names.length > 1 ? 's' : ''}. A browser cannot open files by their path, so please select them (you can select all at once), or select a folder that contains them (subfolders are searched too):`
        : `${names.length} data file${names.length > 1 ? 's were' : ' was'} not found among the selected files:`;
      const choice = await dialog({ title: 'Data files', width: 540, body: el('div', {},
        el('p', {}, intro), list,
        el('p', { class: 'muted small' }, 'Files are matched by name and stay on your computer. The session settings are loaded either way; skipped files can be attached later with a right-click.')),
      buttons: [{ label: first ? 'Select files…' : 'Select more files…', value: 'files', primary: true },
        { label: 'Select folder…', value: 'folder' }, { label: 'Skip', value: null }] });
      first = false;
      if (!choice) { status(`${names.length} data file${names.length > 1 ? 's' : ''} skipped; right-click a file to attach it later`, true); return; }
      const picked = await pickFiles(choice === 'folder' ? { directory: true } : { accept: '.asdf', multiple: true });
      if (!picked.length) continue;
      const byName = new Map();
      for (const f of picked) if (!byName.has(f.name)) byName.set(f.name, f);   // first match wins
      const jobs = [];
      for (const p of this.projects) {
        for (const f of p.files) if (f.status === 'missing' && byName.has(f.name)) jobs.push(p.attach(f, byName.get(f.name)));
      }
      status(`Loading ${jobs.length} data file${jobs.length !== 1 ? 's' : ''}…`, true);
      await Promise.all(jobs);
      status(`Attached ${jobs.length} data file${jobs.length !== 1 ? 's' : ''}`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════════ */

class Project {
  constructor(tab, name) {
    this.tab = tab;
    this.engine = tab.engine;
    this.name = name;
    this.files = [];
    this.models = [];
    this.selected = null;
    this.mergedPassthrough = [];
    this.o = {
      x_axis: 'Frequency', plot_layout: 'stacked', grid_x: false, grid_y: false, e_lower: 0, e_upper: 0, harmonic: 2,
      normalize: false, Z: 1, A: 1, mass_override: false, mass_amu: 1, channels: [3, 4],
      tof: { enabled: false, lo: 35, hi: 61, binsize: 0.1 },
      ts: { unit: 'Seconds', binsize: 1, gate_enabled: false, lo: 0, hi: 0, show_scans: false },
      cooler_voltage: 29977, laser_setpoint: 10920, cooler_override: false, laser_override: false,
      binning: { bin_mode: 'Raw Voltage', x_column: 'bins_center', yerr_mode: 'None', xerr_mode: 'None', bin_definition: 'Per scan step', bin_count: 100, bin_width_mhz: 10.0 },
      step_multiple: 1, cooler_bins: 100, clip_y: true, subtab: 'Spectrum',
    };
    this.seq = 0;
    this.scanCache = new Map();
    this.root = el('div', { class: 'col', style: { flex: 1, minHeight: 0, flexDirection: 'row', display: 'flex' } });
    this.buildSidebar();
    this.buildPlots();
    this.replot = debounce(() => this.doReplot('full'), 60);
    this.replotSpectrum = debounce(() => this.doReplot('spectrum'), 25);
    this.replotModels = debounce(() => this.doModels(), 30);
    this.refreshMass();
    this.renderFiles();
    this.syncControls();
    this.onFull = () => { this.refreshMass(); this.doModels(); this.models.forEach((m) => m.peaksPending && m.rebuildPeaks()); };
    document.addEventListener('engine-full', this.onFull);
  }

  destroy() {
    document.removeEventListener('engine-full', this.onFull);
    for (const f of this.files) if (f.status === 'ok') this.engine.call('preanalysis', 'remove', { run_id: f.id });
    this.root.remove();
  }

  onShow() { window.dispatchEvent(new Event('resize')); }
  get dark() { return this.tab.dark; }

  /* ── Sidebar ─────────────────────────────────────────────────────── */
  buildSidebar() {
    const o = this.o;
    this.fileList = el('div', { class: 'files' });
    this.checkAll = check('Check all', { onchange: (v) => { this.files.forEach((f) => { f.checked = v; }); this.renderFiles(); this.replot(); } });
    const filesGroup = group('Data Files',
      el('div', { class: 'row wrap' },
        button('Open…', { icon: 'folder-open', tip: 'Open ASDF run files (or drop them anywhere on this tab)', onclick: () => this.openFiles() }),
        button('Remove checked', { icon: 'trash-2', onclick: () => this.removeChecked() })),
      this.checkAll, this.fileList);

    // Plot options (grid of label + control)
    this.w = {};
    const w = this.w;
    const change = (fn) => () => { fn(); this.replot(); };
    w.xaxis = select(XAXES, { value: o.x_axis, onchange: (v) => { o.x_axis = v; this.spec.resetZoom(); this.replot(); this.replotModels(); } });
    w.elower = num({ value: o.e_lower, decimals: 4, step: 0.001, width: 120, onchange: (v) => { o.e_lower = v; this.updateTransition(); this.replot(); this.replotModels(); } });
    w.eupper = num({ value: o.e_upper, decimals: 4, step: 0.001, width: 120, onchange: (v) => { o.e_upper = v; this.updateTransition(); this.replot(); this.replotModels(); } });
    w.transition = el('span', { class: 'muted' });
    w.fundamental = el('span', { class: 'muted' });
    w.harmonic = num({ value: o.harmonic, min: 1, max: 10, step: 1, width: 60, decimals: 0, onchange: (v) => { o.harmonic = v; this.updateTransition(); this.replot(); this.replotModels(); } });
    w.Z = num({ value: o.Z, min: 1, max: 118, step: 1, width: 56, decimals: 0, onchange: (v) => { o.Z = v; this.refreshMass(); this.replot(); this.replotModels(); } });
    w.A = num({ value: o.A, min: 1, max: 300, step: 1, width: 56, decimals: 0, onchange: (v) => { o.A = v; this.refreshMass(); this.replot(); this.replotModels(); } });
    w.isoLabel = el('span', { class: 'muted' });
    w.mass = num({ value: o.mass_amu, decimals: 6, step: 0.000001, width: 110, readonly: true, onchange: (v) => { o.mass_amu = v; this.replot(); this.replotModels(); } });
    w.massOv = check('Override', { onchange: (v) => { o.mass_override = v; w.mass.readOnly = !v; if (!v) this.refreshMass(); this.replot(); this.replotModels(); } });
    w.channels = [1, 2, 3, 4, 5].map((c) => check(c === 5 ? 'DC' : String(c), { checked: o.channels.includes(c), onchange: () => {
      o.channels = w.channels.map((cb, i) => (cb.box.checked ? i + 1 : 0)).filter(Boolean); this.replot(); } }));
    w.normalize = check('Normalize', { onchange: (v) => { o.normalize = v; this.replot(); } });
    w.coolOv = el('input', { type: 'checkbox', 'data-tip': 'Use this cooler voltage for every file (otherwise each file’s own)' });
    w.coolOv.addEventListener('change', () => { o.cooler_override = w.coolOv.checked; w.cooler.disabled = !o.cooler_override; this.replot(); this.replotModels(); });
    w.cooler = num({ value: o.cooler_voltage, decimals: 2, step: 1, width: 100, disabled: true, onchange: (v) => { o.cooler_voltage = v; this.replot(); this.replotModels(); } });
    w.laserOv = el('input', { type: 'checkbox', 'data-tip': 'Use this laser setpoint for every file (otherwise each file’s own)' });
    w.laserOv.addEventListener('change', () => { o.laser_override = w.laserOv.checked; w.laser.disabled = !o.laser_override; this.replot(); this.replotModels(); });
    w.laser = num({ value: o.laser_setpoint, decimals: 6, step: 0.1, width: 120, disabled: true, onchange: (v) => { o.laser_setpoint = v; this.replot(); this.replotModels(); } });
    const fill = (key) => button('', { icon: 'chevron-down', class: 'tool', tip: 'Copy the value from the selected file', onclick: () => this.fillFromSelected(key) });

    const optsGroup = group('Plot Options', el('div', { class: 'grid2' },
      el('label', {}, 'X-axis'), w.xaxis,
      el('label', {}, 'E lower (cm⁻¹)'), w.elower,
      el('label', {}, 'E upper (cm⁻¹)'), w.eupper,
      el('label', {}, 'Transition'), w.transition,
      el('label', {}, 'Harmonic'), w.harmonic,
      el('label', {}, 'Fundamental'), w.fundamental,
      el('label', {}, 'Z'), el('div', { class: 'row', style: { margin: 0 } }, w.Z, el('label', {}, 'A'), w.A, w.isoLabel),
      el('label', {}, 'Mass [amu]'), el('div', { class: 'row', style: { margin: 0 } }, w.mass, w.massOv),
      el('label', {}, 'Channels'), el('div', { class: 'row wrap', style: { margin: 0 } }, ...w.channels),
      el('span'), w.normalize,
      el('label', {}, 'Cooler (V)'), el('div', { class: 'row', style: { margin: 0 } }, w.coolOv, w.cooler, fill('cooler')),
      el('label', {}, 'Laser (cm⁻¹)'), el('div', { class: 'row', style: { margin: 0 } }, w.laserOv, w.laser, fill('laser'))),
    el('div', { class: 'row', style: { marginTop: '6px' } }, button('Save Plot…', { icon: 'save', onclick: () => this.savePlot() })));

    this.modelList = el('div');
    const modelsGroup = group('HFS Models',
      el('div', { class: 'row wrap' },
        button('Add Model', { icon: 'plus', onclick: () => this.addModel() }),
        button('Duplicate checked', { icon: 'copy', onclick: () => this.duplicateModels() }),
        button('Remove checked', { icon: 'trash-2', onclick: () => this.removeModels() })),
      this.modelList);

    this.sidebar = el('div', { class: 'col scroll', style: { width: '330px', padding: '0 6px 8px 4px' } }, filesGroup, optsGroup, modelsGroup);
    this.splitter = el('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'vertical' });
    makeSplitter(this.splitter, this.sidebar, { min: 260, max: 620 });
    this.root.append(this.sidebar, this.splitter);
    this.updateTransition();
  }

  updateTransition() {
    const o = this.o;
    const t = o.e_upper - o.e_lower;
    this.w.transition.textContent = `${t.toFixed(4)} cm⁻¹`;
    this.w.fundamental.textContent = `${(o.harmonic > 0 ? t / o.harmonic : 0).toFixed(4)} cm⁻¹`;
  }

  async refreshMass() {
    const o = this.o;
    try {
      const [label, mass] = await Promise.all([
        this.engine.call('preanalysis', 'isotope_label', { Z: o.Z, A: o.A }),
        this.engine.call('preanalysis', 'lookup_mass', { Z: o.Z, A: o.A })]);
      this.w.isoLabel.textContent = label;
      if (!o.mass_override && mass != null) { o.mass_amu = Math.round(mass * 1e6) / 1e6; this.w.mass.num = o.mass_amu; }   // 6 dp, as the desktop spin box
    } catch { /* engine still starting */ }
  }

  fillFromSelected(key) {
    const f = this.files.find((x) => x.id === this.selected && x.card) || this.files.find((x) => x.checked && x.card);
    if (!f) { status('Select a loaded file first'); return; }
    if (key === 'cooler') { this.o.cooler_voltage = f.card.cooler_v; this.w.cooler.num = f.card.cooler_v; }
    else { this.o.laser_setpoint = f.card.laser_sp; this.w.laser.num = f.card.laser_sp; }
    this.replot();
    this.replotModels();
  }

  /* ── Files ───────────────────────────────────────────────────────── */
  async openFiles() {
    const files = await pickFiles({ accept: '.asdf', multiple: true });
    if (files.length) await this.loadFiles(files);
  }

  newFileItem(name, path) {
    const idx = this.files.length % DEFAULT_COLORS.length;
    return { id: `r${++runCounter}`, name, path: path || name, color: DEFAULT_COLORS[idx], dark_color: NEON_COLORS[idx],
      alpha: 1, linestyle: '-', checked: true, centroid_offset_mhz: 0, card: null, status: 'missing', error: null, excluded: new Set() };
  }

  async loadFiles(fileObjs) {
    const jobs = [];
    for (const fo of fileObjs) {
      if (this.files.some((f) => f.name === fo.name && f.status !== 'missing')) { status(`${fo.name} is already open`); continue; }
      const item = this.newFileItem(fo.name);
      this.files.push(item);
      jobs.push(this.attach(item, fo));
    }
    this.renderFiles();
    await Promise.all(jobs);
  }

  async attach(item, fileObj) {
    item.status = 'loading';
    item.error = null;
    this.renderFiles();
    // Inside a picked folder the browser gives "Folder/sub/run.asdf": keep "sub/run.asdf" for saving paths
    const rel = (fileObj.webkitRelativePath || '').split('/');
    item.rel = rel.length > 1 ? rel.slice(1).join('/') : fileObj.name;
    item.relRoot = rel.length > 1 ? rel[0] : null;
    try {
      const bytes = new Uint8Array(await fileObj.arrayBuffer());
      const src = `/home/pyodide/upload/${item.id}/${fileObj.name}`;
      await this.engine.write(src, bytes);
      const card = await this.engine.call('preanalysis', 'load', { run_id: item.id, filename: fileObj.name, src });
      if (card.error) throw new Error(card.error);
      item.card = card;
      item.status = 'ok';
      if (!this.selected) this.selected = item.id;
      status(`Loaded ${card.name} (${card.events.toLocaleString()} events)`);
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
      await message('Load Error', err.message, 'error');
    }
    this.renderFiles();
    this.replot();
    this.replotModels();
  }

  async removeChecked() {
    const gone = this.files.filter((f) => f.checked);
    if (!gone.length) return;
    for (const f of gone) if (f.status === 'ok') this.engine.call('preanalysis', 'remove', { run_id: f.id });
    this.files = this.files.filter((f) => !f.checked);
    if (!this.files.some((f) => f.id === this.selected)) this.selected = this.files[0]?.id ?? null;
    this.scanCache.clear();
    this.renderFiles();
    this.replot();
  }

  removeFile(f) {
    if (f.status === 'ok') this.engine.call('preanalysis', 'remove', { run_id: f.id });
    this.files = this.files.filter((x) => x !== f);
    if (this.selected === f.id) this.selected = this.files[0]?.id ?? null;
    this.scanCache.clear();
    this.renderFiles();
    this.replot();
  }

  renderFiles() {
    const all = this.files.length && this.files.every((f) => f.checked);
    const some = this.files.some((f) => f.checked);
    this.checkAll.box.checked = !!all;
    this.checkAll.box.indeterminate = some && !all;
    this.fileList.replaceChildren(...this.files.map((f) => this.fileCard(f)));
    if (!this.files.length) this.fileList.append(el('div', { class: 'muted small', style: { padding: '4px' } }, 'No files. Open ASDF runs or drop them here.'));
  }

  fileCard(f) {
    const cb = el('input', { type: 'checkbox', checked: f.checked, 'aria-label': 'Show ' + f.name });
    cb.addEventListener('change', () => { f.checked = cb.checked; this.renderFiles(); this.replot(); });
    const sw = el('button', { type: 'button', class: 'swatch', style: { background: this.dark ? f.dark_color : f.color, opacity: f.alpha }, 'data-tip': 'Colour, opacity and line style' });
    sw.addEventListener('click', (e) => { e.stopPropagation(); this.lineDialog(f); });
    const name = f.card ? f.card.name : f.name;
    let detail;
    if (f.status === 'loading') detail = el('span', { class: 'loading' }, 'Loading…');
    else if (f.status === 'error') detail = el('span', { class: 'error' }, 'Failed to load');
    else if (f.status === 'missing') detail = el('span', { class: 'warn' }, 'Not loaded: right-click to attach the file');
    else detail = f.card.detail + (f.excluded.size ? `  |  ${f.excluded.size} scan(s) excluded` : '');
    const card = el('div', { class: 'file-card' + (f.id === this.selected ? ' selected' : ''), 'data-tip': f.card ? `${f.name}\nEvents: ${f.card.events.toLocaleString()}\nDate: ${f.card.date ?? '?'}\nMassAMU in file: ${f.card.mass_amu ?? '(none)'}` : f.path },
      cb, sw, el('span', { class: 'name' }, name, f.excluded.size ? el('span', { class: 'badge', 'data-tip': 'Scans excluded' }, ' ✂') : null), el('span'),
      el('span', { class: 'detail' }, detail));
    card.addEventListener('click', (e) => { if (e.target === cb || e.target === sw) return; this.selected = f.id; this.renderFiles(); });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); this.fileMenu(f, e.clientX, e.clientY); });
    return card;
  }

  fileMenu(f, x, y) {
    document.querySelector('.ctx-menu')?.remove();
    const items = [
      ['Remove', 'trash-2', () => this.removeFile(f)],
      [f.checked ? 'Uncheck' : 'Check', 'check', () => { f.checked = !f.checked; this.renderFiles(); this.replot(); }],
      f.status !== 'ok' ? ['Attach file…', 'file-up', async () => { const [fo] = await pickFiles({ accept: '.asdf' }); if (fo) { if (f.status === 'ok') this.engine.call('preanalysis', 'remove', { run_id: f.id }); f.name = fo.name; await this.attach(f, fo); } }] : null,
      f.status === 'ok' ? ['File header…', 'search', () => this.headerDialog(f)] : null,
      f.excluded.size ? ['Clear scan filter', 'rotate-ccw', () => { f.excluded.clear(); this.renderFiles(); this.replot(); }] : null,
    ].filter(Boolean);
    const menu = el('div', { class: 'menu-list ctx-menu', style: { position: 'fixed', left: x + 'px', top: y + 'px' } },
      ...items.map(([label, ic, fn]) => { const b = el('button', { type: 'button' }, icon(ic), label); b.addEventListener('click', () => { menu.remove(); fn(); }); return b; }));
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    if (r.bottom > innerHeight) menu.style.top = Math.max(4, y - r.height) + 'px';
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }

  async headerDialog(f) {
    const h = await this.engine.call('preanalysis', 'header', { run_id: f.id });
    const rows = Object.entries(h).map(([k, v]) => el('tr', {}, el('td', { class: 'l' }, k), el('td', { class: 'l', style: { whiteSpace: 'normal' } }, Array.isArray(v) ? JSON.stringify(v) : String(v))));
    await dialog({ title: `${f.card.name} - ASDF header`, width: 640, body: el('div', { style: { maxHeight: '60vh', overflow: 'auto' } },
      el('table', { class: 'data' }, el('tbody', {}, ...rows))) });
  }

  async lineDialog(f) {
    const light = el('input', { type: 'color', value: f.color });
    const darkc = el('input', { type: 'color', value: f.dark_color });
    const alpha = el('input', { type: 'range', min: 0, max: 100, value: Math.round(f.alpha * 100) });
    const ls = select(FILE_LS, { value: lsCode(f.linestyle) });
    const ok = await dialog({ title: 'Line colours', width: 360, body: el('div', { class: 'grid2' },
      el('label', {}, 'Colour (light plots)'), light, el('label', {}, 'Colour (dark plots)'), darkc,
      el('label', {}, 'Opacity'), alpha, el('label', {}, 'Line style'), ls),
    buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    Object.assign(f, { color: light.value, dark_color: darkc.value, alpha: alpha.value / 100, linestyle: ls.value });
    this.renderFiles();
    this.redrawCached();
  }

  /* ── Plots ───────────────────────────────────────────────────────── */
  buildPlots() {
    const o = this.o;
    this.subtabs = el('div', { class: 'tabs', role: 'tablist' });
    for (const name of ['Spectrum', 'Calibrations', 'Cooler Voltage']) {
      const t = el('button', { role: 'tab', class: 'tab', 'aria-selected': String(name === o.subtab) }, name);
      t.addEventListener('click', () => { o.subtab = name; this.showSubtab(); });
      this.subtabs.append(t);
    }
    this.layoutSel = select(['3 row stacked', '2 row stacked'], { value: '3 row stacked', onchange: (v) => { o.plot_layout = v.startsWith('2') ? 'classic' : 'stacked'; this.applyLayout(); } });
    this.gridX = el('button', { type: 'button', class: 'tool', 'aria-pressed': 'false', 'data-tip': 'X grid' }, 'X');
    this.gridY = el('button', { type: 'button', class: 'tool', 'aria-pressed': 'false', 'data-tip': 'Y grid' }, 'Y');
    this.gridX.addEventListener('click', () => { o.grid_x = !o.grid_x; this.syncControls(); this.redrawCached(); });
    this.gridY.addEventListener('click', () => { o.grid_y = !o.grid_y; this.syncControls(); this.redrawCached(); });
    this.darkBtn = el('button', { type: 'button', class: 'tool', 'aria-pressed': String(this.dark), 'data-tip': 'Dark plots' }, icon('sun-moon'));
    this.darkBtn.addEventListener('click', () => this.tab.toggleDark());
    this.subtabs.append(el('div', { class: 'tabs-tools' },
      button('Info', { icon: 'circle-help', class: 'tool', onclick: () => this.info() }),
      el('span', {}, 'Layout:'), this.layoutSel, el('span', {}, 'Grid:'), this.gridX, this.gridY, this.darkBtn));

    // TOF
    const w = this.w;
    w.tofOn = check('Gate', { onchange: (v) => { o.tof.enabled = v; this.replot(); } });
    w.tofLo = num({ value: o.tof.lo, decimals: 1, step: 0.5, width: 70, onchange: (v) => { o.tof.lo = v; this.redrawGates(); this.replotSpectrum(); } });
    w.tofHi = num({ value: o.tof.hi, decimals: 1, step: 0.5, width: 70, onchange: (v) => { o.tof.hi = v; this.redrawGates(); this.replotSpectrum(); } });
    w.tofBin = num({ value: o.tof.binsize, decimals: 3, step: 0.1, min: 0.001, width: 70, onchange: (v) => { o.tof.binsize = v; this.replot(); } });
    this.tofBlock = el('div', { class: 'plot-block', dataset: { plot: 'tof' } },
      el('div', { class: 'plot-head' }, el('span', { class: 'title' }, 'TOF'), w.tofOn, w.tofLo, el('span', {}, 'to'), w.tofHi, el('span', {}, 'µs'), el('span', { class: 'sep' }), el('span', {}, 'Bin:'), w.tofBin));
    // Spectrum
    w.bin = num({ value: 1, min: 1, max: 1000, step: 1, decimals: 0, width: 56, tip: 'Group N adjacent scan steps into one bin', onchange: (v) => { o.step_multiple = v; this.replot(); } });
    this.specBlock = el('div', { class: 'plot-block big', dataset: { plot: 'spectrum' } },
      el('div', { class: 'plot-head' }, el('span', { class: 'title' }, 'Spectrum'), el('span', {}, 'Bin:'), w.bin, el('span', {}, '× step'), el('span', { class: 'spacer' }),
        button('', { icon: 'rotate-ccw', class: 'tool', tip: 'Reset zoom', onclick: () => [this.spec, this.tof, this.ts].forEach((p) => p.resetZoom()) })));
    // Timestamp
    w.tsUnit = select(Object.keys(TS_UNITS), { value: o.ts.unit, onchange: (v) => {
      const factor = TS_UNITS[o.ts.unit] / TS_UNITS[v];       // keep the absolute window (_on_ts_unit_changed)
      o.ts.lo *= factor; o.ts.hi *= factor; o.ts.binsize *= factor; o.ts.unit = v;
      this.scanCache.clear(); this.syncControls(); this.replot(); } });
    w.tsBin = num({ value: o.ts.binsize, decimals: 3, step: 1, min: 0.001, width: 70, onchange: (v) => { o.ts.binsize = v; this.replot(); } });
    w.tsOn = check('Gate', { tip: 'The time gate filters only the spectrum', onchange: (v) => { o.ts.gate_enabled = v; this.replot(); } });
    w.tsLo = num({ value: o.ts.lo, decimals: 3, step: 1, width: 80, onchange: (v) => { o.ts.lo = v; this.redrawGates(); this.replotSpectrum(); } });
    w.tsHi = num({ value: o.ts.hi, decimals: 3, step: 1, width: 80, onchange: (v) => { o.ts.hi = v; this.redrawGates(); this.replotSpectrum(); } });
    w.scans = check('Show scans', { tip: 'Scan boundaries of the single checked file', onchange: (v) => { o.ts.show_scans = v; this.drawTs(); } });
    this.tsBlock = el('div', { class: 'plot-block', dataset: { plot: 'ts' } },
      el('div', { class: 'plot-head' }, el('span', { class: 'title' }, 'Timestamp'), el('span', {}, 'Unit:'), w.tsUnit, el('span', {}, 'Bin:'), w.tsBin, el('span', { class: 'sep' }),
        w.tsOn, w.tsLo, el('span', {}, 'to'), w.tsHi, el('span', { class: 'sep' }), w.scans,
        button('Exclude scans in view', { class: 'tool', tip: 'Exclude every scan that starts inside the visible time range', onclick: () => this.excludeInView() })));

    const mk = (block, opts) => { const d = el('div', { class: 'plot' }); block.append(d); return new Plot(d, opts); };
    this.tof = mk(this.tofBlock, { onGate: (lo, hi) => { o.tof.lo = lo; o.tof.hi = hi; this.w.tofLo.num = lo; this.w.tofHi.num = hi; if (o.tof.enabled) this.replotSpectrum(); } });
    this.spec = mk(this.specBlock, {});
    this.ts = mk(this.tsBlock, { onGate: (lo, hi) => { o.ts.lo = lo; o.ts.hi = hi; this.w.tsLo.num = lo; this.w.tsHi.num = hi; if (o.ts.gate_enabled) this.replotSpectrum(); } });
    this.plotsBox = el('div', { class: 'plots' }, this.tofBlock, this.specBlock, this.tsBlock);

    // Calibrations + Cooler sub-tabs
    this.calBox = el('div', { class: 'plots', hidden: true });
    this.calPlots = ['readback', 'diff', 'step'].map(() => { const b = el('div', { class: 'plot-block' }); this.calBox.append(b); return mk(b, {}); });
    w.coolBins = num({ value: o.cooler_bins, min: 10, max: 5000, step: 10, decimals: 0, width: 70, onchange: (v) => { o.cooler_bins = v; this.doDiagnostics(); } });
    w.clip = check('Clip y to ±4σ', { checked: true, onchange: (v) => { o.clip_y = v; this.drawDiagnostics(); } });
    this.coolTable = el('div', { class: 'scroll', style: { maxHeight: '140px', flex: 'none' } });
    this.coolBox = el('div', { class: 'plots', hidden: true },
      el('div', { class: 'plot-head' }, el('span', {}, 'Time bins:'), w.coolBins, w.clip));
    this.coolPlots = ['raw', 'dev', 'ripple'].map(() => { const b = el('div', { class: 'plot-block' }); this.coolBox.append(b); return mk(b, {}); });
    this.coolBox.append(this.coolTable);

    this.right = el('div', { class: 'col', style: { flex: 1, minWidth: 0 } }, this.subtabs, this.plotsBox, this.calBox, this.coolBox);
    this.root.append(this.right);
    this.mnav = mobileNav(this.root, [['data', 'Data & Options', this.sidebar], ['plots', 'Plots', this.right]]);
    this.applyLayout();
  }

  showSubtab() {
    const s = this.o.subtab;
    [...this.subtabs.querySelectorAll('.tab')].forEach((t) => t.setAttribute('aria-selected', String(t.textContent === s)));
    this.plotsBox.hidden = s !== 'Spectrum';
    this.calBox.hidden = s !== 'Calibrations';
    this.coolBox.hidden = s !== 'Cooler Voltage';
    if (s !== 'Spectrum') this.doDiagnostics();
    window.dispatchEvent(new Event('resize'));
  }

  applyLayout() {
    this.plotsBox.classList.toggle('layout-2', this.o.plot_layout === 'classic');
    this.layoutSel.value = this.o.plot_layout === 'classic' ? '2 row stacked' : '3 row stacked';
    window.dispatchEvent(new Event('resize'));
  }

  applyDark() {
    this.darkBtn.setAttribute('aria-pressed', String(this.dark));
    this.renderFiles();
    this.models.forEach((m) => m.updateSwatch());
    this.redrawCached();
    this.drawDiagnostics();
  }

  syncControls() {
    const o = this.o, w = this.w;
    w.xaxis.value = o.x_axis; w.elower.num = o.e_lower; w.eupper.num = o.e_upper; w.harmonic.num = o.harmonic;
    w.Z.num = o.Z; w.A.num = o.A; w.massOv.box.checked = o.mass_override; w.mass.readOnly = !o.mass_override; w.mass.num = o.mass_amu;
    w.channels.forEach((cb, i) => { cb.box.checked = o.channels.includes(i + 1); });
    w.normalize.box.checked = o.normalize;
    w.coolOv.checked = o.cooler_override; w.cooler.disabled = !o.cooler_override; w.cooler.num = o.cooler_voltage;
    w.laserOv.checked = o.laser_override; w.laser.disabled = !o.laser_override; w.laser.num = o.laser_setpoint;
    w.tofOn.box.checked = o.tof.enabled; w.tofLo.num = o.tof.lo; w.tofHi.num = o.tof.hi; w.tofBin.num = o.tof.binsize;
    w.bin.num = o.step_multiple;
    w.tsUnit.value = o.ts.unit; w.tsBin.num = o.ts.binsize; w.tsOn.box.checked = o.ts.gate_enabled; w.tsLo.num = o.ts.lo; w.tsHi.num = o.ts.hi;
    w.scans.box.checked = o.ts.show_scans;
    this.gridX.setAttribute('aria-pressed', String(o.grid_x));
    this.gridY.setAttribute('aria-pressed', String(o.grid_y));
    this.updateTransition();
    this.applyLayout();
  }

  engineState(want) {
    const o = this.o;
    const loaded = this.files.filter((f) => f.status === 'ok');
    return {
      files: loaded.map((f) => ({ id: f.id, checked: f.checked })), selected: this.selected,
      x_axis: o.x_axis, harmonic: o.harmonic, e_lower: o.e_lower, e_upper: o.e_upper, normalize: o.normalize,
      Z: o.Z, A: o.A, mass_override: o.mass_override, mass_amu: o.mass_amu, channels: o.channels,
      tof: o.tof, ts: o.ts, cooler_override: { enabled: o.cooler_override, value: o.cooler_voltage },
      laser_override: { enabled: o.laser_override, value: o.laser_setpoint }, step_multiple: o.step_multiple,
      excluded_scans: Object.fromEntries(loaded.filter((f) => f.excluded.size).map((f) => [f.id, [...f.excluded]])),
      binning: o.binning, want, cooler_bins: o.cooler_bins,
      models: this.models.map((m) => m.toDict()),
    };
  }

  async doReplot(kind) {
    if (!this.engine.isReady('core')) return;
    const seq = ++this.seq;
    const want = kind === 'spectrum' ? { tof: false, ts: false } : { tof: true, ts: true };
    let r;
    try {
      r = await this.engine.call('preanalysis', 'compute', { state: this.engineState(want) });
    } catch (err) { status('Plot failed: ' + err.message); return; }
    const fresh = seq === this.seq;                                 // older results never overwrite a newer spectrum
    this.last = { ...(this.last || {}), ...(fresh ? { xlabel: r.xlabel, spectra: r.spectra } : {}), ...(kind === 'full' ? { tof: r.tof, ts: r.ts } : {}) };
    if (fresh && r.warnings?.length) status(r.warnings.join('; '));
    if (fresh) this.drawSpectrum();
    if (kind === 'full') { this.drawTof(); await this.drawTs(); if (this.o.subtab !== 'Spectrum') this.doDiagnostics(); }
  }

  fileById(id) { return this.files.find((f) => f.id === id); }
  seriesStyle(f) { return { color: this.dark ? f.dark_color : f.color, alpha: f.alpha, linestyle: lsName(f.linestyle), name: f.card?.name || f.name }; }

  drawSpectrum() {
    const L = this.last || {};
    const series = (L.spectra || []).map((s) => ({ kind: 'step', x: s.x, y: s.y, ...this.seriesStyle(this.fileById(s.id)), width: 1.5 }));
    const labels = [];
    for (const c of this.modelCurves || []) {
      const m = this.models[c.index];
      if (!m) continue;
      const color = this.dark ? m.d.dark_color : m.d.color;
      series.push({ kind: 'line', x: c.x, y: c.y, color, alpha: m.d.alpha, linestyle: m.d.linestyle, width: 2, name: m.d.name });
      if (c.peaks) c.peaks.labels.forEach((t, i) => labels.push({ x: c.peaks.x[i], y: c.peaks.y[i], text: t, color }));
    }
    const o = this.o;
    const checked = this.files.some((f) => f.checked && f.status === 'ok');
    this.spec.update({ series, labels, xlabel: L.xlabel || 'Frequency (MHz)', ylabel: o.normalize ? 'Normalized' : 'Counts',
      dark: this.dark, grid: { x: o.grid_x, y: o.grid_y }, uirev: o.x_axis,
      emptyText: this.files.length ? (checked ? '' : 'No file checked') : 'Open ASDF files to see the spectrum' });
  }

  drawTof() {
    const L = this.last || {}, o = this.o;
    const series = (L.tof || []).map((s) => ({ kind: 'stairs', edges: s.edges, counts: s.counts, ...this.seriesStyle(this.fileById(s.id)), width: 1.5 }));
    this.tof.update({ series, xlabel: 'Time (µs)', ylabel: 'Counts', dark: this.dark, grid: { x: o.grid_x, y: o.grid_y },
      gate: o.tof.enabled ? { lo: o.tof.lo, hi: o.tof.hi, color: GATE_TOF } : { lo: o.tof.lo, hi: o.tof.hi, color: '#888888', alpha: 0.08 } });
  }

  async drawTs() {
    const L = this.last || {}, o = this.o;
    const series = (L.ts || []).map((s) => ({ kind: 'stairs', edges: s.edges, counts: s.counts, ...this.seriesStyle(this.fileById(s.id)), width: 1.5 }));
    series.forEach((s) => { s.alpha *= 0.7; });
    const model = { series, xlabel: `Time (${o.ts.unit.toLowerCase()})`, ylabel: 'Events', dark: this.dark, grid: { x: o.grid_x, y: o.grid_y },
      gate: o.ts.gate_enabled || o.ts.hi > o.ts.lo ? { lo: o.ts.lo, hi: o.ts.hi, color: o.ts.gate_enabled ? GATE_TS : '#888888', alpha: o.ts.gate_enabled ? 0.25 : 0.08 } : null,
      uirev: o.ts.unit };
    const target = this.scanTarget();
    if (o.ts.show_scans && target) {
      const sc = await this.scansFor(target);
      const inc = [], exc = [], bands = [], tops = [];
      sc.starts.forEach((t, i) => {
        const excluded = target.excluded.has(sc.scans[i]);
        (excluded ? exc : inc).push(t);
        if (excluded) bands.push({ lo: t, hi: sc.starts[i + 1] ?? t, color: '#cc3333', alpha: 0.10 });
      });
      const stride = Math.max(1, Math.floor(sc.starts.length / 30));
      for (let i = 0; i < sc.starts.length; i += stride) tops.push({ x: sc.starts[i], text: String(sc.scans[i]) });
      model.vlines = [...inc.map((x) => ({ x, color: '#888888', alpha: 0.5, width: 0.4, dash: 'solid' })),
        ...exc.map((x) => ({ x, color: '#cc3333', alpha: 0.7, width: 0.9, dash: 'solid' }))];
      model.bands = bands;
      model.toplabels = tops;
    } else if (o.ts.show_scans) {
      model.note = 'Show scans: check exactly one file';
    }
    this.ts.update(model);
  }

  scanTarget() {
    const c = this.files.filter((f) => f.checked && f.status === 'ok');
    return c.length === 1 ? c[0] : null;
  }

  async scansFor(f) {
    const key = f.id + ':' + this.o.ts.unit;
    if (!this.scanCache.has(key)) this.scanCache.set(key, await this.engine.call('preanalysis', 'scans', { run_id: f.id, unit: this.o.ts.unit }));
    return this.scanCache.get(key);
  }

  async excludeInView() {
    const f = this.scanTarget();
    if (!f || !this.o.ts.show_scans) {
      await message('Exclude scans in view', 'Turn on "Show scans" and check exactly one file before using this action.');
      return;
    }
    const sc = await this.scansFor(f);
    if (!sc.starts.length) { await message('Exclude scans in view', 'No scans were derived for this file. Check that its ASDF has ScanningRanges and StepSize.'); return; }
    const range = this.ts.el.layout?.xaxis?.range;
    if (!range) return;
    const [lo, hi] = range;
    const add = sc.scans.filter((s, i) => sc.starts[i] >= lo && sc.starts[i] <= hi);
    if (!add.length) { await message('Exclude scans in view', 'No scan starts fall inside the current view range. Pan or zoom so at least one scan begins inside the visible window, then try again.'); return; }
    const before = f.excluded.size;
    add.forEach((s) => f.excluded.add(s));
    status(`Excluded ${f.excluded.size - before} more scan(s) of ${f.card.name} (${f.excluded.size} in total)`);
    this.renderFiles();
    this.replot();
  }

  redrawGates() { this.drawTof(); this.drawTs(); }
  redrawCached() { this.drawSpectrum(); this.drawTof(); this.drawTs(); }

  /* ── Models ──────────────────────────────────────────────────────── */
  addModel(dict) {
    const i = this.models.length;
    const m = new ModelPanel(this, dict || { name: `Model ${i + 1}`, color: MODEL_COLORS[i % 4], dark_color: NEON_MODEL_COLORS[i % 4] });
    this.models.push(m);
    this.modelList.append(m.root);
    this.replotModels();
    return m;
  }

  duplicateModels() {
    for (const m of this.models.filter((x) => x.d.enabled)) {
      const d = m.toDict();
      d.name = d.name + ' copy';
      this.addModel(JSON.parse(JSON.stringify(d)));
    }
  }

  removeModels() {
    const keep = this.models.filter((m) => !m.d.enabled);
    this.models.filter((m) => m.d.enabled).forEach((m) => m.root.remove());
    this.models = keep;
    this.replotModels();
  }

  async doModels() {
    if (!this.models.length) { this.modelCurves = []; this.drawSpectrum(); return; }
    if (!this.engine.isReady('full')) { status('Hyperfine engine still loading; the model appears when it is ready', true); return; }
    const seq = (this.mseq = (this.mseq || 0) + 1);
    const r = await this.engine.call('preanalysis', 'models', { state: this.engineState({}) });
    if (seq !== this.mseq) return;
    this.modelCurves = r.curves;
    if (r.errors?.length) status(r.errors.join('; '));
    this.drawSpectrum();
  }

  /* ── Diagnostics sub-tabs ────────────────────────────────────────── */
  async doDiagnostics() {
    if (!this.engine.isReady('core')) return;
    this.diag = await this.engine.call('preanalysis', 'diagnostics', { state: this.engineState({}) });
    this.drawDiagnostics();
  }

  drawDiagnostics() {
    const D = this.diag;
    if (!D) return;
    const light = { dark: this.dark, grid: { x: true, y: true } };     // follows the dark-plots button like the other plots
    const col = (id) => { const f = this.fileById(id); return (f && (this.dark ? f.dark_color : f.color)) || (this.dark ? '#fff' : '#000'); };
    const [pr, pd, ps] = this.calPlots;
    pr.update({ ...light, ylabel: 'Readback (V)', series: D.calibrations.flatMap((c) => [
      { kind: 'line', x: c.set, y: c.readback, color: col(c.id), name: c.label },
      ...(c.applied ? [{ kind: 'line', x: c.applied.x, y: c.applied.y, color: col(c.id), linestyle: 'Dashed', width: 1, alpha: 0.8 }] : [])]),
      emptyText: 'No calibration tables in the checked files' });
    pd.update({ ...light, ylabel: 'Readback − Set (V)', series: D.calibrations.flatMap((c) => [
      { kind: 'line', x: c.set, y: c.diff, color: col(c.id), name: c.label },
      ...(c.applied ? [{ kind: 'line', x: c.set, y: c.applied.resid, color: col(c.id), linestyle: 'Dotted', width: 1 }] : [])]) });
    ps.update({ ...light, xlabel: 'Set voltage (V)', ylabel: 'Δ Readback (V)', series: D.calibrations.map((c) => ({ kind: 'line', x: c.step_x, y: c.step, color: col(c.id), name: c.label })) });

    const [cr, cd, cp] = this.coolPlots;
    cr.update({ ...light, xlabel: 'Time since run start (s)', ylabel: 'Cooler V (V) [raw]',
      series: D.cooler.map((c) => ({ kind: 'line', x: c.t, y: c.v, color: col(c.id), width: 1.2, alpha: 0.9, name: `${c.label}  V_ref=${c.v_ref.toFixed(2)} V  σ=${c.sigma.toFixed(3)} V` })),
      hlines: D.cooler.map((c) => ({ y: c.v_ref, color: col(c.id), alpha: 0.7 })),
      emptyText: 'No cooler-voltage data in the checked files' });
    const dev = [];
    let yr;
    for (const c of D.cooler) {
      dev.push({ kind: 'step', x: c.bins, y: c.median_dev, color: col(c.id), width: 1.4, name: `${c.label}  σ=${c.sigma.toFixed(3)} V  p-p=${c.pp.toFixed(3)} V  spikes=${c.spikes}` });
      if (c.spike_points) dev.push({ kind: 'points', x: c.spike_points.t, y: c.spike_points.v, color: col(c.id), alpha: 0.65 });
    }
    if (this.o.clip_y && D.cooler.length) {
      const lim = 4 * Math.max(...D.cooler.map((c) => c.sigma));
      const meds = D.cooler.flatMap((c) => c.median_dev);
      if (lim > 0) yr = [Math.min(-lim, Math.min(...meds)), Math.max(lim, Math.max(...meds))];
    }
    cd.update({ ...light, xlabel: 'Time since run start (s)', ylabel: 'Deviation from run average (V)', series: dev, yrange: yr,
      hbands: D.cooler.flatMap((c) => (c.sigma > 0 ? [{ lo: -3 * c.sigma, hi: 3 * c.sigma, color: col(c.id), alpha: 0.07 },
        { lo: -c.sigma, hi: c.sigma, color: col(c.id), alpha: 0.15 }] : [])),
      hlines: D.cooler.length ? [{ y: 0, color: '#555555', alpha: 0.6 }] : [],
      title: D.mhz_per_v ? `1 V ≈ ${Math.abs(D.mhz_per_v).toFixed(2)} MHz` : undefined });
    cp.update({ ...light, xlabel: 'Time since run start (s)', ylabel: 'Ripple amplitude (V)', series: D.cooler.flatMap((c) => [
      { kind: 'step', x: c.bins, y: c.rms, color: col(c.id), width: 1.4, name: `${c.label} RMS` },
      { kind: 'step', x: c.bins, y: c.p95_p5, color: col(c.id), width: 1.4, alpha: 0.85, linestyle: 'Dashed', name: `${c.label} P95−P5` }]) });
    const k = D.mhz_per_v;
    this.coolTable.replaceChildren(D.cooler.length ? el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, ...['Run', 'V_ref (V)', 'σ (V)', 'p-p (V)', 'spikes', 'max− / max+ (V)', 'σ (MHz)'].map((h, i) => el('th', { class: i ? '' : 'l' }, h)))),
      el('tbody', {}, ...D.cooler.map((c) => el('tr', {}, el('td', { class: 'l' }, c.label), el('td', {}, c.v_ref.toFixed(2)), el('td', {}, c.sigma.toFixed(3)),
        el('td', {}, c.pp.toFixed(3)), el('td', {}, String(c.spikes)), el('td', {}, `${c.max_dn >= 0 ? '+' : ''}${c.max_dn.toFixed(3)} / ${c.max_up >= 0 ? '+' : ''}${c.max_up.toFixed(3)}`),
        el('td', {}, k ? Math.abs(c.sigma * k).toFixed(2) : 'n/a'))))) : '');
  }

  /* ── Export ──────────────────────────────────────────────────────── */
  async savePlot() {
    if (!this.engine.isReady('full')) { await message('Save Plot', 'The plotting engine is still loading. Try again in a few seconds.'); return; }
    const which = select(['Spectrum', 'TOF', 'Timestamp', 'All three (stacked)'], { value: 'Spectrum' });
    const fmtSel = select(['png', 'pdf', 'svg'], { value: 'png' });
    const dpi = num({ value: 300, min: 72, max: 1200, step: 50, decimals: 0, width: 80 });
    const dark = check('Dark (as on screen)', { checked: this.dark });
    const ok = await dialog({ title: 'Save Plot', width: 380, body: el('div', { class: 'grid2' },
      el('label', {}, 'Plot'), which, el('label', {}, 'Format'), fmtSel, el('label', {}, 'DPI'), dpi, el('span'), dark),
    buttons: [{ label: 'Save', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    const panels = { Spectrum: [this.spec], TOF: [this.tof], Timestamp: [this.ts], 'All three (stacked)': [this.tof, this.spec, this.ts] }[which.value]
      .map((p) => p.exportPanel());
    status('Rendering plot…', true);
    const bytes = await this.engine.call('export', 'figure', { spec: { panels, dark: dark.box.checked, size: [10, 3.4 * panels.length + (panels.length === 1 ? 1.4 : 0)] }, fmt: fmtSel.value, dpi: dpi.num });
    const type = { png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml' }[fmtSel.value];
    await saveFile(bytes, `${this.name.replace(/[^\w.-]+/g, '_')}_${which.value.split(' ')[0].toLowerCase()}.${fmtSel.value}`, { type });
    status('Plot saved');
  }

  info() {
    return message('Pre-Analysis', [
      'Open ASDF run files (or drop them on this tab). Nothing is uploaded: the files are read in your browser.',
      '',
      'Spectrum: counts per scan step, converted to the chosen x-axis with the Doppler formula',
      '(Frequency and Wavenumber bin in the frequency domain, voltage axes per raw scan step).',
      'TOF / Timestamp: drag the shaded gate or type the limits; the time gate filters only the spectrum.',
      'Show scans + "Exclude scans in view": zoom the timestamp plot onto bad scans, then exclude them.',
      '',
      'HFS Models: satlas2 hyperfine models to read off initial guesses for the fit.',
      'Mouse: drag to zoom, scroll to zoom, double-click to reset.',
      '',
      'Not in Mini DENIS (use desktop DENIS): merging, virtual splits, calibration editing.',
    ].join('\n'));
  }

  /* ── Session ─────────────────────────────────────────────────────── */
  toDict() {
    const o = this.o;
    return {
      name: this.name,
      files: this.files.map((f) => ({ path: f.path, color: f.color, dark_color: f.dark_color, alpha: f.alpha, linestyle: f.linestyle, checked: f.checked, centroid_offset_mhz: f.centroid_offset_mhz })),
      merged_entries: this.mergedPassthrough,
      plot_options: { x_axis: o.x_axis, plot_layout: o.plot_layout, dark_mode: this.dark, grid_x: o.grid_x, grid_y: o.grid_y, e_lower: o.e_lower, e_upper: o.e_upper,
        harmonic: o.harmonic, normalize: o.normalize, Z: o.Z, A: o.A, mass_override: o.mass_override, mass_amu: o.mass_amu, channels: [...o.channels] },
      tof_gate: { enabled: o.tof.enabled, lo: o.tof.lo, hi: o.tof.hi, binsize: o.tof.binsize },
      cooler_voltage: o.cooler_voltage, laser_setpoint: o.laser_setpoint, cooler_override: o.cooler_override, laser_override: o.laser_override,
      binning: { ...o.binning, step_multiple: o.step_multiple },
      models: this.models.map((m) => m.toDict()),
    };
  }

  fromDict(d) {
    const o = this.o;
    const po = d.plot_options || {};
    o.x_axis = XAXES.includes(po.x_axis) ? po.x_axis : 'Frequency';
    o.plot_layout = po.plot_layout === 'classic' ? 'classic' : 'stacked';
    if (po.dark_mode !== undefined && po.dark_mode !== this.dark) this.tab.setDark(po.dark_mode);
    o.grid_x = !!po.grid_x; o.grid_y = !!po.grid_y;
    if ('e_lower' in po) { o.e_lower = +po.e_lower; o.e_upper = +po.e_upper; } else if ('offset' in po) { o.e_lower = 0; o.e_upper = +po.offset; }
    o.harmonic = +(po.harmonic ?? 2); o.normalize = !!po.normalize; o.Z = +(po.Z ?? 1); o.A = +(po.A ?? 1);
    o.mass_override = !!po.mass_override; if (o.mass_override && 'mass_amu' in po) o.mass_amu = +po.mass_amu;
    o.channels = Array.isArray(po.channels) ? po.channels.map(Number) : [3, 4];
    const tof = d.tof_gate || {};
    o.tof = { enabled: !!tof.enabled, lo: +(tof.lo ?? 30), hi: +(tof.hi ?? 60), binsize: +(tof.binsize ?? 0.1) };
    o.cooler_voltage = +(d.cooler_voltage ?? 29977); o.laser_setpoint = +(d.laser_setpoint ?? 10920);
    const legacy = !!d.cooler_laser_override;
    o.cooler_override = !!(d.cooler_override ?? legacy); o.laser_override = !!(d.laser_override ?? legacy);
    const b = d.binning || {};
    o.binning = { bin_mode: b.bin_mode ?? 'Raw Voltage', x_column: b.x_column ?? 'bins_center', yerr_mode: b.yerr_mode ?? 'None', xerr_mode: b.xerr_mode ?? 'None',
      bin_definition: b.bin_definition ?? 'Per scan step', bin_count: +(b.bin_count ?? 100), bin_width_mhz: +(b.bin_width_mhz ?? 10) };
    o.step_multiple = +(b.step_multiple ?? 1);
    this.mergedPassthrough = d.merged_entries || [];
    if (this.mergedPassthrough.length) status(`${this.name}: ${this.mergedPassthrough.length} merged spectra are kept in the session but only shown in desktop DENIS`, true);
    this.files = (d.files || []).map((fd, i) => {
      const it = this.newFileItem(basename(fd.path), fd.path);
      Object.assign(it, { color: fd.color || DEFAULT_COLORS[i % 10], dark_color: fd.dark_color || NEON_COLORS[i % 10], alpha: +(fd.alpha ?? 1),
        linestyle: lsCode(fd.linestyle), checked: fd.checked !== false, centroid_offset_mhz: +(fd.centroid_offset_mhz ?? 0) });
      return it;
    });
    this.models.forEach((m) => m.root.remove());
    this.models = [];
    (d.models || []).forEach((md) => this.addModel(md));
    this.syncControls();
    this.refreshMass();
    this.renderFiles();
    this.replot();
  }
}

/* ══════════════════════════════════════════════════════════════════════════════ */

class ModelPanel {
  constructor(project, dict) {
    this.p = project;
    const d = { name: 'Model 1', enabled: true, color: '#000000', dark_color: '#FFE500', linestyle: 'Solid', alpha: 1,
      fix_a_ratio: false, a_ratio: 1, fix_b_ratio: false, b_ratio: 1, I: 3.5, Jl: 4.5, Ju: 5.5,
      bkg_order: 0, peaks_enabled: false, peak_labels_enabled: false, peaks: [], slider_ranges: {} };
    for (const [k, , def, lo, hi] of PARAMS) { d[k] = def; d.slider_ranges[k] = [lo, hi]; }
    Object.assign(d, dict || {});
    d.slider_ranges = { ...Object.fromEntries(PARAMS.map(([k, , , lo, hi]) => [k, [lo, hi]])), ...(dict?.slider_ranges || {}) };
    this.d = d;
    this.rows = {};
    this.build();
  }

  changed() { this.p.replotModels(); }

  build() {
    const d = this.d;
    this.enabled = el('input', { type: 'checkbox', checked: d.enabled, 'aria-label': 'Show model' });
    this.enabled.addEventListener('change', () => { d.enabled = this.enabled.checked; this.changed(); });
    this.nameInput = el('input', { type: 'text', value: d.name });
    this.nameInput.addEventListener('change', () => { d.name = this.nameInput.value; this.changed(); });
    this.swatch = el('button', { type: 'button', class: 'color-btn', 'data-tip': 'Model colour (light / dark plots)' });
    this.swatch.addEventListener('click', () => this.colorDialog());
    this.updateSwatch();
    const ls = select(LINESTYLES, { value: d.linestyle, onchange: (v) => { d.linestyle = v; this.changed(); } });
    const alpha = el('input', { type: 'range', min: 0, max: 100, value: Math.round(d.alpha * 100), 'data-tip': 'Transparency' });
    alpha.addEventListener('input', () => { d.alpha = alpha.value / 100; this.changed(); });
    const head = el('div', { class: 'model-head' }, this.enabled, this.nameInput, this.swatch, ls, alpha);

    const spin = (k, label) => num({ value: d[k], min: 0, max: 20, step: 0.5, decimals: 1, width: 58, onchange: (v) => { d[k] = v; this.onSpinsChanged(); } });
    this.sI = spin('I'); this.sJl = spin('Jl'); this.sJu = spin('Ju');
    const spins = el('div', { class: 'spins' }, el('label', { style: { width: '68px', textAlign: 'right' } }, 'I'), this.sI, el('label', {}, 'Jl'), this.sJl, el('label', {}, 'Ju'), this.sJu);

    const body = el('div', {}, spins);
    for (const [k, label] of PARAMS) {
      body.append(this.paramRow(k, label));
      if (k === 'Au') body.append(this.ratioRow('a'));
      if (k === 'Bu') body.append(this.ratioRow('b'));
      if (k === 'scale') {
        this.bkgSel = select([{ value: '0', label: 'Constant' }, { value: '1', label: 'Linear' }, { value: '2', label: 'Quadratic' }],
          { value: String(d.bkg_order || 0), tip: 'Shape of the background: p0, p0 + p1·x, p0 + p1·x + p2·x² (x in MHz)',
            onchange: (v) => { d.bkg_order = +v; this.showBkgRows(); this.changed(); } });
        body.append(el('div', { class: 'param' }, el('label', {}, 'Bkg model'), this.bkgSel));
      }
    }
    this.peaksToggle = check('Peak Amplitudes', { checked: d.peaks_enabled, onchange: (v) => { d.peaks_enabled = v; this.peaksBox.hidden = !v; if (v && !d.peaks.length) this.rebuildPeaks(); else this.changed(); } });
    this.labelsToggle = check('Show Labels', { checked: d.peak_labels_enabled, onchange: (v) => { d.peak_labels_enabled = v; this.changed(); } });
    this.peaksBox = el('div', { hidden: !d.peaks_enabled });
    body.append(el('div', { class: 'peaks' }, el('div', { class: 'row' }, this.peaksToggle, this.labelsToggle), this.peaksBox));
    this.root = el('div', { class: 'model' }, head, body);
    this.showBkgRows();
    if (d.peaks_enabled) this.rebuildPeaks(d.peaks);
  }

  updateSwatch() {
    const dark = this.p.dark;
    this.swatch.style.background = dark ? this.d.dark_color : this.d.color;
  }

  async colorDialog() {
    const light = el('input', { type: 'color', value: this.d.color });
    const dark = el('input', { type: 'color', value: this.d.dark_color });
    const ok = await dialog({ title: 'Model colours', width: 320, body: el('div', { class: 'grid2' },
      el('label', {}, 'Light plots'), light, el('label', {}, 'Dark plots'), dark),
    buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    this.d.color = light.value;
    this.d.dark_color = dark.value;
    this.updateSwatch();
    this.changed();
  }

  paramRow(k, label) {
    const d = this.d;
    const [lo, hi] = d.slider_ranges[k];
    const value = num({ value: d[k], decimals: PARAM_DEC[k] ?? 2, step: k === 'bkg_p1' ? 0.001 : k === 'bkg_p2' ? 1e-6 : 1, width: 95, tip: k,
      onchange: (v) => { d[k] = v; this.syncSlider(k); this.applyRatio(k, v); this.changed(); } });
    const slider = el('input', { type: 'range', min: 0, max: 10000, step: 1, 'aria-label': label });
    slider.addEventListener('input', () => {
      const [a, b] = d.slider_ranges[k];
      const v = a + (b - a) * slider.value / 10000;
      d[k] = v; value.num = v; this.applyRatio(k, v); this.changed();
    });
    const lim = el('button', { type: 'button', class: 'tool', 'data-tip': 'Adjust slider limits' }, '…');
    lim.addEventListener('click', () => this.limitsDialog(k));
    const row = el('div', { class: 'param' }, el('label', {}, label), value, slider, lim);
    this.rows[k] = { row, value, slider };
    this.syncSlider(k);
    return row;
  }

  syncSlider(k) {
    const [lo, hi] = this.d.slider_ranges[k];
    const r = this.rows[k];
    if (!r) return;
    r.slider.value = hi > lo ? Math.max(0, Math.min(10000, Math.round(10000 * (this.d[k] - lo) / (hi - lo)))) : 5000;
  }

  setLinked(k, v) { this.d[k] = v; this.rows[k].value.num = v; this.syncSlider(k); }

  applyRatio(k, v) {                                   // HFSModelPanel._apply_ratio
    const d = this.d;
    if (k === 'Au' && d.fix_a_ratio) this.setLinked('Al', v * d.a_ratio);
    else if (k === 'Al' && d.fix_a_ratio && d.a_ratio) this.setLinked('Au', v / d.a_ratio);
    else if (k === 'Bu' && d.fix_b_ratio) this.setLinked('Bl', v * d.b_ratio);
    else if (k === 'Bl' && d.fix_b_ratio && d.b_ratio) this.setLinked('Bu', v / d.b_ratio);
  }

  ratioRow(which) {
    const d = this.d;
    const fixKey = `fix_${which}_ratio`, rKey = `${which}_ratio`;
    const box = check(which === 'a' ? 'Fix Al/Au' : 'Fix Bl/Bu', { checked: d[fixKey], tip: `Lock the ${which === 'a' ? 'Al / Au' : 'Bl / Bu'} ratio`, onchange: (v) => { d[fixKey] = v; this.changed(); } });
    const r = num({ value: d[rKey], min: -1000, max: 1000, decimals: 4, step: 0.01, width: 80, tip: which === 'a' ? 'Al / Au ratio' : 'Bl / Bu ratio', onchange: (v) => { d[rKey] = v; this.changed(); } });
    return el('div', { class: 'ratio' }, box, r);
  }

  showBkgRows() {
    const order = this.d.bkg_order || 0;
    ['bkg', 'bkg_p1', 'bkg_p2'].forEach((k, n) => { this.rows[k].row.hidden = n > order; });
  }

  async limitsDialog(k) {
    const [lo, hi] = this.d.slider_ranges[k];
    const a = num({ value: lo, decimals: 2, width: 110 });
    const b = num({ value: hi, decimals: 2, width: 110 });
    const ok = await dialog({ title: `Slider Limits: ${k}`, width: 260, body: el('div', { class: 'grid2' }, el('label', {}, 'Min:'), a, el('label', {}, 'Max:'), b),
      buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    this.d.slider_ranges[k] = [a.num, b.num];
    this.syncSlider(k);
  }

  onSpinsChanged() {
    if (this.d.peaks_enabled) this.rebuildPeaks();
    else { this.d.peaks = []; this.changed(); }
  }

  async rebuildPeaks(saved) {
    const d = this.d;
    if (!this.p.engine.isReady('full')) {
      this.peaksPending = true;
      this.peaksBox.replaceChildren(el('div', { class: 'muted small' }, 'Loading the hyperfine engine…'));
      return;
    }
    this.peaksPending = false;
    const r = await this.p.engine.call('preanalysis', 'peak_rows', { I: d.I, Jl: d.Jl, Ju: d.Ju });
    const prev = Object.fromEntries((saved || d.peaks || []).map((p) => [p.label, p]));
    d.peaks = r.labels.map((label, i) => ({ label, racah: r.racah[i], mode: prev[label]?.mode || 'Racah', value: prev[label]?.value ?? r.racah[i],
      linked_to: prev[label]?.linked_to || r.labels.find((l) => l !== label) || '', ratio: prev[label]?.ratio ?? 1 }));
    this.renderPeaks();
    this.changed();
  }

  renderPeaks() {
    const d = this.d;
    this.peaksBox.replaceChildren(...d.peaks.map((pk) => {
      const value = num({ value: pk.value, min: 0, max: 100, decimals: 4, step: 0.01, width: 80, disabled: pk.mode !== 'Free', onchange: (v) => { pk.value = v; this.changed(); } });
      const ratio = num({ value: pk.ratio, min: -100, max: 100, decimals: 3, step: 0.1, width: 58, tip: 'Ratio: this = ratio × linked', onchange: (v) => { pk.ratio = v; this.changed(); } });
      const link = select(d.peaks.map((x) => x.label).filter((l) => l !== pk.label), { value: pk.linked_to, onchange: (v) => { pk.linked_to = v; this.changed(); } });
      const linkRow = el('div', { class: 'peak-row', style: { marginLeft: '20px' }, hidden: pk.mode !== 'Linked' }, ratio, el('span', {}, '×'), link);
      const mode = select(['Racah', 'Free', 'Linked'], { value: pk.mode, onchange: (v) => {
        pk.mode = v; value.disabled = v !== 'Free'; linkRow.hidden = v !== 'Linked';
        if (v === 'Racah') { pk.value = pk.racah; value.num = pk.racah; }
        this.changed(); } });
      return el('div', {}, el('div', { class: 'peak-row' }, el('span', { class: 'plabel', 'data-tip': `Racah: ${pk.racah.toFixed(6)}` }, pk.label),
        el('span', { class: 'muted small' }, `(${pk.racah.toFixed(2)})`), mode, value), linkRow);
    }));
  }

  toDict() {
    const d = this.d;
    const out = { name: d.name, enabled: d.enabled, color: d.color, dark_color: d.dark_color, linestyle: d.linestyle, alpha: d.alpha,
      fix_a_ratio: d.fix_a_ratio, a_ratio: d.a_ratio, fix_b_ratio: d.fix_b_ratio, b_ratio: d.b_ratio, I: d.I, Jl: d.Jl, Ju: d.Ju };
    for (const [k] of PARAMS) out[k] = d[k];
    out.bkg_order = d.bkg_order;
    out.slider_ranges = Object.fromEntries(PARAMS.map(([k]) => [k, [...d.slider_ranges[k]]]));
    out.peaks_enabled = d.peaks_enabled;
    out.peak_labels_enabled = d.peak_labels_enabled;
    out.peaks = d.peaks.map((p) => ({ label: p.label, mode: p.mode, value: p.value, linked_to: p.linked_to, ratio: p.ratio }));
    // key order of HFSModelPanel.to_dict: bkg_order sits with the model params
    return out;
  }
}
