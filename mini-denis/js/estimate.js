/* Estimate tab of Mini DENIS (mirrors DENIS gui/estimate_tab.py; runs cls_estimate.run in the engine). */
import { el, icon, button, num, check, select, dialog, message, status, pickFiles, saveFile, makeSplitter, fmt, signed, mobileNav, isNarrow } from './ui.js';
import { Plot } from './plots.js';

// cls_estimations/plotting.py PALETTES
const PALETTES = {
  default: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'],
  pastel: ['#a1c9f4', '#ffb482', '#8de5a1', '#ff9f9b', '#d0bbff', '#debb9b', '#fab0e4', '#cfcfcf'],
  vibrant: ['#e60049', '#0bb4ff', '#50e991', '#e6d800', '#9b19f5', '#ffa300', '#dc0ab4', '#00bfa0'],
  muted: ['#4878d0', '#ee854a', '#6acc64', '#d65f5f', '#956cb4', '#8c613c', '#dc7ec0', '#797979'],
  high_contrast: ['#023eff', '#ff7c00', '#1ac938', '#e8000b', '#8b2be2', '#9f4800', '#f14cc1', '#a3a3a3'],
};
const XLABEL = 'Voltage offset ΔV (V)';

let meta = { element_z: {}, orbitals: [] };

// Dark plots (a Mini DENIS preference of this browser, dark unless switched off)
function loadDark() { try { return localStorage.getItem('est_dark_plots') !== '0'; } catch { return true; } }
function saveDark(v) { try { localStorage.setItem('est_dark_plots', v ? '1' : '0'); } catch { /* ignore */ } }
const zToElement = () => Object.fromEntries(Object.entries(meta.element_z).map(([s, z]) => [z, s]));

/** A field row: label + control (+ unit). */
function field(label, control, unit, tip) {
  return el('div', { class: 'row', 'data-tip': tip }, el('label', { class: 'lbl' }, label), control, unit ? el('span', { class: 'muted' }, unit) : null);
}

/** Text input for numbers in scientific notation (yields): accepts 1e6, 2.5E4 ... */
function sci(value, { min = 0, max = 1e15, width = 110, onchange } = {}) {
  const input = el('input', { type: 'text', style: { width: width + 'px', textAlign: 'right' } });
  const show = (v) => { input.value = v === 0 ? '0' : Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3 ? v.toExponential(5).replace(/\.?0+e/, 'e') : String(+v.toPrecision(6)); };
  Object.defineProperty(input, 'num', {
    get: () => { const v = parseFloat(input.value); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0; },
    set: (v) => show(+v),
  });
  input.num = value;
  input.addEventListener('change', () => { input.num = input.num; onchange && onchange(input.num); });
  return input;
}

function radio(name, label, checked, onchange) {
  const r = el('input', { type: 'radio', name, checked });
  if (onchange) r.addEventListener('change', () => r.checked && onchange());
  const l = el('label', { class: 'check' }, r, label);
  l.box = r;
  return l;
}

let radioGroup = 0;

/* ── Schmidt widget ───────────────────────────────────────────────── */
class Schmidt {
  constructor(owner) {
    this.owner = owner;
    const g = `schmidt${++radioGroup}`;
    this.enable = check('Use Schmidt moment', { onchange: () => { this.update(); this.emit(); } });
    this.single = radio(g, 'Single particle', true, () => { this.update(); this.emit(); });
    this.two = radio(g, 'Two particles', false, () => { this.update(); this.emit(); });
    const types = () => select(['proton', 'neutron'], { onchange: () => this.emit() });
    const orbs = () => select(meta.orbitals, { onchange: () => this.emit() });
    this.spType = types(); this.spOrb = orbs();
    this.t1 = types(); this.o1 = orbs(); this.t2 = types(); this.o2 = orbs();
    this.tpI = num({ value: 0, min: 0, max: 20, step: 0.5, decimals: 1, width: 60, onchange: () => this.emit() });
    this.singleBox = el('div', { class: 'row' }, this.spType, el('span', {}, 'in'), this.spOrb);
    this.twoBox = el('div', {}, el('div', { class: 'row' }, this.t1, this.o1), el('div', { class: 'row' }, this.t2, this.o2),
      el('div', { class: 'row' }, el('label', {}, 'I'), this.tpI));
    this.body = el('div', { style: { marginLeft: '18px' } }, el('div', { class: 'row' }, this.single, this.two), this.singleBox, this.twoBox);
    this.root = el('div', {}, this.enable, this.body);
    this.update();
  }
  refreshOrbitals() { for (const s of [this.spOrb, this.o1, this.o2]) { const v = s.value; s.replaceChildren(...meta.orbitals.map((o) => el('option', { value: o, text: o }))); if (v) s.value = v; } }
  update() {
    this.body.hidden = !this.enable.box.checked;
    this.singleBox.hidden = !this.single.box.checked;
    this.twoBox.hidden = this.single.box.checked;
  }
  toDict() {
    if (!this.enable.box.checked) return null;
    if (this.single.box.checked) return { type: this.spType.value, orbital: this.spOrb.value };
    return { type1: this.t1.value, orbital1: this.o1.value, type2: this.t2.value, orbital2: this.o2.value, I: this.tpI.num };
  }
  fromDict(d) {
    this.enable.box.checked = !!d;
    if (d && d.type) { this.single.box.checked = true; this.spType.value = d.type; this.spOrb.value = d.orbital || meta.orbitals[0]; }
    else if (d && d.type1) {
      this.two.box.checked = true; this.t1.value = d.type1; this.o1.value = d.orbital1; this.t2.value = d.type2; this.o2.value = d.orbital2;
      if (d.I !== undefined && d.I !== null) this.tpI.num = d.I;
    }
    this.update();
  }
  async emit() {                                       // auto-fill mu with the unquenched value (display only)
    const spec = this.toDict();
    if (!spec) return;
    const r = await this.owner.tab.engine.call('estimate_meta', 'schmidt_mu', { spec });
    if (!r.error) { this.owner.mu.num = r.mu; this.owner.mu.dataset.tip = r.desc; }
  }
}

