"""Pre-Analysis tab of Mini DENIS.

A port of the *orchestration* in DENIS ``gui/preanalysis_tab.py`` (what happens when a
file is opened or a control changes). All the numerical work is done by the unmodified
DENIS / clstools code: ``gui.calibration.load_run_calibrated`` (DENIS's own calibration
fit), clstools ``Compute_Voltages`` / ``Compute_WL``, ``gui.analysis.binning.compute_binned``,
the scan-filter and time-gate context managers from ``gui.scan_filter``, and satlas2 for
the hyperfine model overlay. Method names in comments refer to preanalysis_tab.py.

The interface sends one ``state`` dict (plot options, gates, checked files) and gets
plot-ready series back; files stay in the browser's memory and are never uploaded.
"""
import os
import shutil

import numpy as np

from cls_estimations.constants import AMU_TO_KG, C_LIGHT, E_CHARGE
from cls_estimations.doppler import beta_from_voltage, nu_seen_by_ion

DATA_DIR = "/home/pyodide/data"
DEFAULT_TOF_BIN_US = 0.1
XLABELS = {
    "Voltage": "Scanning voltage (V)",
    "Calibrated voltage": "Calibrated voltage (V)",
    "Calibrated beam energy": "Beam energy (V)",
    "Wavenumber": "Wavenumber (cm$^{-1}$)",
    "Frequency": "Frequency (MHz)",
}
TS_DIVISOR = {"Seconds": 1.0, "Minutes": 60.0, "Hours": 3600.0, "Days": 86400.0}

_runs = {}          # run id -> Run


class Run:
    """One opened ASDF file: the clstools frame plus cached numpy arrays (like FileEntry)."""

    def __init__(self, run_id, path):
        self.id = run_id
        self.path = path
        self.run_number = None
        self.cooler_v = 0.0
        self.laser_sp = 0.0
        self.date = None
        self.mass_amu = None
        self.np_cal_set = None
        self.np_cal_readback = None
        self.cls_data = None
        self.np_v = self.np_dv = self.np_tof = self.np_tdc = None
        self.np_ts = self.np_bunch = self.np_vcool = None
        self.scan_meta = None
        self.run_time_s = 0.0
        self._bin_cache = None
        self._freq_prep_key = None


def _clstools():
    import clstools.DataFrame as cdf
    return cdf


# ── Loading (_load_file + _load_cls_data) ────────────────────────────────────────

