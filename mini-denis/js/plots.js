/* Interactive plots (Plotly) styled like DENIS's matplotlib figures. */
const DASH = { Solid: 'solid', Dashed: 'dash', Dotted: 'dot', 'Dash-dot': 'dashdot' };
const SERIF = '"CMU Serif", "Latin Modern Roman", "Times New Roman", Times, serif';

function axis(title, dark, grid) {
  const fg = dark ? '#ffffff' : '#000000';
  return {
    title: { text: title || '', font: { size: 14, color: fg, family: SERIF }, standoff: 6 },
    showline: true, mirror: 'ticks', linecolor: fg, linewidth: 1.2,
    ticks: 'inside', ticklen: 6, tickwidth: 1.1, tickcolor: fg,
    minor: { ticks: 'inside', ticklen: 3.5, tickwidth: 0.9, tickcolor: fg, showgrid: false },
    tickfont: { size: 12, color: fg, family: SERIF },
    showgrid: !!grid, gridcolor: dark ? '#3a3a3a' : '#b0b0b0', gridwidth: 0.6,
    zeroline: false, automargin: true, exponentformat: 'none', separatethousands: false,
  };
}

/** Plotly's LaTeX-free label: "Wavenumber (cm$^{-1}$)" -> "Wavenumber (cm⁻¹)". */
export const plainLabel = (s) => (s || '').replace('cm$^{-1}$', 'cm⁻¹');

// Phones: a one-finger swipe over a plot scrolls the page; the magnifier button turns zooming on.
const isPhone = () => window.matchMedia('(max-width: 900px) and (hover: none)').matches;

export class Plot {
  constructor(container, { height, onGate, legend = true } = {}) {
    this.el = container;
    this.onGate = onGate;
    this.legend = legend;
    this.model = null;
    this.uirev = 1;
    this.el.append(this.empty = Object.assign(document.createElement('div'), { className: 'empty', textContent: '' }));
    this._ro = new ResizeObserver(() => {
      if (!this.el.isConnected) { this._ro.disconnect(); return; }       // plot was removed
      if (this.drawn && this.el.offsetParent) Plotly.Plots.resize(this.el).catch(() => {});
    });
    this._ro.observe(this.el);
    this.zoomOn = false;
    if (isPhone()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'plot-zoom';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', 'Zoom this plot (tap again to reset)');
      b.innerHTML = '<img src="img/lucide/zoom-in.svg" alt="">';
      b.addEventListener('click', () => {
        this.zoomOn = !this.zoomOn;
        b.setAttribute('aria-pressed', String(this.zoomOn));
        if (!this.zoomOn) this.uirev++;                     // leaving zoom mode resets the view
        if (this.model) this.update(this.model);
      });
      this.el.append(b);
    }
  }

  resetZoom() { this.uirev++; if (this.model) this.update(this.model); }

  setEmpty(text) { this.empty.textContent = text || ''; this.empty.hidden = !text; }

