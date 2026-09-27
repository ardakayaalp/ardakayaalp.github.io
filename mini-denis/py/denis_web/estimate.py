"""Estimate tab of Mini DENIS: runs the unmodified DENIS pipeline (``cls_estimate.run``).

The desktop app turns the Estimate widgets into a config dict, writes it to
``cls_<timestamp>.yaml`` and calls ``cls_estimate.run`` on it; afterwards the main
window writes ``estimate_results.npz`` and ``peaks.csv`` into the run folder. This
module does exactly the same in the browser's in-memory file system, so the log,
PDFs and data files are identical to a desktop run. The run folder can be
downloaded as a zip and loaded back later ("Load Estimation...").
"""
import contextlib
import io
import os
import shutil
import zipfile
from datetime import datetime

import numpy as np
import yaml

OUTPUT_ROOT = "/home/pyodide/output/estimates"


def _jsonable(value):
    """numpy -> plain Python, recursively (for postMessage/JSON)."""
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def _file_tag(cfg):
    seen = []
    for iso in cfg.get("isotopes", []):
        label = iso.get("label")
        if label not in seen:
            seen.append(label)
    return "_" + "_".join(str(s) for s in seen)


def _run_dir(run_name):
    path = os.path.normpath(os.path.join(OUTPUT_ROOT, run_name))
    if not path.startswith(OUTPUT_ROOT + os.sep):
        raise ValueError("bad run name")
    return path


def run(cfg, palette="default", make_plots=True):
    """Run an estimation from an ``estimate`` config dict (same keys as the session file).

    Returns ``{run_name, file_tag, log, plot_results, peaks, files}``; on a problem in
    the input returns ``{error, log}`` with a readable message instead of raising.
    """
    import cls_estimate                      # imports matplotlib + DENIS physics

    os.makedirs(OUTPUT_ROOT, exist_ok=True)
    config_name = "cls_" + datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    config_path = os.path.join("/tmp", config_name + ".yaml")
    with open(config_path, "w", encoding="utf-8") as fh:
        yaml.dump(cfg, fh, sort_keys=False)

    log = io.StringIO()
    try:
        with contextlib.redirect_stdout(log):
            plot_results, all_peaks = cls_estimate.run(
                config_path, OUTPUT_ROOT, not make_plots, palette)
    except OverflowError:
        # Timing mode with a yield, efficiency or peak intensity of zero: the time to
        # reach the required sigma is infinite (DENIS raises OverflowError here).
        return {"error": "The measuring time is infinite for at least one peak.\n\n"
                         "In timing mode every isotope needs a yield and an efficiency "
                         "above zero. Check the Rates & Timing fields.",
                "log": log.getvalue()}
    except (KeyError, ValueError, TypeError, ZeroDivisionError) as exc:
        return {"error": f"{type(exc).__name__}: {exc}", "log": log.getvalue()}
    finally:
        with contextlib.suppress(OSError):
            os.unlink(config_path)

    run_dir = _run_dir(config_name)
    # What the desktop main window writes after a run (_persist_estimate_outputs).
    if plot_results:
        np.savez_compressed(os.path.join(run_dir, "estimate_results.npz"),
                            plot_results=np.array(plot_results, dtype=object),
                            all_peaks=np.array(all_peaks or [], dtype=object),
                            version=1)
    if all_peaks:
        import pandas as pd
        pd.DataFrame(all_peaks).to_csv(os.path.join(run_dir, "peaks.csv"), index=False)
    # Mini DENIS extra: keep the input next to the results, so a downloaded run is complete.
    with open(os.path.join(run_dir, f"{config_name}_config.yaml"), "w", encoding="utf-8") as fh:
        yaml.dump({"estimate": cfg}, fh, sort_keys=False)

    return {
        "run_name": config_name,
        "file_tag": _file_tag(cfg),
        "log": log.getvalue(),
        "plot_results": _jsonable(plot_results or []),
        "peaks": _jsonable(all_peaks or []),
        "files": sorted(os.listdir(run_dir)),
    }