/* ── A/B override block ───────────────────────────────────────────── */
function abBlock() {
  const mk = () => num({ value: 0, min: -1e6, max: 1e6, decimals: 4, width: 100 });
  const b = { check: check('Override A/B constants'), Al: mk(), Bl: mk(), Au: mk(), Bu: mk() };
  b.body = el('div', { class: 'grid2', style: { marginLeft: '18px' } },
    el('label', {}, 'A_lower'), el('div', { class: 'row', style: { margin: 0 } }, b.Al, el('span', { class: 'muted' }, 'MHz')),
    el('label', {}, 'B_lower'), el('div', { class: 'row', style: { margin: 0 } }, b.Bl, el('span', { class: 'muted' }, 'MHz')),
    el('label', {}, 'A_upper'), el('div', { class: 'row', style: { margin: 0 } }, b.Au, el('span', { class: 'muted' }, 'MHz')),
    el('label', {}, 'B_upper'), el('div', { class: 'row', style: { margin: 0 } }, b.Bu, el('span', { class: 'muted' }, 'MHz')));
  b.update = () => { b.body.hidden = !b.check.box.checked; };
  b.check.box.addEventListener('change', b.update);
  b.root = el('div', {}, b.check, b.body);
  b.update();
  b.write = (d) => { if (b.check.box.checked) Object.assign(d, { A_lower_MHz: b.Al.num, B_lower_MHz: b.Bl.num, A_upper_MHz: b.Au.num, B_upper_MHz: b.Bu.num }); };
  b.read = (d, test = (k) => k in d) => {
    const has = ['A_lower_MHz', 'A_upper_MHz', 'B_lower_MHz', 'B_upper_MHz'].some(test);
    b.check.box.checked = has;
    if (has) { b.Al.num = +(d.A_lower_MHz ?? 0); b.Bl.num = +(d.B_lower_MHz ?? 0); b.Au.num = +(d.A_upper_MHz ?? 0); b.Bu.num = +(d.B_upper_MHz ?? 0); }
    b.update();
  };
  return b;
}

/* ── Isomer panel ─────────────────────────────────────────────────── */
class Isomer {
  constructor(owner) {
    this.owner = owner;
    this.tab = owner.tab;
    const g = `yield${++radioGroup}`;
    this.I = num({ value: 0, min: 0, max: 20, step: 0.5, decimals: 1, width: 70 });
    this.mu = num({ value: 0, min: -10, max: 10, step: 0.1, decimals: 5, width: 90 });
    this.Q = num({ value: 0, min: -5, max: 5, step: 0.1, decimals: 5, width: 90 });
    this.shift = num({ value: 0, min: -1e6, max: 1e6, step: 1, decimals: 2, width: 100 });
    this.peaks = num({ value: 1, min: 1, max: 100, step: 1, decimals: 0, width: 60 });
    this.withGs = check('Plot with ground state', { checked: true });
    this.yRatio = radio(g, 'Production ratio', true);
    this.yIndep = radio(g, 'Independent yield', false);
    this.ySpin = radio(g, 'Spin distribution σ', false);
    this.ratio = num({ value: 0.5, min: 0, max: 1, step: 0.05, decimals: 3, width: 80 });
    this.indep = sci(0);
    this.sigma = num({ value: 7.0, min: 0.1, max: 100, step: 0.5, decimals: 2, width: 80 });
    this.ab = abBlock();
    this.schmidt = new Schmidt(this);
    this.timing = el('div', {}, field('Peaks to measure', this.peaks),
      el('div', { class: 'subgroup' }, el('div', { class: 'sg-title' }, 'Isomer yield'),
        el('div', { class: 'row' }, this.yRatio, this.ratio, el('span', { class: 'muted' }, 'to g.s.')),
        el('div', { class: 'row' }, this.yIndep, this.indep, el('span', { class: 'muted' }, 'ions/s')),
        el('div', { class: 'row' }, this.ySpin, this.sigma)));
    this.root = el('div', { class: 'isomer' },
      field('I', this.I, 'ħ'), field('μ', this.mu, 'μ_N'), field('Q', this.Q, 'b'), field('Isomer shift', this.shift, 'MHz'),
      this.timing, this.withGs, this.ab.root, this.schmidt.root);
  }
  setSpectrumOnly(on) { this.timing.hidden = on; }
  toDict() {
    const d = { I: this.I.num, mu: this.mu.num, Q: this.Q.num, isotope_shift_MHz: this.shift.num };
    const so = this.tab.spectrumOnly();
    if (!so) d.peaks_to_measure = this.peaks.num;
    d.plot_with_gs = this.withGs.box.checked;
    if (!so) {
      if (this.yRatio.box.checked) d.production_ratio = this.ratio.num;
      else if (this.yIndep.box.checked) d.yield_ions_per_sec = this.indep.num;
      else d.spin_distribution_sigma = this.sigma.num;
    }
    this.ab.write(d);
    const sv = this.schmidt.toDict();
    if (sv) d.schmidt_valence = sv;
    return d;
  }
  fromDict(d) {
    if (!d) return;
    this.I.num = +(d.I ?? 0); this.mu.num = +(d.mu ?? 0); this.Q.num = +(d.Q ?? 0); this.shift.num = +(d.isotope_shift_MHz ?? 0);
    if (d.peaks_to_measure != null) this.peaks.num = d.peaks_to_measure;
    this.withGs.box.checked = d.plot_with_gs ?? true;
    if (d.production_ratio != null) { this.yRatio.box.checked = true; this.ratio.num = d.production_ratio; }
    else if (d.yield_ions_per_sec != null) { this.yIndep.box.checked = true; this.indep.num = d.yield_ions_per_sec; }
    else if (d.spin_distribution_sigma != null) { this.ySpin.box.checked = true; this.sigma.num = d.spin_distribution_sigma; }
    this.ab.read(d);
    this.schmidt.fromDict(d.schmidt_valence);
    if (this.schmidt.toDict() && this.mu.num === 0) this.schmidt.emit();
  }
}