def load(run_id, filename, data=None, src=None):
    """Open an ASDF run, given its bytes (``data``) or a file already written into the
    virtual file system (``src``, moved into place). Returns the file-card info or ``{error}``."""
    import asdf
    from gui.calibration import get_registry as cal_registry, load_run_calibrated
    from gui.scan_filter import read_bunches_per_channel

    folder = os.path.join(DATA_DIR, str(run_id))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, os.path.basename(filename))
    if src is not None:
        shutil.move(src, path)
    else:
        with open(path, "wb") as fh:
            fh.write(bytes(data))
    run = Run(run_id, path)

    try:
        with asdf.open(path) as af:
            if "denis_schema" in af.tree:
                raise ValueError("This is a merged spectrum exported by DENIS. Mini DENIS "
                                 "opens raw run files only; use the desktop app for merges.")
            run.run_number = af["Run"]
            run.cooler_v = float(af["CoolerVoltage"]) * 10000
            run.date = af.tree.get("Date", None)
            run.laser_sp = float(af["LaserSetpoint"])
            run.mass_amu = af.tree.get("MassAMU", None)
            run.np_cal_set = np.array(af.tree.get("CalSet", []), dtype=float)
            run.np_cal_readback = np.array(af.tree.get("CalReadback", []), dtype=float) * 1000
    except Exception as exc:
        shutil.rmtree(folder, ignore_errors=True)
        return {"error": f"Failed to read {filename}:\n{exc}"}

    try:
        data_obj = _clstools().CLSDataFrame()
        load_run_calibrated(data_obj, path, cal_registry().to_dict())
        data_obj.Compute_Voltages()
        run.cls_data = data_obj
        df = data_obj.Sorted
        if hasattr(df, "compute"):
            df = df.compute()
        run.np_v = df["V"].to_numpy()
        run.np_dv = df["DV"].to_numpy() if "DV" in df.columns else np.round(run.np_v, 2)
        run.np_tof = df["TOF"].to_numpy() if "TOF" in df.columns else np.zeros(len(run.np_v))
        run.np_tdc = df["TDC"].to_numpy() if "TDC" in df.columns else np.ones(len(run.np_v))
        run.np_ts = df["TS"].to_numpy() if "TS" in df.columns else np.zeros(len(run.np_v))
        if "Bunch" in df.columns:
            run.np_bunch = df["Bunch"].to_numpy()
        try:
            run.scan_meta = {
                "scanning_ranges": getattr(data_obj, "ScanningRanges", None),
                "step_size": getattr(data_obj, "Step_Size", None),
                "bunches_per_channel": read_bunches_per_channel(path),
            }
        except Exception:
            run.scan_meta = None
        vdiv = float(getattr(data_obj, "VCoolDiv", 10000) or 10000)
        voff = float(getattr(data_obj, "VCoolOffset", 0) or 0)
        if "Vrfq" in df.columns:
            run.np_vcool = df["Vrfq"].to_numpy() * vdiv + voff
    except Exception as exc:
        shutil.rmtree(folder, ignore_errors=True)
        return {"error": f"Failed to process {filename}:\n{exc}"}

    run.run_time_s = float(run.np_ts.max() - run.np_ts.min()) if len(run.np_ts) > 1 else 0.0
    _runs[run_id] = run
    return card(run_id)


def card(run_id):
    """What the file list shows for a run (FileEntry.update_detail)."""
    run = _runs[run_id]
    t = run.run_time_s
    rt = f"{t / 3600:.1f} h" if t >= 3600 else (f"{t / 60:.1f} min" if t >= 60 else f"{t:.0f} s")
    return {
        "id": run_id,
        "run_number": run.run_number,
        "name": f"run_{run.run_number}",
        "path": run.path,
        "cooler_v": run.cooler_v,
        "laser_sp": run.laser_sp,
        "mass_amu": None if run.mass_amu is None else float(run.mass_amu),
        "date": None if run.date is None else str(run.date),
        "events": int(len(run.np_v)),
        "run_time_s": t,
        "detail": f"V={run.cooler_v:.1f}  |  λ={run.laser_sp:.4f} cm⁻¹  |  t={rt}",
        "calibration": _calibration_summary(run),
    }


def _calibration_summary(run):
    """The applied calibration (gui.calibration.CalibrationResult) in plain numbers."""
    info = getattr(run.cls_data, "CalibrationInfo", None)
    if info is None:
        return None
    out = {"mode": info.mode, "order": int(info.order), "n_points": int(info.n_points),
           "coeffs_v": [float(c) for c in info.coeffs_v], "errs_v": [float(e) for e in info.errs_v],
           "fallback": bool(info.fallback), "note": info.note}
    if info.fit is not None:
        out.update(sigma_v=float(info.fit.sigma_v), rms_v=float(info.fit.rms_v),
                   max_abs_v=float(info.fit.max_abs_v))
    return out


def remove(run_id):
    run = _runs.pop(run_id, None)
    if run is not None:
        shutil.rmtree(os.path.dirname(run.path), ignore_errors=True)
    return True


# ── Helpers mirroring the tab's methods ─────────────────────────────────────────

def lookup_mass(Z, A):
    """_lookup_mass: periodictable mass in amu, or A when unknown."""
    try:
        import periodictable
        return float(periodictable.elements[int(Z)][int(A)].mass)
    except Exception:
        return float(A)


def isotope_label(Z, A):
    try:
        import periodictable
        return f"{int(A)}{periodictable.elements[int(Z)].symbol}"
    except Exception:
        return ""