  update(model) {
    this.model = model;
    const dark = !!model.dark;
    const traces = [];
    for (const s of model.series || []) {
      const common = {
        name: s.name || '', showlegend: !!s.name && this.legend, opacity: s.alpha ?? 1,
        line: { color: s.color, width: s.width ?? 1.5, dash: DASH[s.linestyle] || 'solid' },
        hovertemplate: '%{x:.6g}, %{y:.6g}<extra>' + (s.name || '') + '</extra>',
      };
      if (s.kind === 'stairs') {
        const e = s.edges, c = s.counts;
        traces.push({ ...common, type: 'scatter', mode: 'lines', x: e, y: [...c, c[c.length - 1] ?? 0],
          line: { ...common.line, shape: 'hv' } });
      } else if (s.kind === 'points') {
        traces.push({ ...common, type: 'scatter', mode: 'markers', x: s.x, y: s.y, marker: { color: s.color, size: s.size ?? 4 } });
      } else if (s.kind === 'step') {
        traces.push({ ...common, type: 'scatter', mode: 'lines', x: s.x, y: s.y, line: { ...common.line, shape: 'hvh' } });
      } else {
        traces.push({ ...common, type: 'scatter', mode: 'lines', x: s.x, y: s.y });
      }
    }
    const shapes = [];
    for (const v of model.vlines || []) {
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: v.x, x1: v.x, y0: 0, y1: 1,
        line: { color: v.color, width: v.width ?? 0.7, dash: v.dash || 'dash' }, opacity: v.alpha ?? 0.45, layer: 'below' });
    }
    for (const h of model.hlines || []) {
      shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: h.y, y1: h.y,
        line: { color: h.color, width: h.width ?? 1, dash: h.dash || 'dash' }, opacity: h.alpha ?? 0.7, layer: 'below' });
    }
    for (const h of model.hbands || []) {
      shapes.push({ type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: h.lo, y1: h.hi,
        fillcolor: h.color, opacity: h.alpha ?? 0.1, line: { width: 0 }, layer: 'below' });
    }
    for (const b of model.bands || []) {
      shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: b.lo, x1: b.hi, y0: 0, y1: 1,
        fillcolor: b.color, opacity: b.alpha ?? 0.1, line: { width: 0 }, layer: 'below' });
    }
    if (model.gate) {
      const g = model.gate;
      shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: g.lo, x1: g.hi, y0: 0, y1: 1, name: 'gate',
        fillcolor: g.color, opacity: g.alpha ?? 0.25, line: { color: g.color, width: 1.5 }, editable: g.editable !== false, layer: 'below' });
    }
    const annotations = (model.labels || []).map((l) => ({
      x: l.x, y: l.y, text: l.text, showarrow: true, arrowhead: 0, arrowwidth: 0.6, arrowcolor: l.color,
      ax: 0, ay: -22, textangle: -45, font: { size: 9, color: l.color, family: SERIF },
    }));
    for (const t of model.toplabels || []) {
      annotations.push({ x: t.x, xref: 'x', y: 1, yref: 'paper', yanchor: 'top', xanchor: 'left', showarrow: false,
        text: t.text, font: { size: 8, color: t.color || '#666' } });
    }
    if (model.note) {
      annotations.push({ xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, text: model.note,
        font: { size: 11, color: '#888' } });
    }
    const layout = {
      paper_bgcolor: dark ? '#0d0d0d' : '#ffffff', plot_bgcolor: dark ? '#000000' : '#ffffff',
      margin: { l: 58, r: 14, t: model.title ? 28 : 10, b: 44 },
      title: model.title ? { text: model.title, font: { size: 13, family: SERIF, color: dark ? '#fff' : '#000' } } : undefined,
      xaxis: { ...axis(plainLabel(model.xlabel), dark, model.grid?.x), range: model.xrange },
      yaxis: { ...axis(plainLabel(model.ylabel), dark, model.grid?.y), range: model.yrange },
      showlegend: this.legend && traces.some((t) => t.showlegend),
      legend: { x: 1, xanchor: 'right', y: 1, yanchor: 'top', bgcolor: dark ? '#000' : '#fff', bordercolor: dark ? '#fff' : '#000',
        borderwidth: 1, font: { size: 10, family: SERIF, color: dark ? '#fff' : '#000' } },
      shapes, annotations,
      uirevision: String(model.uirev ?? '') + ':' + this.uirev,
      hovermode: 'closest', dragmode: isPhone() && !this.zoomOn ? false : 'zoom',
      font: { family: SERIF },
    };
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    const config = { responsive: true, displaylogo: false, scrollZoom: !narrow, displayModeBar: narrow ? false : 'hover',
      edits: { shapePosition: !(isPhone() && !this.zoomOn) },   // phones: gates move only in zoom mode
      modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines', 'hoverClosestCartesian', 'hoverCompareCartesian'] };
    this.setEmpty(traces.length || model.note ? '' : model.emptyText || '');
    Plotly.react(this.el, traces, layout, config);
    this.drawn = true;
    if (!this._bound) {
      this._bound = true;
      this.el.on('plotly_relayout', (ev) => {
        if (!this.onGate || !this.model?.gate) return;
        const idx = (this.el.layout.shapes || []).findIndex((s) => s.name === 'gate');
        if (idx < 0) return;
        const x0 = ev[`shapes[${idx}].x0`], x1 = ev[`shapes[${idx}].x1`];
        if (x0 === undefined && x1 === undefined) return;
        const s = this.el.layout.shapes[idx];
        this.onGate(Math.min(s.x0, s.x1), Math.max(s.x0, s.x1));
      });
    }
  }

  /** Current view as a spec for denis_web.export.figure. */
  exportPanel() {
    const m = this.model || {};
    const series = [];
    for (const s of m.series || []) {
      if (s.kind === 'stairs') series.push({ kind: 'stairs', edges: s.edges, counts: s.counts, color: s.color, alpha: s.alpha, linestyle: s.linestyle, linewidth: s.width ?? 1.5, label: s.name });
      else if (s.kind === 'points') series.push({ kind: 'points', x: s.x, y: s.y, color: s.color, alpha: s.alpha });
      else series.push({ kind: s.kind === 'step' ? 'step' : 'line', x: s.x, y: s.y, color: s.color, alpha: s.alpha, linestyle: s.linestyle, linewidth: s.width ?? 1.5, label: s.name });
    }
    for (const v of m.vlines || []) series.push({ kind: 'vline', x: v.x, color: v.color, alpha: v.alpha ?? 0.45, linestyle: v.dash === 'solid' ? 'Solid' : 'Dashed', linewidth: v.width ?? 0.7 });
    for (const b of m.bands || []) series.push({ kind: 'span', lo: b.lo, hi: b.hi, color: b.color, alpha: b.alpha ?? 0.1 });
    for (const h of m.hlines || []) series.push({ kind: 'hline', y: h.y, color: h.color, alpha: h.alpha ?? 0.7, linestyle: h.dash === 'solid' ? 'Solid' : 'Dashed', linewidth: h.width ?? 1 });
    for (const h of m.hbands || []) series.push({ kind: 'hspan', lo: h.lo, hi: h.hi, color: h.color, alpha: h.alpha ?? 0.1 });
    if (m.gate) series.push({ kind: 'span', lo: m.gate.lo, hi: m.gate.hi, color: m.gate.color, alpha: m.gate.alpha ?? 0.25 });
    for (const l of m.labels || []) series.push({ kind: 'label', x: l.x, y: l.y, text: l.text, color: l.color });
    const xr = this.el.layout?.xaxis?.range;
    const yr = this.el.layout?.yaxis?.range;
    return { title: m.title, xlabel: m.xlabel, ylabel: m.ylabel, grid: m.grid, legend: this.legend, series,
      xlim: this.el.layout?.xaxis?.autorange === false || m.xrange ? xr : undefined,
      ylim: this.el.layout?.yaxis?.autorange === false || m.yrange ? yr : undefined };
  }
}
