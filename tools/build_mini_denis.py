#!/usr/bin/env python3
"""
Build the Python bundle of Mini DENIS (the browser version of DENIS on the website).

    python tools/build_mini_denis.py                    # rebuild mini-denis/denis-py.zip
    python tools/build_mini_denis.py --sync "C:/.../CLS Run Time Estimation"
                                                        # first copy the DENIS files again

--sync copies, unchanged, the DENIS modules Mini DENIS runs (the Estimate pipeline, the
calibration / binning / scan-filter code of Pre-Analysis), clstools and the icons from a
DENIS checkout into mini-denis/, and records the DENIS version and commit. Run it after a
DENIS release, then test with "Preview website" and publish.

Layout of the bundle (unpacked to /home/pyodide in the browser):
    cls_estimate.py, cls_estimations/, gui/, clstools/   <- copies of DENIS / clstools
    PySide6/, dask/                                        <- small browser stand-ins
    denis_web/                                             <- the browser engine
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "mini-denis"
PY = APP / "py"
VENDOR = PY / "vendor"
BUNDLE = APP / "denis-py.zip"

# DENIS files Mini DENIS runs as-is (relative to the DENIS repository root).
DENIS_FILES = [
    "cls_estimate.py",
    "cls_estimations/__init__.py",
    "cls_estimations/constants.py",
    "cls_estimations/doppler.py",
    "cls_estimations/config_parser.py",
    "cls_estimations/hfs_model.py",
    "cls_estimations/mass_lookup.py",
    "cls_estimations/plotting.py",
    "cls_estimations/schmidt.py",
    "cls_estimations/statistics.py",
    "cls_estimations/IUPAC-atomic-masses.csv",
    "gui/calibration.py",
    "gui/scan_filter.py",
    "gui/analysis/binning.py",
]
# The desktop package inits import the whole Qt GUI; the bundle ships empty ones.
EMPTY_INITS = ["gui/__init__.py", "gui/analysis/__init__.py"]
LUCIDE = ["sigma", "eye", "atom", "circle-help", "refresh-cw", "sun-moon", "save", "folder-open",
          "file-plus", "file-down", "file-up", "play", "plus", "trash-2", "x", "check", "minus",
          "chevron-down", "chevron-up", "chevron-left", "chevron-right", "settings", "zoom-in",
          "zoom-out", "copy", "undo", "rotate-ccw", "ruler", "target", "crosshair", "search",
          "pencil", "square"]
CLSTOOLS_REPO = "andry3vi/cls_tools"


def sync(denis_root: Path):
    if not (denis_root / "cls_estimate.py").exists():
        sys.exit(f"Not a DENIS checkout: {denis_root}")
    if VENDOR.exists():
        shutil.rmtree(VENDOR)
    for rel in DENIS_FILES:
        dst = VENDOR / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(denis_root / rel, dst)
    for rel in EMPTY_INITS:
        (VENDOR / rel).write_text('"""Browser build: only the calculation modules of this package."""\n',
                                  encoding="utf-8")

    # clstools (GPL-3.0) from DENIS's environment, plus its licence at the pinned commit
    site = denis_root / ".venv" / "Lib" / "site-packages"
    if not (site / "clstools").exists():
        site = next(denis_root.glob(".venv/lib/python3*/site-packages"), site)
    shutil.copytree(site / "clstools", VENDOR / "clstools",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    direct = json.loads(next(site.glob("clstools-*.dist-info")).joinpath("direct_url.json").read_text())
    commit = direct.get("vcs_info", {}).get("commit_id", "main")
    # The licence file may postdate the pinned commit; fall back to the default branch.
    for ref in (commit, "HEAD"):
        try:
            lic = urllib.request.urlopen(
                f"https://raw.githubusercontent.com/{CLSTOOLS_REPO}/{ref}/LICENSE", timeout=30).read()
            break
        except urllib.error.HTTPError:
            lic = None
    if not lic:
        sys.exit("Could not download the clstools LICENSE (needed to redistribute it).")
    (VENDOR / "clstools" / "LICENSE").write_bytes(lic)
    clstools_version = next(site.glob("clstools-*.dist-info")).name[len("clstools-"):-len(".dist-info")]

    # icons
    img = APP / "img"
    (img / "lucide").mkdir(parents=True, exist_ok=True)
    shutil.copy2(denis_root / "icons" / "denis_512.png", img / "denis_512.png")
    shutil.copy2(denis_root / "icons" / "denis.ico", img / "denis.ico")
    try:                                   # small PNGs of the .ico for the website's desktop shortcut
        from PIL import Image
        ico = Image.open(img / "denis.ico")
        for size in (32, 64):
            ico.size = (size, size)
            ico.convert("RGBA").save(img / f"denis_{size}.png", optimize=True)
    except Exception as exc:               # Pillow missing or size not in the .ico: keep the old PNGs
        print(f"  (denis_32/64.png not refreshed: {exc})")
    for name in LUCIDE:
        src = denis_root / "icons" / "lucide" / f"{name}.svg"
        if src.exists():
            shutil.copy2(src, img / "lucide" / f"{name}.svg")

    # provenance
    version = re.search(r'__version__\s*=\s*"([^"]+)"',
                        (denis_root / "gui" / "main_window.py").read_text(encoding="utf-8")).group(1)

    def git(*args):
        try:
            return subprocess.run(["git", "-C", str(denis_root), *args], capture_output=True,
                                  text=True, check=True).stdout.strip()
        except Exception:
            return ""
    head = git("rev-parse", "--short", "HEAD")
    dirty = bool(git("status", "--porcelain", "--", *DENIS_FILES))
    (VENDOR / "SOURCE.txt").write_text(
        f"Copied from DENIS {version} (commit {head}{', with local changes' if dirty else ''})\n"
        f"clstools {clstools_version} (github.com/{CLSTOOLS_REPO} @ {commit[:7]}), GPL-3.0\n",
        encoding="utf-8")
    (PY / "denis_web" / "version.py").write_text(
        f'"""Written by tools/build_mini_denis.py --sync."""\nDENIS_VERSION = "{version}"\n'
        f'DENIS_COMMIT = "{head}"\nCLSTOOLS_VERSION = "{clstools_version}"\n', encoding="utf-8")
    print(f"Synced DENIS {version} ({head}{'+local changes' if dirty else ''}), clstools {clstools_version}")


def build():
    """Deterministic zip: same content -> byte-identical file (no noise in git)."""
    sources = []
    for base in (VENDOR, PY / "shims", PY):
        for f in sorted(base.rglob("*")):
            if f.is_dir() or "__pycache__" in f.parts:
                continue
            rel = f.relative_to(base)
            if base == PY and rel.parts[0] != "denis_web":
                continue
            sources.append((rel.as_posix(), f))
    tmp = BUNDLE.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for arc, f in sorted(sources):
            info = zipfile.ZipInfo(arc, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, f.read_bytes())
    new = tmp.read_bytes()
    if BUNDLE.exists() and BUNDLE.read_bytes() == new:
        tmp.unlink()
        print(f"{BUNDLE.relative_to(ROOT)} unchanged ({len(sources)} files)")
    else:
        tmp.replace(BUNDLE)
        print(f"Wrote {BUNDLE.relative_to(ROOT)}: {len(sources)} files, {len(new) / 1024:.0f} KB, "
              f"sha256 {hashlib.sha256(new).hexdigest()[:12]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sync", type=Path, metavar="DENIS_DIR", help="copy the DENIS files from this checkout first")
    a = ap.parse_args()
    if a.sync:
        sync(a.sync)
    build()