def _mass(state):
    if state.get("mass_override"):
        return float(state.get("mass_amu") or 0.0)
    return lookup_mass(state.get("Z", 1), state.get("A", 1))


def _fundamental_cm(state):
    h = int(state.get("harmonic", 1) or 1)
    return (float(state.get("e_upper", 0)) - float(state.get("e_lower", 0))) / h if h > 0 else 0.0


def _cooler_for(run, state):
    ov = state.get("cooler_override") or {}
    if ov.get("enabled"):
        return float(ov.get("value", 0))
    return run.cooler_v if run.cooler_v > 0 else float(ov.get("value", 0))


def _laser_for(run, state):
    ov = state.get("laser_override") or {}
    if ov.get("enabled"):
        return float(ov.get("value", 0))
    return run.laser_sp if run.laser_sp > 0 else float(ov.get("value", 0))


def _default_run(state):
    """_default_file_for_axis: selected, then checked, then any run."""
    order = [f["id"] for f in state.get("files", [])]
    checked = {f["id"] for f in state.get("files", []) if f.get("checked")}
    sel = state.get("selected")
    for rid in ([sel] if sel in _runs else []):
        if _runs[rid].cooler_v > 0:
            return _runs[rid]
    for rid in order:
        if rid in checked and rid in _runs and _runs[rid].cooler_v > 0:
            return _runs[rid]
    for rid in order:
        if rid in _runs and _runs[rid].cooler_v > 0:
            return _runs[rid]
    return None


def _default_cooler_laser(state):
    run = _default_run(state)
    c_ov = state.get("cooler_override") or {}
    l_ov = state.get("laser_override") or {}
    if c_ov.get("enabled"):
        cooler = float(c_ov.get("value", 0))
    elif run is not None and run.cooler_v > 0:
        cooler = run.cooler_v
    else:
        cooler = float(c_ov.get("value", 0))
    if l_ov.get("enabled"):
        laser = float(l_ov.get("value", 0))
    elif run is not None and run.laser_sp > 0:
        laser = run.laser_sp
    else:
        laser = float(l_ov.get("value", 0))
    return cooler, laser


def _voltage_to_frequency(v_beam, mass_amu, harmonic, laser_cm1):
    nu_laser_MHz = laser_cm1 * harmonic * C_LIGHT * 100.0 / 1e6
    beta = beta_from_voltage(v_beam, mass_amu, 1)
    return nu_seen_by_ion(nu_laser_MHz, beta, "anti-collinear")


def _effective_bin_mode(xaxis):
    return "Frequency" if xaxis in ("Frequency", "Wavenumber") else "Raw Voltage"


def _binning_cfg(state, pmt_gate, tof_gate):
    b = state.get("binning") or {}
    return {
        "bin_mode": _effective_bin_mode(state.get("x_axis", "Frequency")),
        "x_column": b.get("x_column", "bins_center"),
        "yerr_mode": b.get("yerr_mode", "None"),
        "xerr_mode": b.get("xerr_mode", "None"),
        "bin_definition": b.get("bin_definition", "Per scan step"),
        "bin_count": int(b.get("bin_count", 100)),
        "bin_width_mhz": float(b.get("bin_width_mhz", 10.0)),
        "step_multiple": int(state.get("step_multiple", 1) or 1),
        "tof_gate": tof_gate,
        "pmt_gate": list(pmt_gate),
        "v_gate": None,
    }


def _prepare_frequency_data(run, cooler_v, laser_sp, mass, harmonic):
    key = (round(float(cooler_v), 6), round(float(laser_sp), 9), round(float(mass), 9), int(harmonic))
    if run._freq_prep_key == key:
        return
    data = run.cls_data
    data.VCoolDiv = 0
    data.VCoolOffset = float(cooler_v)
    data.Laser_set = float(laser_sp)
    data.Compute_Voltages(cooler_correction="pbp")
    data.Vcool_init = float(cooler_v)
    data.VCoolDiv = 1
    data.Compute_WL(Mass=float(mass), ref=0, harmonic=int(harmonic))
    data.VCoolDiv = 0
    run._freq_prep_key = key