/* ── Isotope panel ────────────────────────────────────────────────── */
class Isotope {
  constructor(tab) {
    this.tab = tab;
    const g = `bg${++radioGroup}`;
    this.A = num({ value: 1, min: 1, max: 300, step: 1, decimals: 0, width: 64, onchange: () => { this.updateMass(); this.tab.refreshRefs(); } });
    this.mass = el('span', { class: 'mass' });
    this.label = el('input', { type: 'text', placeholder: 'e.g. 77Ge', style: { width: '110px' } });
    this.label.addEventListener('change', () => this.updateTitle());
    this.I = num({ value: 0, min: 0, max: 20, step: 0.5, decimals: 1, width: 70 });
    this.mu = num({ value: 0, min: -10, max: 10, step: 0.1, decimals: 5, width: 90 });
    this.Q = num({ value: 0, min: -5, max: 5, step: 0.1, decimals: 5, width: 90 });
    this.shift = num({ value: 0, min: -1e6, max: 1e6, step: 1, decimals: 2, width: 100 });
    this.yield = sci(0);
    this.eff = num({ value: 0.001, min: 0, max: 1, step: 0.0001, decimals: 6, width: 100 });
    this.peaks = num({ value: 1, min: 1, max: 100, step: 1, decimals: 0, width: 60 });
    this.uniformOv = check('Override uniform timing', { onchange: () => { this.uniform.disabled = !this.uniformOv.box.checked; } });
    this.uniform = select(['Off', 'On'], { disabled: true });
    this.bgSimple = radio(g, 'Simple rate', true);
    this.bgTof = radio(g, 'TOF-gated', false);
    this.bgRate = num({ value: 10, min: 0, max: 1e6, step: 1, decimals: 2, width: 90 });
    this.bgCont = num({ value: 4000, min: 0, max: 1e8, step: 100, decimals: 1, width: 100 });
    this.bgGate = num({ value: 2.5, min: 0.01, max: 1000, step: 0.1, decimals: 2, width: 80 });
    this.ab = abBlock();
    this.schmidt = new Schmidt(this);
    this.isomerCheck = check('Has isomer', { onchange: (v) => { this.isomer.root.hidden = !v; } });
    this.isomer = new Isomer(this);
    this.isomer.root.hidden = true;
    this.ref = el('input', { type: 'checkbox', 'aria-label': 'Reference isotope' });
    this.ref.addEventListener('change', () => this.tab.setReference(this.ref.checked ? this : null));
    this.title = el('b');
    const up = button('', { icon: 'chevron-up', class: 'tool', tip: 'Move up', onclick: () => this.tab.move(this, -1) });
    const down = button('', { icon: 'chevron-down', class: 'tool', tip: 'Move down', onclick: () => this.tab.move(this, 1) });
    const rm = button('Remove', { icon: 'x', class: 'tool', onclick: () => this.tab.removeIsotope(this) });
    this.timing = el('div', {},
      el('div', { class: 'subgroup' }, el('div', { class: 'sg-title' }, 'Rates & Timing'),
        field('Yield', this.yield, 'ions/s'), field('Efficiency', this.eff, '', 'Spectroscopic efficiency (photons detected per ion)'),
        field('Peaks to measure', this.peaks), el('div', { class: 'row' }, this.uniformOv, this.uniform)),
      el('div', { class: 'subgroup' }, el('div', { class: 'sg-title' }, 'Background'),
        el('div', { class: 'row' }, this.bgSimple, this.bgRate, el('span', { class: 'muted' }, 'Hz')),
        el('div', { class: 'row wrap' }, this.bgTof, el('span', {}, 'Cont'), this.bgCont, el('span', { class: 'muted' }, 'Hz'), el('span', {}, 'Gate'), this.bgGate, el('span', { class: 'muted' }, 'µs'))));
    this.root = el('div', { class: 'iso-panel' },
      el('div', { class: 'iso-head' }, this.title, el('span', { class: 'spacer' }), el('label', { class: 'check', 'data-tip': 'The reference isotope whose A/B constants the others are scaled from' }, this.ref, 'Reference'), up, down, rm),
      el('div', { class: 'row' }, el('label', { class: 'lbl' }, 'A'), this.A, this.mass),
      field('Label', this.label, '', 'Used in legends, the anchor and file names'),
      field('I', this.I, 'ħ'), field('μ', this.mu, 'μ_N'), field('Q', this.Q, 'b'), field('Isotope shift', this.shift, 'MHz'),
      this.timing, this.ab.root, this.schmidt.root, this.isomerCheck, this.isomer.root);
    this.updateMass();
    this.setSpectrumOnly(tab.spectrumOnly());
  }

  updateTitle() {
    const i = this.tab.isotopes.indexOf(this);
    this.title.textContent = `Isotope ${i + 1}${this.label.value ? ': ' + this.label.value : ''}`;
  }

  async updateMass() {
    const m = await this.tab.engine.call('estimate_meta', 'mass', { Z: this.tab.g.Z.num, A: this.A.num });
    this.mass.textContent = m ? `${m.toFixed(6)} amu` : '(not in table)';
  }

  setSpectrumOnly(on) { this.timing.hidden = on; this.isomer.setSpectrumOnly(on); }

  setReference(on) {
    this.ref.checked = on;
    this.root.classList.toggle('is-ref', on);
    if (on) { this.ab.check.box.checked = true; this.ab.update(); }
    this.ab.check.box.disabled = on;
  }

  toDict() {
    const d = { A: this.A.num, label: this.label.value, I: this.I.num, mu: this.mu.num, Q: this.Q.num, isotope_shift_MHz: this.shift.num };
    if (!this.tab.spectrumOnly()) {
      d.yield_ions_per_sec = this.yield.num;
      d.spectroscopic_efficiency = this.eff.num;
      d.peaks_to_measure = this.peaks.num;
      if (this.uniformOv.box.checked) d.uniform_timing = this.uniform.value === 'On';
      if (this.bgSimple.box.checked) d.background_rate_Hz = this.bgRate.num;
      else d.background = { continuous_rate_Hz: this.bgCont.num, tof_gate_us: this.bgGate.num };
    }
    this.ab.write(d);
    const sv = this.schmidt.toDict();
    if (sv) d.schmidt_valence = sv;
    if (this.isomerCheck.box.checked) d.isomer = this.isomer.toDict();
    return d;
  }

