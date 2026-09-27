"""Session files of Mini DENIS: the same YAML format as the desktop app.

A session saved here opens in desktop DENIS and the other way round. Desktop sessions
store absolute data-file paths; in the browser the files are picked again by name.

Sections Mini DENIS does not edit (the Analysis tab, window layout, NIST ASD browser and
anything a newer desktop version adds) stay here in Python exactly as they were read and
are written back unchanged, so values such as null or .nan survive the round trip.
"""
import yaml

# Sections the browser edits; everything else is kept as read.
_OWN = ("estimate", "preanalysis", "scan_filters", "calibrations", "calibration_acks")
# Key order of a desktop save (main_window._build_save_dict).
_ORDER = ("estimate", "preanalysis", "analysis", "ui_layout", "scan_filters",
          "calibrations", "calibration_acks", "nist_asd")

_kept = {}


def _construct_python_tuple_as_list(loader, node):
    # Older desktop saves contain `!!python/tuple`; read it as a list (as DENIS does).
    return loader.construct_sequence(node)


class _Loader(yaml.SafeLoader):
    pass


_Loader.add_constructor("tag:yaml.org,2002:python/tuple", _construct_python_tuple_as_list)


def load(text):
    """Parse a session YAML. Returns ``{session, kept}`` or ``{error}``.

    ``session`` holds only the sections the browser edits; ``kept`` names the others.
    """
    global _kept
    try:
        data = yaml.load(text, Loader=_Loader)
    except yaml.YAMLError as exc:
        return {"error": f"This is not a valid DENIS session file:\n{exc}"}
    if not isinstance(data, dict):
        return {"error": "This is not a DENIS session file."}
    # Legacy flat estimate file: the whole file is the estimate section (main_window :1323).
    if "estimate" not in data and any(k in data for k in ("element", "Z", "transition", "isotopes")):
        data = {"estimate": data}
    # Legacy flat single-project Pre-Analysis file.
    pa = data.get("preanalysis")
    if isinstance(pa, dict) and "projects" not in pa and ("files" in pa or "plot_options" in pa):
        data["preanalysis"] = {"projects": [dict(pa, name=pa.get("name", "Pre-Analysis 1"))]}
    _kept = {k: v for k, v in data.items() if k not in _OWN}
    return {"session": {k: v for k, v in data.items() if k in _OWN}, "kept": list(_kept)}


def clear():
    """Forget the kept sections (New session)."""
    global _kept
    _kept = {}


def dump(session):
    """YAML text of a session, written the way the desktop app writes it (_write_yaml)."""
    merged = {**_kept, **{k: v for k, v in session.items() if v is not None}}
    ordered = {k: merged[k] for k in _ORDER if k in merged}
    ordered.update({k: v for k, v in merged.items() if k not in ordered})
    return yaml.dump(ordered, default_flow_style=False, sort_keys=False, allow_unicode=True)