def _display_x(x_bin, bin_mode, xaxis, run, cooler_v, laser_sp, mass, harmonic, offset):
    if bin_mode == "Raw Voltage":
        dv_bins = np.asarray(x_bin, dtype=float)
        if xaxis == "Voltage":
            return dv_bins
        info = getattr(run.cls_data, "CalibrationInfo", None)
        if info is not None and getattr(info, "coeffs_v", None):
            v_cal = info.predict_v(dv_bins)
        elif run.np_cal_set is not None and len(run.np_cal_set) > 0:
            idx = np.array([np.argmin(np.abs(run.np_cal_set - v)) for v in dv_bins])
            v_cal = run.np_cal_readback[idx]
        else:
            v_cal = dv_bins
        if xaxis == "Calibrated voltage":
            return v_cal
        if xaxis == "Calibrated beam energy":
            return cooler_v - v_cal
        freq = _voltage_to_frequency(cooler_v - v_cal, mass, harmonic, laser_sp)
        if xaxis == "Wavenumber":
            return freq * 1e6 / (C_LIGHT * 100.0) - offset * harmonic
        return freq - offset * harmonic * C_LIGHT * 100.0 / 1e6
    if xaxis == "Wavenumber":
        return np.asarray(x_bin) * 1e6 / (C_LIGHT * 100.0) - offset * harmonic
    if xaxis == "Frequency":
        return np.asarray(x_bin) - offset * harmonic * C_LIGHT * 100.0 / 1e6
    return None


def _ts_gate_seconds(run, state):
    ts = state.get("ts") or {}
    if not ts.get("gate_enabled"):
        return None
    lo, hi = float(ts.get("lo", 0)), float(ts.get("hi", 0))
    if hi <= lo or run.np_ts is None or len(run.np_ts) == 0:
        return None
    div = TS_DIVISOR.get(ts.get("unit", "Seconds"), 1.0)
    base = float(run.np_ts.min())
    return (base + lo * div, base + hi * div)


def _series(arr):
    return np.asarray(arr, dtype=float).tolist()


# ── The replot (_replot) ─────────────────────────────────────────────────────────