  fromDict(d) {
    this.A.num = +(d.A ?? 1); this.label.value = String(d.label ?? '');
    this.I.num = +(d.I ?? 0); this.mu.num = +(d.mu ?? 0); this.Q.num = +(d.Q ?? 0); this.shift.num = +(d.isotope_shift_MHz ?? 0);
    if (d.yield_ions_per_sec != null) this.yield.num = d.yield_ions_per_sec;
    if (d.spectroscopic_efficiency != null) this.eff.num = d.spectroscopic_efficiency;
    if (d.peaks_to_measure != null) this.peaks.num = d.peaks_to_measure;
    if (d.uniform_timing != null) { this.uniformOv.box.checked = true; this.uniform.disabled = false; this.uniform.value = d.uniform_timing ? 'On' : 'Off'; }
    if (d.background != null) { this.bgTof.box.checked = true; this.bgCont.num = +(d.background.continuous_rate_Hz ?? 0); this.bgGate.num = +(d.background.tof_gate_us ?? 0); }
    else if (d.background_rate_Hz != null) { this.bgSimple.box.checked = true; this.bgRate.num = d.background_rate_Hz; }
    this.ab.read(d, (k) => d[k] != null);
    this.schmidt.fromDict(d.schmidt_valence);
    if (this.schmidt.toDict() && this.mu.num === 0) this.schmidt.emit();
    const hasIso = d.isomer != null;
    this.isomerCheck.box.checked = hasIso;
    this.isomer.root.hidden = !hasIso;
    if (hasIso) this.isomer.fromDict(d.isomer);
    this.updateMass();
    this.updateTitle();
  }
}

/* ══════════════════════════════════════════════════════════════════ */
export class EstimateTab {
  constructor(root, { engine }) {
    this.engine = engine;
    this.root = root;
    this.isotopes = [];
    this.reference = null;
    this.run = null;             // last run result
    this.passLastRun = null;     // a desktop session's last_run (kept on save)
    this.view = 'Individual Spectra';
    this.buildGlobal();
    this.buildIsotopes();
    this.buildRight();
    engine.whenReady('core').then(async () => {
      meta = await engine.call('estimate_meta', 'meta');
      this.isotopes.forEach((i) => { i.schmidt.refreshOrbitals(); i.isomer.schmidt.refreshOrbitals(); i.updateMass(); });
    });
    document.addEventListener('engine-full', () => this.updateRunButton());
    this.updateRunButton();
  }

  spectrumOnly() { return !this.g.stats.box.checked; }

