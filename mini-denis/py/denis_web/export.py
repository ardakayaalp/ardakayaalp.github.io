"""Plot export for Mini DENIS: redraws what the interface shows with matplotlib, in DENIS style.

The interface draws interactive plots in the browser; "Save plot..." sends the same data
here and gets a PNG / SVG / PDF back, styled with the desktop app's matplotlib settings
(``gui/shared_widgets.py``: _DEFAULT_PLOT_SETTINGS + _STATIC_PLOT_STYLE) and, for dark
plots, the Pre-Analysis dark theme (``_apply_plot_theme``).
"""
import io

import numpy as np

# gui/shared_widgets.py
DEFAULT_PLOT_SETTINGS = {
    "lines.linewidth": 2.5, "lines.markersize": 6.0, "font.size": 13, "axes.labelsize": 14,
    "axes.titlesize": 15, "axes.linewidth": 1.2, "xtick.labelsize": 12, "ytick.labelsize": 12,
    "xtick.major.size": 6.0, "ytick.major.size": 6.0, "xtick.minor.size": 3.5, "ytick.minor.size": 3.5,
    "xtick.major.width": 1.1, "ytick.major.width": 1.1, "xtick.minor.width": 0.9,
    "ytick.minor.width": 0.9, "xtick.minor.visible": True, "ytick.minor.visible": True,
    "legend.fontsize": 11, "figure.dpi": 100, "savefig.dpi": 200, "errorbar.capsize": 3.0,
}
STATIC_PLOT_STYLE = {
    "font.family": "serif",
    "font.serif": ["CMU Serif", "Latin Modern Roman", "DejaVu Serif", "Times New Roman", "Times"],
    "mathtext.fontset": "cm", "axes.unicode_minus": False, "xtick.direction": "in",
    "ytick.direction": "in", "xtick.top": True, "ytick.right": True, "legend.frameon": True,
    "legend.framealpha": 1.0, "legend.edgecolor": "black", "legend.fancybox": False,
}
LINESTYLES = {"Solid": "-", "Dashed": "--", "Dotted": ":", "Dash-dot": "-.", None: "-"}


def _style(ax, fig, dark, grid):
    fg = "white" if dark else "black"
    fig.set_facecolor("#0d0d0d" if dark else "white")
    ax.set_facecolor("black" if dark else "white")
    for spine in ax.spines.values():
        spine.set_color(fg)
    ax.tick_params(colors=fg, which="both")
    ax.xaxis.label.set_color(fg)
    ax.yaxis.label.set_color(fg)
    ax.title.set_color(fg)
    grid_c = "#3a3a3a" if dark else "#b0b0b0"
    if grid.get("x"):
        ax.grid(True, axis="x", color=grid_c, linewidth=0.6)
    if grid.get("y"):
        ax.grid(True, axis="y", color=grid_c, linewidth=0.6)


def figure(spec, fmt="png", dpi=300):
    """Render ``spec`` and return the file bytes.

    spec = {size: [w_in, h_in], dark: bool, panels: [{title, xlabel, ylabel, xlim, ylim,
            grid: {x, y}, legend: bool, series: [{kind: step|stairs|line|vline|span|label,
            x, y | edges, counts | lo, hi | text, color, alpha, linestyle, linewidth, label}]}]}
    """
    import matplotlib
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    panels = spec.get("panels", [])
    dark = bool(spec.get("dark"))
    w, h = spec.get("size") or (10, 3.2 * max(1, len(panels)))
    with matplotlib.rc_context({**DEFAULT_PLOT_SETTINGS, **STATIC_PLOT_STYLE}):
        fig = Figure(figsize=(w, h))
        FigureCanvasAgg(fig)
        axes = fig.subplots(len(panels), 1, squeeze=False)[:, 0] if panels else []
        for ax, p in zip(axes, panels):
            _style(ax, fig, dark, p.get("grid") or {})
            for s in p.get("series", []):
                kind = s.get("kind", "line")
                kw = dict(color=s.get("color"), alpha=float(s.get("alpha", 1.0)),
                          linestyle=LINESTYLES.get(s.get("linestyle"), s.get("linestyle") or "-"),
                          linewidth=float(s.get("linewidth", 1.5)))
                if s.get("label"):
                    kw["label"] = s["label"]
                if kind == "step":
                    ax.step(np.asarray(s["x"], float), np.asarray(s["y"], float), where="mid", **kw)
                elif kind == "stairs":
                    ax.stairs(np.asarray(s["counts"], float), np.asarray(s["edges"], float), **kw)
                elif kind == "vline":
                    ax.axvline(float(s["x"]), **kw)
                elif kind == "points":
                    ax.plot(np.asarray(s["x"], float), np.asarray(s["y"], float), marker=".", linestyle="None",
                            color=s.get("color"), markersize=3.5, alpha=float(s.get("alpha", 0.65)))
                elif kind == "hline":
                    ax.axhline(float(s["y"]), **kw)
                elif kind == "hspan":
                    ax.axhspan(float(s["lo"]), float(s["hi"]), color=s.get("color"),
                               alpha=float(s.get("alpha", 0.1)), linewidth=0)
                elif kind == "span":
                    ax.axvspan(float(s["lo"]), float(s["hi"]), color=s.get("color"),
                               alpha=float(s.get("alpha", 0.25)), linewidth=0)
                elif kind == "label":
                    ax.annotate(s["text"], xy=(float(s["x"]), float(s["y"])), xytext=(0, 10),
                                textcoords="offset points", ha="center", va="bottom", fontsize=7,
                                color=s.get("color"), rotation=45,
                                arrowprops=dict(arrowstyle="-", color=s.get("color"), lw=0.5))
                else:
                    ax.plot(np.asarray(s["x"], float), np.asarray(s["y"], float), **kw)
            if p.get("title"):
                ax.set_title(p["title"])
            ax.set_xlabel(p.get("xlabel", ""))
            ax.set_ylabel(p.get("ylabel", ""))
            if p.get("xlim"):
                ax.set_xlim(*p["xlim"])
            if p.get("ylim"):
                ax.set_ylim(*p["ylim"])
            if p.get("legend") and ax.get_legend_handles_labels()[0]:
                leg = ax.legend(fontsize=9)
                if dark:
                    leg.get_frame().set_facecolor("black")
                    leg.get_frame().set_edgecolor("white")
                    for t in leg.get_texts():
                        t.set_color("white")
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format=fmt, dpi=dpi, facecolor=fig.get_facecolor())
    return buf.getvalue()