def compute(state):
    """Spectrum, TOF and timestamp data for every checked run.

    ``state``: {files:[{id, checked}], selected, x_axis, harmonic, e_lower, e_upper, normalize,
    Z, A, mass_override, mass_amu, channels:[1..5], tof:{enabled, lo, hi, binsize},
    ts:{unit, binsize, gate_enabled, lo, hi}, cooler_override:{enabled, value},
    laser_override:{enabled, value}, step_multiple, excluded_scans:{id:[...]}, want:{tof, ts}}
    """
    from gui.analysis.binning import compute_binned
    from gui.calibration import get_registry as cal_registry, spec_fingerprint
    from gui.scan_filter import filter_data_for_binning, gate_data_by_timestamp

    xaxis = state.get("x_axis", "Frequency")
    harmonic = int(state.get("harmonic", 1) or 1)
    offset = _fundamental_cm(state)
    normalize = bool(state.get("normalize"))
    mass = _mass(state)
    pmt_gate = [int(c) for c in state.get("channels", [3, 4])]
    tof = state.get("tof") or {}
    tof_gate = [float(tof.get("lo", 35)), float(tof.get("hi", 61))] if tof.get("enabled") else None
    want = state.get("want") or {"tof": True, "ts": True}
    excluded_by_id = {str(k): set(v) for k, v in (state.get("excluded_scans") or {}).items()}

    result = {"xlabel": XLABELS.get(xaxis, "Frequency (MHz)"), "mass": mass,
              "spectra": [], "tof": [], "ts": [], "warnings": []}
    if not pmt_gate:
        return result

    for f in state.get("files", []):
        run = _runs.get(f.get("id"))
        if not f.get("checked") or run is None or run.cls_data is None:
            continue
        cooler_v = _cooler_for(run, state)
        laser_sp = _laser_for(run, state)
        cfg = _binning_cfg(state, pmt_gate, tof_gate)
        bin_mode = cfg["bin_mode"]
        excluded = excluded_by_id.get(str(run.id), set())
        ts_gate = _ts_gate_seconds(run, state)

        key = (cfg["bin_mode"], cfg["x_column"], cfg["yerr_mode"], cfg["xerr_mode"],
               cfg["bin_definition"], cfg["bin_count"], cfg["bin_width_mhz"],
               cfg.get("step_multiple", 1), tuple(pmt_gate),
               tuple(tof_gate) if tof_gate else None, ts_gate, frozenset(excluded),
               round(cooler_v, 6), round(laser_sp, 9), round(mass, 9), harmonic,
               spec_fingerprint(cal_registry().get(run.path)))
        if run._bin_cache is not None and run._bin_cache["key"] == key:
            x_bin, y = run._bin_cache["x"], run._bin_cache["y"].copy()
        else:
            if bin_mode == "Frequency":
                _prepare_frequency_data(run, cooler_v, laser_sp, mass, harmonic)
            try:
                with filter_data_for_binning(run.cls_data, excluded, asdf_path=run.path), \
                        gate_data_by_timestamp(run.cls_data, ts_gate):
                    out = compute_binned(run.cls_data, cfg)
            except Exception as exc:
                result["warnings"].append(f"run_{run.run_number}: binning failed ({exc})")
                continue
            x_bin = out["x"]
            y = np.asarray(out["y"], dtype=float)
            run._bin_cache = {"key": key, "x": x_bin, "y": y.copy()}

        if len(x_bin):
            x = _display_x(x_bin, bin_mode, xaxis, run, cooler_v, laser_sp, mass, harmonic, offset)
            if x is not None:
                if normalize and y.max() > 0:
                    y = y / y.max()
                result["spectra"].append({"id": run.id, "x": _series(x), "y": _series(y)})

        if want.get("tof", True):
            vals = run.np_tof[np.isin(run.np_tdc, pmt_gate)]
            if len(vals):
                b = float(tof.get("binsize") or DEFAULT_TOF_BIN_US)
                edges = np.arange(vals.min() - 0.5 * b, vals.max() + 0.5 * b, b)
                if len(edges) > 1:
                    counts, _ = np.histogram(vals, bins=edges)
                    result["tof"].append({"id": run.id, "edges": _series(edges), "counts": _series(counts)})
        if want.get("ts", True):
            ts = state.get("ts") or {}
            vals = run.np_ts[np.isin(run.np_tdc, pmt_gate)]
            if len(vals):
                div = TS_DIVISOR.get(ts.get("unit", "Seconds"), 1.0)
                disp = (vals - vals.min()) / div
                b = float(ts.get("binsize") or 1.0)
                edges = np.arange(disp.min() - 0.5 * b, disp.max() + 0.5 * b, b)
                if len(edges) > 1:
                    counts, _ = np.histogram(disp, bins=edges)
                    result["ts"].append({"id": run.id, "edges": _series(edges), "counts": _series(counts)})
    return result


# ── HFS model overlay (_update_models / _rebuild_peak_rows) ────────────────────────

def _mhz_to_xaxis(freq_mhz, xaxis, harmonic, offset, mass, cooler_v, laser_sp):
    freq_mhz = np.asarray(freq_mhz, dtype=float)
    if xaxis in ("Voltage", "Calibrated voltage", "Calibrated beam energy"):
        if laser_sp <= 0 or mass <= 0 or harmonic <= 0:
            return freq_mhz
        wn = freq_mhz * 1e6 / (C_LIGHT * 100.0)
        wn_laser = laser_sp * harmonic
        wn_rest = wn + offset * harmonic
        E0 = mass * AMU_TO_KG * C_LIGHT ** 2
        V_beam = E0 / E_CHARGE * ((wn_laser ** 2 + wn_rest ** 2) / (2 * wn_rest * wn_laser) - 1)
        return V_beam if xaxis == "Calibrated beam energy" else -(V_beam - cooler_v)
    if xaxis == "Wavenumber":
        return freq_mhz * 1e6 / (C_LIGHT * 100.0)
    return freq_mhz