  /* ── Column 1: global parameters ─────────────────────────────── */
  buildGlobal() {
    const g = this.g = {};
    g.element = el('input', { type: 'text', style: { width: '52px' }, placeholder: 'Ge' });
    g.Z = num({ value: 1, min: 1, max: 118, step: 1, decimals: 0, width: 60, onchange: (z) => {
      const s = zToElement()[z]; if (s) g.element.value = s; this.isotopes.forEach((i) => i.updateMass()); } });
    g.element.addEventListener('change', () => {
      const sym = g.element.value.trim();
      const key = Object.keys(meta.element_z).find((s) => s.toLowerCase() === sym.toLowerCase());
      if (key) { g.element.value = key; g.Z.num = meta.element_z[key]; this.isotopes.forEach((i) => i.updateMass()); }
    });
    const lvl = () => num({ value: 0, min: 0, max: 200000, step: 0.001, decimals: 6, width: 130 });
    g.lower = lvl(); g.upper = lvl();
    g.Jl = num({ value: 0, min: 0, max: 20, step: 0.5, decimals: 1, width: 60 });
    g.Ju = num({ value: 0, min: 0, max: 20, step: 0.5, decimals: 1, width: 60 });
    g.kV = num({ value: 30, min: 0.001, max: 200, step: 0.001, decimals: 3, width: 90 });
    g.charge = num({ value: 1, min: 1, max: 10, step: 1, decimals: 0, width: 60 });
    g.geometry = select(['anti-collinear', 'collinear']);
    g.harmonic = num({ value: 1, min: 1, max: 10, step: 1, decimals: 0, width: 60 });
    const mg = `laser${++radioGroup}`;
    g.modeSet = radio(mg, 'Setpoint', true, () => this.updateLaserMode());
    g.modeAnchor = radio(mg, 'Anchor', false, () => this.updateLaserMode());
    g.setpoint = num({ value: 0, min: 0, max: 200000, step: 0.001, decimals: 6, width: 130 });
    g.anchorIso = el('input', { type: 'text', placeholder: 'e.g. 77Ge', style: { width: '90px' } });
    g.anchorDV = num({ value: 0, min: -1e4, max: 1e4, step: 1, decimals: 2, width: 80 });
    g.anchorState = select(['gs', 'isomer']);
    g.setRow = field('Setpoint', g.setpoint, 'cm⁻¹', 'Fundamental laser wavenumber');
    g.anchorRows = el('div', {}, field('Anchor isotope', g.anchorIso), field('Anchor dV', g.anchorDV, 'V'), field('Anchor state', g.anchorState));
    g.fwhm = num({ value: 100, min: 0.1, max: 10000, step: 1, decimals: 1, width: 90 });
    g.range = num({ value: 100, min: 0.1, max: 1e5, step: 1, decimals: 1, width: 90 });
    g.step = num({ value: 1.0, min: 0.001, max: 1000, step: 0.1, decimals: 3, width: 90 });
    g.dwell = num({ value: 200, min: 0.1, max: 1e6, step: 10, decimals: 1, width: 90 });
    g.stats = el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: true }), 'Statistics (Timing Mode)');
    g.stats.box = g.stats.firstChild;
    g.stats.box.addEventListener('change', () => this.updateMode());
    g.sigma = num({ value: 3.0, min: 0.1, max: 20, step: 0.1, decimals: 1, width: 70 });
    g.uniform = check('Uniform timing (global)', { tip: 'Every peak gets the time of the full yield (not per peak intensity)' });
    g.gs = num({ value: 1.0, min: 0, max: 1, step: 0.05, decimals: 2, width: 70 });
    g.statsBody = el('div', {}, field('Required σ', g.sigma, 'σ'), g.uniform);

    this.col1 = el('div', { class: 'est-col', style: { width: '330px', flex: 'none' } },
      el('fieldset', { class: 'group' }, el('legend', {}, 'Element & Transition'),
        el('div', { class: 'row' }, el('label', { class: 'lbl' }, 'Element'), g.element, el('label', {}, 'Z'), g.Z),
        field('Lower level', g.lower, 'cm⁻¹'), field('Upper level', g.upper, 'cm⁻¹'),
        el('div', { class: 'row' }, el('label', { class: 'lbl' }, 'J_lower'), g.Jl, el('label', {}, 'J_upper'), g.Ju)),
      el('fieldset', { class: 'group' }, el('legend', {}, 'Beam'),
        field('Voltage', g.kV, 'kV'), field('Charge state', g.charge, 'e'), field('Geometry', g.geometry)),
      el('fieldset', { class: 'group' }, el('legend', {}, 'Laser'),
        field('Harmonic', g.harmonic), el('div', { class: 'row' }, el('label', { class: 'lbl' }, 'Mode'), g.modeSet, g.modeAnchor), g.setRow, g.anchorRows),
      el('fieldset', { class: 'group' }, el('legend', {}, 'Linewidth'), field('FWHM', g.fwhm, 'MHz')),
      el('fieldset', { class: 'group' }, el('legend', {}, 'Scan'),
        field('Voltage range', g.range, 'V'), field('Step size', g.step, 'V'), field('Dwell time', g.dwell, 'ms')),
      el('fieldset', { class: 'group' }, el('legend', {}, g.stats), g.statsBody),
      el('fieldset', { class: 'group' }, el('legend', {}, 'Advanced'), field('g_s factor', g.gs, '', 'Spin g-factor quenching used for Schmidt moments')));
    this.updateLaserMode();
  }

  updateLaserMode() {
    const anchor = this.g.modeAnchor.box.checked;
    this.g.setRow.hidden = anchor;
    this.g.anchorRows.hidden = !anchor;
  }

  updateMode() {
    const so = this.spectrumOnly();
    this.g.statsBody.hidden = so;
    this.g.step.disabled = so;
    this.g.dwell.disabled = so;
    this.isotopes.forEach((i) => i.setSpectrumOnly(so));
  }

  /* ── Column 2: isotopes ───────────────────────────────────────── */
  buildIsotopes() {
    this.isoList = el('div');
    this.isoCount = el('span', { class: 'muted' });
    this.col2 = el('div', { class: 'est-col', style: { width: '370px', flex: 'none' } },
      el('div', { class: 'row' }, button('Add Isotope', { icon: 'plus', onclick: () => this.addIsotope() }), this.isoCount),
      this.isoList);
  }

  addIsotope(d) {
    const iso = new Isotope(this);
    this.isotopes.push(iso);
    this.isoList.append(iso.root);
    if (d) iso.fromDict(d);
    this.refreshRefs();
    return iso;
  }

  removeIsotope(iso) {
    iso.root.remove();
    this.isotopes = this.isotopes.filter((x) => x !== iso);
    if (this.reference === iso) this.reference = null;
    this.refreshRefs();
  }

  move(iso, delta) {
    const i = this.isotopes.indexOf(iso), j = i + delta;
    if (j < 0 || j >= this.isotopes.length) return;
    [this.isotopes[i], this.isotopes[j]] = [this.isotopes[j], this.isotopes[i]];
    this.isoList.replaceChildren(...this.isotopes.map((x) => x.root));
    this.refreshRefs();
  }

  setReference(iso) {
    this.reference = iso;
    this.isotopes.forEach((x) => x.setReference(x === iso));
  }

  refreshRefs() {
    const n = this.isotopes.length;
    this.isoCount.textContent = `${n} isotope${n !== 1 ? 's' : ''}`;
    this.isotopes.forEach((x) => x.updateTitle());
  }

  /* ── Column 3: run options, plots, log ────────────────────────── */
  buildRight() {
    this.palette = select(Object.keys(PALETTES), { value: 'default', onchange: () => this.draw() });
    this.makePlots = check('Generate plots (PDF)', { checked: true, tip: 'Also write the hfs_spectra and overview PDFs (like the desktop)' });
    this.runBtn = button('Run Estimation', { icon: 'play', class: 'primary', onclick: () => this.runEstimation() });
    const loadBtn = button('Load Estimation…', { icon: 'file-up', onclick: () => this.loadEstimation() });
    this.dlBtn = button('Download Results', { icon: 'file-down', disabled: true, tip: 'The run folder (log, PDFs, estimate_results.npz, peaks.csv) as a zip', onclick: () => this.downloadResults() });
    const runOptions = el('fieldset', { class: 'group run-options' }, el('legend', {}, 'Run Options'),
      el('div', { class: 'row wrap' }, el('label', {}, 'Color palette'), this.palette, this.makePlots),
      el('div', { class: 'row wrap' }, this.runBtn, loadBtn, this.dlBtn),
      el('div', { class: 'muted small' }, 'Results stay in this browser tab; download them to keep them.'));

    this.viewSel = select(['Individual Spectra', 'Combined Overview', 'Peak List'], { onchange: (v) => { this.view = v; this.draw(); } });
    this.pdfBtn = button('Open PDF', { icon: 'file-down', disabled: true, onclick: () => this.openPdf() });
    this.savePlotBtn = button('Save Plot…', { icon: 'save', disabled: true, onclick: () => this.savePlot() });
    this.dark = loadDark();
    this.darkBtn = el('button', { type: 'button', class: 'tool', 'aria-pressed': String(this.dark), 'data-tip': 'Dark plots' }, icon('sun-moon'));
    this.darkBtn.addEventListener('click', () => this.setDark(!this.dark));
    const expand = el('button', { type: 'button', class: 'tool', 'aria-pressed': 'false', 'data-tip': 'Expand the plots' }, '⛶');
    expand.addEventListener('click', () => { const on = expand.getAttribute('aria-pressed') !== 'true'; expand.setAttribute('aria-pressed', String(on)); this.col3.classList.toggle('expanded', on); this.col1.hidden = on; this.col2.hidden = on; window.dispatchEvent(new Event('resize')); });
    this.plotArea = el('div', { class: 'est-plots scroll' });
    this.log = el('pre', { class: 'log', 'aria-label': 'Log' });
    const clear = button('Clear', { class: 'tool', onclick: () => { this.log.textContent = ''; } });
    this.col3 = el('div', { class: 'est-right col', style: { flex: 1 } }, runOptions,
      el('div', { class: 'view-bar' }, el('label', {}, 'View'), this.viewSel, this.pdfBtn, this.savePlotBtn, el('span', { class: 'spacer' }), this.darkBtn, expand),
      this.plotArea,
      el('div', { class: 'log-wrap' }, el('div', { class: 'row' }, el('b', {}, 'Log'), el('span', { class: 'spacer' }), clear), this.log));
    const s1 = el('div', { class: 'splitter' }), s2 = el('div', { class: 'splitter' });
    makeSplitter(s1, this.col1, { min: 260, max: 600 });
    makeSplitter(s2, this.col2, { min: 300, max: 700 });
    this.root.append(this.col1, s1, this.col2, s2, this.col3);
    this.plotArea.classList.toggle('dark', this.dark);
    this.mnav = mobileNav(this.root, [['params', 'Parameters', this.col1], ['isotopes', 'Isotopes', this.col2], ['results', 'Results', this.col3]]);
    this.draw();
  }

  setDark(v) {
    this.dark = !!v;
    saveDark(this.dark);
    this.darkBtn.setAttribute('aria-pressed', String(this.dark));
    this.plotArea.classList.toggle('dark', this.dark);
    this.draw();
  }

  updateRunButton() {
    const ready = this.engine.isReady('full');
    this.runBtn.disabled = !ready;
    this.runBtn.lastChild.textContent = ready ? 'Run Estimation' : 'Run Estimation (engine loading…)';
  }

  /* ── Serialisation (session 'estimate' section, desktop format) ── */
  toDict() {
    const g = this.g;
    const d = {
      element: g.element.value.trim(), Z: g.Z.num,
      transition: { lower_level_cm: g.lower.num, upper_level_cm: g.upper.num, J_lower: g.Jl.num, J_upper: g.Ju.num },
      beam: { voltage_kV: g.kV.num, charge_state: g.charge.num, geometry: g.geometry.value },
      linewidth: { fwhm_MHz: g.fwhm.num },
      scan: { voltage_range_V: g.range.num },
    };
    const laser = { harmonic: g.harmonic.num };
    if (g.modeSet.box.checked) laser.setpoint_cm = g.setpoint.num;
    else laser.anchor = { isotope: g.anchorIso.value.trim(), dV: g.anchorDV.num, state: g.anchorState.value };
    d.laser = laser;
    if (!this.spectrumOnly()) {
      d.scan.step_size_V = g.step.num;
      d.scan.dwell_time_ms = g.dwell.num;
      d.statistics = { required_sigma: g.sigma.num };
      if (g.uniform.box.checked) d.statistics.uniform_timing = true;
    }
    if (g.gs.num !== 1.0) d.g_s_factor = g.gs.num;
    d.isotopes = this.isotopes.map((i) => i.toDict());
    const ref = this.reference;
    if (ref) {
      d.reference = { A: ref.A.num, I: ref.I.num, mu: ref.mu.num, Q: ref.Q.num,
        A_lower_MHz: ref.ab.Al.num, B_lower_MHz: ref.ab.Bl.num, A_upper_MHz: ref.ab.Au.num, B_upper_MHz: ref.ab.Bu.num };
    }
    if (this.passLastRun && !this.run) d.last_run = this.passLastRun;
    return d;
  }

  fromDict(d) {
    const g = this.g;
    g.element.value = String(d.element ?? ''); g.Z.num = +(d.Z ?? 1);
    const t = d.transition || {};
    g.lower.num = +(t.lower_level_cm ?? 0); g.upper.num = +(t.upper_level_cm ?? 0); g.Jl.num = +(t.J_lower ?? 0); g.Ju.num = +(t.J_upper ?? 0);
    const b = d.beam || {};
    g.kV.num = +(b.voltage_kV ?? 30); g.charge.num = +(b.charge_state ?? 1); g.geometry.value = b.geometry === 'collinear' ? 'collinear' : 'anti-collinear';
    const la = d.laser || {};
    g.harmonic.num = +(la.harmonic ?? 1);
    if (la.anchor) { g.modeAnchor.box.checked = true; g.anchorIso.value = String(la.anchor.isotope ?? ''); g.anchorDV.num = +(la.anchor.dV ?? 0); g.anchorState.value = la.anchor.state === 'isomer' ? 'isomer' : 'gs'; }
    else { g.modeSet.box.checked = true; g.setpoint.num = +(la.setpoint_cm ?? 0); }
    this.updateLaserMode();
    g.fwhm.num = +((d.linewidth || {}).fwhm_MHz ?? 100);
    const sc = d.scan || {};
    g.range.num = +(sc.voltage_range_V ?? 100); g.step.num = +(sc.step_size_V ?? 1.0); g.dwell.num = +(sc.dwell_time_ms ?? 200);
    g.stats.box.checked = d.statistics != null;
    if (d.statistics) { g.sigma.num = +(d.statistics.required_sigma ?? 3); g.uniform.box.checked = !!d.statistics.uniform_timing; }
    g.gs.num = +(d.g_s_factor ?? 1.0);
    this.isotopes.forEach((i) => i.root.remove());
    this.isotopes = [];
    this.reference = null;
    (d.isotopes || []).forEach((iso) => this.addIsotope(iso));
    const ref = d.reference;
    if (ref && ref.A != null) {
      const p = this.isotopes.find((i) => i.A.num === +ref.A);
      if (p) {
        this.setReference(p);
        p.ab.Al.num = +(ref.A_lower_MHz ?? 0); p.ab.Bl.num = +(ref.B_lower_MHz ?? 0); p.ab.Au.num = +(ref.A_upper_MHz ?? 0); p.ab.Bu.num = +(ref.B_upper_MHz ?? 0);
      } else {
        message('Reference Not Found', `The reference isotope (A=${ref.A}) was not found in the isotopes list.\nPlease add it or mark another isotope as the reference.`);
      }
    }
    this.updateMode();
    this.passLastRun = d.last_run || null;
    this.isotopes.forEach((i) => i.updateMass());
  }

  reset() {
    this.fromDict({});
    this.g.stats.box.checked = true;
    this.updateMode();
    this.run = null;
    this.passLastRun = null;
    this.log.textContent = '';
    this.dlBtn.disabled = true;
    this.draw();
  }

  hasRun() { return !!this.run; }

  /* ── Running ──────────────────────────────────────────────────── */
  validate() {
    const g = this.g;
    if (!g.element.value.trim()) return 'Please enter an element symbol.';
    if (!this.isotopes.length) return 'Please add at least one isotope.';
    if (!this.reference) return 'Please mark one isotope as the reference.';
    if (g.modeAnchor.box.checked && !this.isotopes.some((i) => i.label.value.trim() === g.anchorIso.value.trim()))
      return `The anchor isotope "${g.anchorIso.value}" must match the label of one of the isotopes.`;
    return null;
  }

  async runEstimation() {
    const problem = this.validate();
    if (problem) {
      if (isNarrow()) this.mnav.show(/isotope/.test(problem) ? 'isotopes' : 'params');
      await message('Run Estimation', problem, 'warning');
      return;
    }
    const cfg = this.toDict();
    delete cfg.last_run;
    this.runBtn.disabled = true;
    status('Running estimation…', true);
    const t0 = performance.now();
    try {
      const r = await this.engine.call('estimate', 'run', { cfg, palette: this.palette.value, make_plots: this.makePlots.box.checked });
      if (r.error) {
        this.showLog(r.log || '', r.error);
        await message('Estimation error', r.error, 'error');
        status('Estimation failed');
        return;
      }
      this.setRun(r);
      status(`Estimation complete (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (err) {
      await message('Estimation error', err.message, 'error');
      status('Estimation failed');
    } finally {
      this.updateRunButton();
    }
  }

  setRun(r) {
    this.run = r;
    this.passLastRun = null;
    this.showLog(r.log);
    this.dlBtn.disabled = false;
    if (isNarrow()) this.mnav.show('results');
    this.draw();
  }

  showLog(text, error) {
    const frag = document.createDocumentFragment();
    for (const line of (text || '').split('\n')) {
      const cls = /GRAND TOTAL|^Subtotal/.test(line.trim()) ? 'tot' : /^(=+|──|[A-Z][A-Z ]{6,}$)/.test(line.trim()) ? 'hdr' : /error|Error|WARNING/.test(line) ? 'err' : null;
      frag.append(cls ? el('span', { class: cls }, line) : line, '\n');
    }
    if (error) frag.append(el('span', { class: 'err' }, error), '\n');
    this.log.replaceChildren(frag);
  }

  /* ── Drawing (plotting.py plot_all_cases / plot_combined_overview) ── */
  draw() {
    const r = this.run;
    const pal = PALETTES[this.palette.value] || PALETTES.default;
    const color = (i) => pal[i % pal.length];
    const lw = this.dark ? 1.6 : 1;                     // thin DENIS lines are hard to see on black
    this.pdfBtn.disabled = !r || this.view === 'Peak List' || !(r.files || []).some((f) => f.endsWith('.pdf'));
    this.savePlotBtn.disabled = !r || this.view === 'Peak List' || !this.engine.isReady('full');
    this.plotArea.replaceChildren();
    if (!r) {
      this.plotArea.append(el('div', { class: 'est-empty' },
        'Fill in the parameters and press Run Estimation, or Load Estimation… to view an earlier run.'));
      return;
    }
    const mkPlot = (height) => {
      const d = el('div', { class: 'plot', style: { height: height + 'px', flex: 'none' } });
      this.plotArea.append(d);
      return new Plot(d);
    };
    const vl = (dvs, c, alpha) => (dvs || []).map((x) => ({ x, color: c, alpha, width: 0.7 }));
    if (this.view === 'Individual Spectra') {
      let ci = 0;
      const n = r.plot_results.reduce((a, res) => a + 1 + (res.isomer_label && res.plot_with_gs === false ? 1 : 0), 0);
      const h = isNarrow() ? 280 : Math.max(230, Math.min(340, (this.plotArea.clientHeight || 600) / Math.min(n, 2)));
      for (const res of r.plot_results) {
        const series = [{ kind: 'line', x: res.dV_array, y: res.intensity_array, color: color(ci), width: lw, name: res.label }];
        let vlines = vl(res.measured_peak_dVs, color(ci), 0.45);
        if (res.isomer_label && res.plot_with_gs !== false) {
          series.push({ kind: 'line', x: res.isomer_dV, y: res.isomer_intensity, color: color(ci + 1), alpha: 0.5, width: lw, name: res.isomer_label });
          vlines = vlines.concat(vl(res.isomer_measured_dVs, color(ci + 1), 0.45 * 0.5));
        }
        mkPlot(h).update({ series, vlines, xlabel: XLABEL, ylabel: 'Normalised intensity', dark: this.dark });
        if (res.isomer_label && res.plot_with_gs === false) {
          mkPlot(h).update({ series: [{ kind: 'line', x: res.isomer_dV, y: res.isomer_intensity, color: color(ci + 1), width: lw, name: res.isomer_label }],
            vlines: vl(res.isomer_measured_dVs, color(ci + 1), 0.45), xlabel: XLABEL, ylabel: 'Normalised intensity', dark: this.dark });
        }
        ci += 2;
      }
    } else if (this.view === 'Combined Overview') {
      const series = [], vlines = [];
      let ci = 0;
      for (const res of r.plot_results) {
        series.push({ kind: 'line', x: res.dV_array, y: res.intensity_array, color: color(ci), width: lw, name: res.label });
        vlines.push(...vl(res.measured_peak_dVs, color(ci), 0.35));
        if (res.isomer_label) {
          series.push({ kind: 'line', x: res.isomer_dV, y: res.isomer_intensity, color: color(ci + 1), alpha: 0.5, width: lw, name: res.isomer_label });
          vlines.push(...vl(res.isomer_measured_dVs, color(ci + 1), 0.25));
        }
        ci += 2;
      }
      const d = el('div', { class: 'plot', style: { flex: 1, minHeight: '320px' } });
      this.plotArea.append(d);
      new Plot(d).update({ series, vlines, xlabel: XLABEL, ylabel: 'Normalised intensity', dark: this.dark });
    } else {
      this.plotArea.append(this.peakTable(r.peaks));
    }
  }

  peakTable(peaks) {
    const cols = [
      ['Isotope', (p) => p.label, (p) => p.label, 'l'], ['State', (p) => p.state || '-', (p) => p.state || '', 'l'],
      ['Shift (MHz)', (p) => signed(p.iso_shift_MHz, 3), (p) => p.iso_shift_MHz], ['Offset (MHz)', (p) => signed(p.offset_MHz, 1), (p) => p.offset_MHz],
      ['dV (V)', (p) => signed(p.dV, 3), (p) => p.dV ?? -Infinity], ['V_acc (V)', (p) => fmt(p.V_acc, 3), (p) => p.V_acc ?? -Infinity],
      ['Intensity', (p) => fmt(p.intensity, 4), (p) => p.intensity]];
    let sortCol = -1, asc = true;
    const tbody = el('tbody');
    const render = () => {
      const rows = [...peaks];
      if (sortCol >= 0) rows.sort((a, b) => { const x = cols[sortCol][2](a), y = cols[sortCol][2](b); return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
      tbody.replaceChildren(...rows.map((p) => el('tr', {}, ...cols.map((c) => el('td', { class: c[3] || '' }, c[1](p))))));
    };
    const head = el('tr', {}, ...cols.map((c, i) => {
      const th = el('th', { class: c[3] || '', title: 'Sort' }, c[0]);
      th.addEventListener('click', () => { asc = sortCol === i ? !asc : true; sortCol = i; render(); });
      return th;
    }));
    render();
    return el('div', { class: 'peak-table-wrap' }, el('table', { class: 'data' }, el('thead', {}, head), tbody));
  }

  /* ── Files ────────────────────────────────────────────────────── */
  async loadEstimation() {
    const go = await dialog({ title: 'Load Estimation', width: 480, body: el('div', {},
      el('p', {}, 'Pick a Mini DENIS results zip, or the files of a desktop DENIS run folder (cls_<timestamp>: at least estimate_results.npz, plus the .log and PDFs if you want them).'),
      el('p', { class: 'muted small' }, 'This restores the plots, peak list and log without re-running. The parameters on the left are not changed.')),
    buttons: [{ label: 'Choose files…', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!go) return;
    const files = await pickFiles({ accept: '.zip,.npz,.log,.pdf,.csv,.yaml', multiple: true });
    if (!files.length) return;
    await this.engine.whenReady('full');
    const stamp = Date.now();
    const paths = [];
    for (const f of files) {
      const p = `/home/pyodide/upload/est_${stamp}/${f.name}`;
      await this.engine.write(p, new Uint8Array(await f.arrayBuffer()));
      paths.push(p);
    }
    const r = await this.engine.call('estimate', 'load_run', { paths });
    if (r.error) { await message('Load Estimation', r.error, 'error'); return; }
    this.setRun(r);
    status(`Loaded ${r.run_name}`);
  }

  async downloadResults() {
    if (!this.run) return;
    const bytes = await this.engine.call('estimate', 'zip_run', { run_name: this.run.run_name });
    await saveFile(bytes, `${this.run.run_name}${this.run.file_tag || ''}.zip`, { type: 'application/zip' });
  }

  async openPdf() {
    const kind = this.view === 'Combined Overview' ? '_overview' : '_hfs_spectra';
    const name = (this.run.files || []).find((f) => f.includes(kind) && f.endsWith('.pdf'));
    if (!name) { await message('Open PDF', 'This run has no PDF (turn on "Generate plots" and run again).'); return; }
    const bytes = await this.engine.call('estimate', 'read_file', { run_name: this.run.run_name, name });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async savePlot() {
    const fmtSel = select(['png', 'pdf', 'svg'], { value: 'png' });
    const dpi = num({ value: 300, min: 72, max: 1200, step: 50, decimals: 0, width: 80 });
    const ok = await dialog({ title: 'Save Plot', width: 340, body: el('div', { class: 'grid2' },
      el('label', {}, 'Format'), fmtSel, el('label', {}, 'DPI'), dpi,
      el('span'), el('span', { class: 'muted small' }, 'Drawn by DENIS’s own plotting code (same figure as the PDF).')),
    buttons: [{ label: 'Save', value: true, primary: true }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    const view = this.view === 'Combined Overview' ? 'overview' : 'spectra';
    status('Rendering plot…', true);
    const bytes = await this.engine.call('estimate', 'export_view', { run_name: this.run.run_name, view, fmt: fmtSel.value, dpi: dpi.num, palette: this.palette.value });
    const type = { png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml' }[fmtSel.value];
    await saveFile(bytes, `${this.run.run_name}_${view === 'overview' ? 'overview' : 'hfs_spectra'}${this.run.file_tag || ''}.${fmtSel.value}`, { type });
    status('Plot saved');
  }
}
