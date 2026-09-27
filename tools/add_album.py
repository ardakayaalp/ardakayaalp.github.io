#!/usr/bin/env python3
"""
Create or extend a photo album.

    python tools/add_album.py "D:/Photos/Iceland 2025" --title "Iceland" --country "Iceland" --location "Reykjavik"
    python tools/add_album.py "D:/Photos/more-iceland" --slug iceland          # add photos to an existing album

What it does
  * copies every image from the source folder into images/albums/<slug>/,
    resized to at most --max px on the long edge (JPEG, quality 85),
  * writes a thumbnail for each one into images/albums/<slug>/thumbs/,
  * rotates according to EXIF orientation, then strips ALL metadata (incl. GPS),
  * creates / updates _albums/<slug>.md with a `photos:` list (with each photo's
    capture date) you can reorder and add captions to. Existing captions are
    never overwritten.

Needs Pillow:  pip install Pillow   (HEIC files also need: pip install pillow-heif)
"""
import argparse
import datetime as dt
import re
import sys
import unicodedata
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is required:  pip install Pillow")

try:  # optional iPhone HEIC support
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent.parent
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif"}


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "album"


def taken_at(img, path):
    """EXIF DateTimeOriginal if present, else file modification time."""
    try:
        exif = img.getexif()
        raw = exif.get_ifd(0x8769).get(0x9003) or exif.get(0x0132)
        if raw:
            return dt.datetime.strptime(str(raw).strip(), "%Y:%m:%d %H:%M:%S")
    except Exception:
        pass
    return dt.datetime.fromtimestamp(path.stat().st_mtime)


def yaml_str(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def read_existing(md_path):
    """Return (front_matter_text_without_photos, body, [(file, caption_line_or_None)])."""
    text = md_path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        return None
    fm, body = m.group(1), m.group(2)
    photos, keep, in_photos = [], [], False
    for line in fm.splitlines():
        if re.match(r"^photos:\s*$", line):
            in_photos = True
            continue
        if in_photos:
            fm_item = re.match(r"^\s*-\s*file:\s*(.+?)\s*$", line)
            if fm_item:
                photos.append([fm_item.group(1).strip("'\""), None])
                continue
            if re.match(r"^\s+\S", line) and photos:     # caption / alt lines of the previous item
                photos[-1][1] = (photos[-1][1] or "") + line + "\n"
                continue
            in_photos = False
        keep.append(line)
    return "\n".join(keep), body, photos


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, help="folder with the original photos")
    ap.add_argument("--title", help="album title (default: folder name)")
    ap.add_argument("--slug", help="url/folder name (default: from title)")
    ap.add_argument("--date", help="album date YYYY-MM-DD (default: date of the oldest photo)")
    ap.add_argument("--country", default="", help="gallery group, e.g. Belgium")
    ap.add_argument("--location", default="", help="shown under the title")
    ap.add_argument("--description", default="", help="one line shown on the album page")
    ap.add_argument("--max", type=int, default=2048, help="long edge of web images in px (default 2048)")
    ap.add_argument("--thumb", type=int, default=640, help="long edge of thumbnails in px (default 640)")
    ap.add_argument("--quality", type=int, default=85)
    args = ap.parse_args()

    src = args.source.expanduser()
    if not src.is_dir():
        sys.exit(f"Not a folder: {src}")

    title = args.title or src.name
    slug = args.slug or slugify(title)
    out_dir = ROOT / "images" / "albums" / slug
    thumb_dir = out_dir / "thumbs"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    md_path = ROOT / "_albums" / f"{slug}.md"

    files = sorted(p for p in src.iterdir() if p.suffix.lower() in EXTS and p.is_file())
    if not files:
        sys.exit(f"No images found in {src}")

    processed = []
    for p in files:
        try:
            with Image.open(p) as im:
                when = taken_at(im, p)
                im = ImageOps.exif_transpose(im)
                if im.mode not in ("RGB", "L"):
                    im = im.convert("RGB")
                name = slugify(p.stem) + ".jpg"
                big = im.copy()
                big.thumbnail((args.max, args.max), Image.LANCZOS)
                big.save(out_dir / name, "JPEG", quality=args.quality, optimize=True, progressive=True)
                small = im.copy()
                small.thumbnail((args.thumb, args.thumb), Image.LANCZOS)
                small.save(thumb_dir / name, "JPEG", quality=80, optimize=True, progressive=True)
                processed.append((when, name))
                print(f"  ok  {p.name} -> {name}  ({big.width}x{big.height})")
        except Exception as e:  # keep going on a bad file
            print(f"  FAILED  {p.name}: {e}")

    processed.sort()   # chronological
    new_names = [n for _, n in processed]
    taken = {n: w.strftime("%Y-%m-%d") for w, n in processed}

    if md_path.exists():
        parsed = read_existing(md_path)
        if parsed is None:
            sys.exit(f"Could not parse {md_path}; add the photos to it by hand.")
        fm, body, photos = parsed
        known = {f for f, _ in photos}
        photos += [[n, None] for n in new_names if n not in known]
        print(f"\nUpdated {md_path.relative_to(ROOT)} (+{len(photos) - len(known)} photos)")
    else:
        date = args.date or (processed[0][0].strftime("%Y-%m-%d") if processed else dt.date.today().isoformat())
        fm = "\n".join([
            f"title: {yaml_str(title)}",
            f"date: {date}",
            f"country: {yaml_str(args.country)}" if args.country else "# country: \"Belgium\"   (groups the album on the gallery page)",
            f"location: {yaml_str(args.location)}" if args.location else "# location: \"City, Country\"",
            f"cover: {new_names[0]}" if new_names else "# cover: file.jpg",
            f"description: {yaml_str(args.description)}" if args.description else "# description: \"One line for search engines and link previews\"",
        ])
        body = "\n" + (args.description + "\n" if args.description else "")
        photos = [[n, None] for n in new_names]
        print(f"\nCreated {md_path.relative_to(ROOT)}")

    lines = ["photos:"]
    for f, extra in photos:
        lines.append(f"  - file: {f}")
        lines.append(extra.rstrip("\n") if extra else '    caption: ""')
        if f in taken and not (extra and "date:" in extra):
            lines.append(f"    date: {taken[f]}")     # capture date (EXIF), shown in the viewer
    md_path.parent.mkdir(exist_ok=True)
    md_path.write_text(f"---\n{fm.rstrip()}\n" + "\n".join(lines) + f"\n---\n{body}", encoding="utf-8")

    print(f"Photos in images/albums/{slug}/  - add captions in _albums/{slug}.md, then preview with serve.ps1")


if __name__ == "__main__":
    main()