def _valid_spins(I, Jl, Ju):
    return (I >= 0 and Jl >= 0 and Ju >= 0
            and 2 * I == int(2 * I) and 2 * Jl == int(2 * Jl) and 2 * Ju == int(2 * Ju))


def peak_rows(I, Jl, Ju):
    """Line labels and Racah amplitudes for the Peak Amplitudes section."""
    I, Jl, Ju = float(I), float(Jl), float(Ju)
    if not _valid_spins(I, Jl, Ju):
        return {"labels": [], "racah": []}
    import satlas2
    hfs = satlas2.HFS(I=I, J=[Jl, Ju], A=[0, 0], B=[0, 0], C=[0, 0], df=0, scale=1,
                      racah=True, fwhmg=50, fwhml=50)
    labels = list(hfs.lines)
    return {"labels": labels, "racah": [float(hfs.params[f"Amp{l}"].value) for l in labels]}


def _peak_overrides(m, racah):
    """HFSModelPanel.get_peak_overrides: {label: amplitude} for Free / Linked peaks."""
    if not m.get("peaks_enabled"):
        return {}
    rows = m.get("peaks") or []
    out = {}
    for r in rows:
        if r.get("mode") == "Free":
            out[r["label"]] = float(r.get("value", 0))
    for r in rows:
        if r.get("mode") != "Linked":
            continue
        linked = r.get("linked_to")
        amp = racah.get(linked, 1.0)
        for o in rows:
            if o["label"] == linked:
                if o.get("mode") == "Free":
                    amp = float(o.get("value", 0))
                elif o.get("mode") == "Linked":
                    amp = out.get(linked, racah.get(linked, 1.0))
                break
        out[r["label"]] = float(r.get("ratio", 1.0)) * amp
    return out


def models(state):
    """Curves (and optional peak labels) of every enabled HFS model in display units."""
    import satlas2

    xaxis = state.get("x_axis", "Frequency")
    harmonic = int(state.get("harmonic", 1) or 1)
    offset = _fundamental_cm(state)
    mass = _mass(state)
    cooler_v, laser_sp = _default_cooler_laser(state)
    curves, errors = [], []
    for i, m in enumerate(state.get("models", [])):
        if not m.get("enabled", True):
            continue
        I, Jl, Ju = float(m.get("I", 3.5)), float(m.get("Jl", 4.5)), float(m.get("Ju", 5.5))
        if not _valid_spins(I, Jl, Ju) or float(m.get("scale", 0)) == 0:
            continue
        try:
            hfs = satlas2.HFS(I=I, J=[Jl, Ju], A=[m.get("Al", 0), m.get("Au", 0)],
                              B=[m.get("Bl", 0), m.get("Bu", 0)], C=[0, 0],
                              df=m.get("centroid", 0), scale=m.get("scale", 100), racah=True,
                              fwhmg=m.get("fwhm_g", 50), fwhml=m.get("fwhm_l", 50),
                              name=f"hfs_preview_{i}")
            order = int(m.get("bkg_order", 0) or 0)
            coeffs = [float(m.get(k, 0)) for k in ("bkg", "bkg_p1", "bkg_p2")[:order + 1]]
            bkg = satlas2.Polynomial(list(reversed(coeffs)), name=f"bkg_preview_{i}")
            racah = {l: float(hfs.params[f"Amp{l}"].value) for l in hfs.lines}
            for label, amp in _peak_overrides(m, racah).items():
                if f"Amp{label}" in hfs.params:
                    hfs.params[f"Amp{label}"].value = amp
            pos = np.array(hfs.pos())
            if len(pos) == 0:
                continue
            xm = np.linspace(pos.min() - 500, pos.max() + 500, 2000)
            ym = hfs.f(xm) + bkg.f(xm)
            curve = {"index": i, "x": _series(_mhz_to_xaxis(xm, xaxis, harmonic, offset, mass,
                                                           cooler_v, laser_sp)),
                     "y": _series(ym)}
            if m.get("peak_labels_enabled"):
                curve["peaks"] = {
                    "labels": list(hfs.lines),
                    "x": _series(_mhz_to_xaxis(pos, xaxis, harmonic, offset, mass, cooler_v, laser_sp)),
                    "y": _series(hfs.f(pos) + bkg.f(pos)),
                }
            curves.append(curve)
        except Exception as exc:
            errors.append(f"{m.get('name', f'Model {i + 1}')}: {exc}")
    return {"curves": curves, "errors": errors}