def read_file(run_name, name):
    """Bytes of one file of a run folder (e.g. a PDF to open or download)."""
    path = os.path.join(_run_dir(run_name), os.path.basename(name))
    with open(path, "rb") as fh:
        return fh.read()


def zip_run(run_name):
    """The whole run folder as a zip (the desktop's cls_<timestamp> folder)."""
    run_dir = _run_dir(run_name)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(os.listdir(run_dir)):
            z.write(os.path.join(run_dir, name), f"{run_name}/{name}")
    return buf.getvalue()


def load_run(paths):
    """"Load Estimation...": restore a run from its files.

    ``paths`` are files in the virtual file system: either the files of a desktop
    ``cls_<ts>`` folder, or a single downloaded ``.zip``. Returns the same shape as ``run``
    (without re-running anything), or ``{error}``.
    """
    items = {}
    for path in paths:
        if path.lower().endswith(".zip"):
            with zipfile.ZipFile(path) as z:
                for info in z.infolist():
                    if not info.is_dir():
                        items[os.path.basename(info.filename)] = z.read(info)
        else:
            with open(path, "rb") as fh:
                items[os.path.basename(path)] = fh.read()
    if "estimate_results.npz" not in items:
        return {"error": "No estimate_results.npz found. Pick a downloaded Mini DENIS run (.zip) "
                         "or the files of a DENIS cls_<timestamp> folder."}

    logs = sorted(n for n in items if n.endswith(".log"))
    base = (logs[-1] if logs else next(iter(items))).split("_cls_estimate")[0]
    run_name = base if base.startswith("cls_") else "cls_loaded_" + datetime.now().strftime("%H-%M-%S")
    run_dir = _run_dir(run_name)
    if os.path.isdir(run_dir):
        shutil.rmtree(run_dir)
    os.makedirs(run_dir)
    for name, data in items.items():
        with open(os.path.join(run_dir, name), "wb") as fh:
            fh.write(data)

    with np.load(io.BytesIO(items["estimate_results.npz"]), allow_pickle=True) as npz:
        plot_results = list(npz["plot_results"])
        peaks = list(npz["all_peaks"])
    file_tag = ""
    for n in items:
        if "_hfs_spectra" in n:
            file_tag = n.split("_hfs_spectra", 1)[1].rsplit(".", 1)[0]
        elif not file_tag and "_cls_estimate" in n:
            file_tag = n.split("_cls_estimate", 1)[1].rsplit(".", 1)[0]
    log = items[logs[-1]].decode("utf-8", "replace") if logs else ""
    return {"run_name": run_name, "file_tag": file_tag, "log": log,
            "plot_results": _jsonable(plot_results), "peaks": _jsonable(peaks),
            "files": sorted(os.listdir(run_dir))}


def export_view(run_name, view, fmt="png", dpi=200, palette="default"):
    """A plot of a run as PNG / SVG / PDF, drawn by DENIS's own plotting code.

    ``view`` is "spectra" (one panel per isotope, like the hfs_spectra PDF) or
    "overview" (all isotopes on one axis). The figure is identical to the desktop
    PDF; only the file format and resolution differ.
    """
    from matplotlib.figure import Figure
    from cls_estimations import plotting

    run_dir = _run_dir(run_name)
    with np.load(os.path.join(run_dir, "estimate_results.npz"), allow_pickle=True) as npz:
        plot_results = list(npz["plot_results"])
    tmp = os.path.join("/tmp", "denis_export")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)

    original = Figure.savefig

    def savefig(self, fname, *args, **kwargs):      # same figure, requested format
        root, _ = os.path.splitext(str(fname))
        kwargs["dpi"] = dpi
        kwargs.pop("format", None)
        return original(self, f"{root}.{fmt}", *args, format=fmt, **kwargs)

    plotting.set_palette(palette)
    Figure.savefig = savefig
    try:
        if view == "overview":
            plotting.plot_combined_overview(plot_results, tmp, "", "x")
        else:
            plotting.plot_all_cases(plot_results, tmp, "", "x")
    finally:
        Figure.savefig = original
    out = [f for f in os.listdir(tmp) if f.endswith("." + fmt)]
    with open(os.path.join(tmp, out[0]), "rb") as fh:
        return fh.read()