# ── Scan overlay (_compute_scan_starts / _maybe_draw_scan_overlay) ────────────────

def scans(run_id, unit="Seconds"):
    """Start time (display unit, since file start) and number of every scan of a run."""
    from gui.scan_filter import derive_scan_indices

    run = _runs.get(run_id)
    if run is None or run.np_bunch is None or not run.scan_meta:
        return {"starts": [], "scans": []}
    meta = run.scan_meta
    idx = derive_scan_indices(run.np_bunch, meta.get("scanning_ranges"), meta.get("step_size"),
                              meta.get("bunches_per_channel"))
    if len(idx) == 0:
        return {"starts": [], "scans": []}
    order = np.argsort(idx, kind="stable")
    i_sorted = idx[order]
    ts_sorted = run.np_ts[order]
    starts_at = np.concatenate(([0], np.flatnonzero(np.diff(i_sorted)) + 1))
    starts = (ts_sorted[starts_at] - float(ts_sorted[0])) / TS_DIVISOR.get(unit, 1.0)
    return {"starts": _series(starts), "scans": [int(s) for s in i_sorted[starts_at]]}


# ── Calibrations + Cooler Voltage sub-tabs (_replot_calibrations) ─────────────────

def diagnostics(state):
    """Data for the Calibrations and Cooler Voltage sub-tabs of every checked run."""
    n_bins = int(state.get("cooler_bins", 100) or 100)
    cal, cool = [], []
    for f in state.get("files", []):
        run = _runs.get(f.get("id"))
        if not f.get("checked") or run is None:
            continue
        label = f"run_{run.run_number}"
        cs, rb = run.np_cal_set, run.np_cal_readback
        if cs is not None and rb is not None and len(cs) >= 2:
            info = getattr(run.cls_data, "CalibrationInfo", None)
            excl = tuple(getattr(info, "excluded", ()) or ()) if info is not None else ()
            overridden = info is not None and getattr(info, "mode", "") != "file"
            idx = [i for i in excl if 0 <= i < len(cs)]
            rb_line = np.asarray(rb, dtype=float).copy()
            if idx:
                rb_line[idx] = np.nan
            item = {"id": run.id, "label": label + (" [edited]" if overridden else ""),
                    "set": _series(cs), "readback": _series(rb_line), "diff": _series(rb_line - cs),
                    "step_x": _series(cs[1:]), "step": _series(np.diff(rb_line)),
                    "excluded": {"set": _series(cs[idx]), "readback": _series(np.asarray(rb, float)[idx])} if idx else None}
            if overridden:
                xs = np.linspace(float(np.min(cs)), float(np.max(cs)), 200)
                item["applied"] = {"x": _series(xs), "y": _series(info.predict_v(xs)),
                                   "resid": _series(rb_line - info.predict_v(cs))}
            cal.append(item)

        if (run.np_vcool is None or run.np_ts is None or len(run.np_vcool) < 2
                or float(run.np_ts.max() - run.np_ts.min()) <= 0):
            continue
        order = np.argsort(run.np_ts)
        t_rel = run.np_ts[order] - run.np_ts[order][0]
        v = run.np_vcool[order]
        v_ref = float(np.median(v))
        sigma = 1.4826 * float(np.median(np.abs(v - v_ref)))
        pp = float(np.percentile(v, 95) - np.percentile(v, 5))
        dev_up = float(v.max()) - v_ref
        dev_dn = float(v.min()) - v_ref
        n_out = int(np.sum(np.abs(v - v_ref) > 3.0 * sigma)) if sigma > 0 else 0
        t_line, v_line = t_rel, v
        if len(v_line) > 50000:
            stride = len(v_line) // 50000
            t_line, v_line = t_line[::stride], v_line[::stride]
        edges = np.linspace(0.0, float(t_rel[-1]), n_bins + 1)
        bin_idx = np.clip(np.searchsorted(edges, t_rel, side="right") - 1, 0, n_bins - 1)
        ub, first = np.unique(bin_idx, return_index=True)
        last = np.r_[first[1:] - 1, len(bin_idx) - 1]
        med = np.full(n_bins, np.nan)
        std = np.full(n_bins, np.nan)
        ppb = np.full(n_bins, np.nan)
        for b, fp, lp in zip(ub, first, last):
            seg = v[fp:lp + 1]
            med[b] = float(np.median(seg)) - v_ref
            std[b] = float(np.std(seg))
            ppb[b] = float(np.percentile(seg, 95) - np.percentile(seg, 5)) if (lp - fp) >= 4 else float(seg.max() - seg.min())
        valid = ~np.isnan(med)
        if not valid.any():
            continue
        centers = 0.5 * (edges[:-1] + edges[1:])
        spikes = None
        if sigma > 0 and n_out > 0:
            m = np.abs(v - v_ref) > 3.0 * sigma
            t_sp, v_sp = t_rel[m], (v - v_ref)[m]
            if len(t_sp) > 500:
                pick = np.linspace(0, len(t_sp) - 1, 500).astype(int)
                t_sp, v_sp = t_sp[pick], v_sp[pick]
            spikes = {"t": _series(t_sp), "v": _series(v_sp)}
        cool.append({"id": run.id, "label": label, "t": _series(t_line), "v": _series(v_line),
                     "v_ref": v_ref, "sigma": sigma, "pp": pp, "spikes": n_out, "max_up": dev_up,
                     "max_dn": dev_dn, "bins": _series(centers[valid]), "median_dev": _series(med[valid]),
                     "rms": _series(std[valid]), "p95_p5": _series(ppb[valid]), "spike_points": spikes})

    # MHz per volt at the first run's beam energy (secondary axis / table column)
    mhz_per_v = None
    try:
        mass = _mass(state)
        harm = int(state.get("harmonic", 1) or 1)
        laser = _fundamental_cm(state)
        v0 = cool[0]["v_ref"] if cool else 0.0
        if mass > 0 and harm > 0 and laser > 0 and v0 > 0:
            k = float(_voltage_to_frequency(v0 + 0.5, mass, harm, laser) - _voltage_to_frequency(v0 - 0.5, mass, harm, laser))
            mhz_per_v = k if np.isfinite(k) else None
    except Exception:
        mhz_per_v = None
    return {"calibrations": cal, "cooler": cool, "mhz_per_v": mhz_per_v}


def header(run_id):
    """ASDF header of a run (everything except the event table), for the info window."""
    import asdf
    run = _runs[run_id]
    out = {}
    with asdf.open(run.path) as af:
        for k, v in af.tree.items():
            if k in ("raw", "asdf_library", "history"):
                continue
            try:
                arr = np.asarray(v)
                if arr.ndim == 0:
                    out[k] = arr.item() if arr.dtype.kind in "biuf" else str(v)
                elif arr.size <= 12:
                    out[k] = arr.tolist()
                else:
                    out[k] = f"array {arr.shape} {arr.dtype}"
            except Exception:
                out[k] = str(v)
        raw = af.tree.get("raw")
        if raw is not None:
            out["raw (events)"] = f"{np.asarray(raw).shape[0]} events x {np.asarray(raw).shape[1]} columns"
    return {k: (v if isinstance(v, (int, float, str, list)) else str(v)) for k, v in out.items()}
