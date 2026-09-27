# ardakayaalp.com

Personal website of Arda Kayaalp, built with Jekyll and served by GitHub Pages.
The theme ("OS97") is a dark Windows 98-style desktop written for this site.

## Everyday use: three double-click scripts

| Script                  | What it does |
|-------------------------|--------------|
| **New update.cmd**      | Asks for a title, creates `updates/<today>-<title>/update.md` with a `figures/` folder, opens it in VS Code. |
| **Preview website.cmd** | Runs the site on this PC and opens the browser. Shows the address for your phone too. Pages refresh when you save. Drafts are visible here only. |
| **Publish website.cmd** | Shows what changed, test-builds the site exactly like GitHub, asks for confirmation, then commits and pushes. Waits until the live site is updated. |

The first run installs the website tools (a few minutes). The first publish asks once for the name and
email to put on your changes.

Phone preview: same Wi-Fi as the PC. If it can't connect, Windows is blocking it: set the Wi-Fi network
to **Private** (Settings > Network & internet > Wi-Fi > your network), or allow **Ruby interpreter** in
"Allow an app through firewall".

---

## Writing an update

Each update is a folder. The folder name gives the date, the order and the address:

```
updates/
  2026-10-02-beam-time-at-isolde/        -> ardakayaalp.com/updates/2026-10-02-beam-time-at-isolde/
    update.md                            (any name ending in .md, one per folder)
    figures/
      spectrum.png
```

`update.md`:

```markdown
---
title: "Beam time at ISOLDE"
tags: [research, travel]
# description: "One sentence for the Updates list and link previews"
# math: true             enables LaTeX
# published: false       draft: preview only, never published
---

The first paragraph is the preview on the Updates page.

![Hyperfine spectrum of the ground state. This text is the caption.](figures/spectrum.png){#fig:spectrum}

## Results {#sec:results}

As @fig:spectrum shows, ... (see @sec:results).
```

- **Front matter is optional.** You can also drop in a plain Markdown file: its first `# Heading` becomes
  the title and the date comes from the folder name.
- **Figures:** an image on its own line becomes a numbered figure with its `![...]` text as caption
  (`*italic*`, `**bold**` and `` `code` `` work in captions). Add `{#fig:name}` right after it to reference it.
  Click a figure to open it full size. An image inside a sentence stays small and inline.
- **Sections:** `##` and `###` headings are numbered (1, 1.1, ...). Add `{#sec:name}` to give one a label;
  unlabelled headings can be referenced by their automatic id (`## Main results` -> `@sec:main-results`).
  Put `section_numbers: false` in the front matter to turn the numbers off.
- **References:** `@fig:name` and `@sec:name` become "Figure 2" / "Section 1.1" links that jump there.
  A misspelled label shows as **Figure ??**, like LaTeX.
- **Equations** (with `math: true`): display equations `$$ ... $$` are numbered; label with
  `\label{eq:name}`, refer with `\eqref{eq:name}`, and use `\notag` to skip a number.
- **Drafts:** `published: false` shows the update in the preview with a "draft" label. Publishing
  never uploads drafts (the GitHub repository is public, so not even the file).
- Tags become filter buttons on the Updates page. The home page shows the newest 3.
- Style: no long dashes on this site; the publish script warns if it finds any.

---

## Photo albums

### The easy way (recommended)

```powershell
python tools/add_album.py "D:\Photos\Iceland 2025" --title "Reykjavik" --country "Iceland"
```

This:

1. resizes every photo to max 2048 px (good quality, about 300-600 KB each) into `images/albums/reykjavik/`,
2. makes thumbnails in `images/albums/reykjavik/thumbs/`,
3. **removes all metadata including GPS location** (rotation is applied first),
4. creates `_albums/reykjavik.md` with the photo list sorted by capture time, including each photo's
   capture date (from the camera; if a photo has none, the file's date is used).

Open `_albums/reykjavik.md` to add captions, fix dates, reorder photos or pick a `cover:`.
Run the script again with `--slug reykjavik` on another folder to **add** photos; existing captions are kept.

Options: `--location "..."`, `--date 2025-06-10`, `--description "..."`, `--max 2560`, `--thumb 640`.
iPhone HEIC files need `pip install pillow-heif`.

### By hand

1. Copy photos into `images/albums/<name>/` (optional thumbnails with the same file names in `thumbs/`).
2. Create `_albums/<name>.md`:

```yaml
---
title: "Reykjavik"
date: 2025-06-10
country: "Iceland"            # the gallery groups albums by this
location: "Reykjavik & the south coast"
cover: skogafoss.jpg          # optional, defaults to the first photo
photos:                       # optional: without it every image in the folder is shown (by file name)
  - file: skogafoss.jpg
    caption: "Skogafoss at dawn"
    date: 2025-06-10          # optional: shown in the viewer; the album's date range comes from these
  - file: glacier.jpg
    caption: ""
---
Optional text shown above the photos.
```

The gallery groups albums by `country:` (alphabetical). Visitors can switch to **Arrange by: Date**
and **Newest / Oldest first**. In an album: click a photo or press *Slideshow*; keys are arrows,
Space (play/pause), F (fullscreen) and Esc. On phones: swipe left/right, swipe down to close.
Links like `/gallery/reykjavik/#photo-4` open a specific photo.

> GitHub Pages sites should stay under about 1 GB. At about 400 KB per photo that's roughly 2000 photos.

---

## Editing the other pages

| What                              | Where                          |
|-----------------------------------|--------------------------------|
| About text on the home page       | `index.md`                     |
| Education / experience / skills   | `_data/background.yml`         |
| Publications                      | `_data/publications.yml`       |
| CV PDF                            | replace `files/CV.pdf`         |
| Name, email, social links         | `_config.yml`                  |
| Desktop icons / Start menu items  | `_data/navigation.yml`         |
| Colours                           | `_sass/_tokens.scss`           |

---

## Mini DENIS

`mini-denis/` is the browser version of DENIS (Estimate and Pre-Analysis tabs), opened from the
"Mini DENIS" desktop icon in a new tab. It is a plain static page: the DENIS Python code runs in the
visitor's browser with [Pyodide](https://pyodide.org), so the site only serves files and nothing is
uploaded or stored.

| What                                   | Where                                         |
|----------------------------------------|-----------------------------------------------|
| Page, splash, menus, About box         | `mini-denis/index.html`, `mini-denis/js/app.js` |
| Estimate / Pre-Analysis tabs           | `mini-denis/js/estimate.js`, `mini-denis/js/preanalysis.js` |
| Styles (incl. phone layout)            | `mini-denis/css/denis.css`                    |
| Python engine glue                     | `mini-denis/py/denis_web/`                    |
| DENIS code copied from the desktop app | `mini-denis/py/vendor/` (made by `--sync`, not in git) |
| Pinned pure-Python wheels              | `mini-denis/wheels/`                          |

After changing anything under `mini-denis/py/`, rebuild the bundle the page loads:

```
python tools/build_mini_denis.py                     # rebuilds mini-denis/denis-py.zip
python tools/build_mini_denis.py --sync "<DENIS folder>"   # first copy a newer DENIS version in
```

`mini-denis/py/` itself is not published (it ships inside `denis-py.zip`).

---

## Structure

```
_config.yml            site settings
_data/                 navigation, publications, background (CV) content
_layouts/              default (desktop + taskbar), page, home, post (updates), album
_includes/             title bar, taskbar/Start menu, icons (SVG sprite), dialogs, helpers
_pages/                background, publications, cv, updates list, gallery
updates/               one folder per update (update.md + figures/)
_albums/               one file per photo album
_sass/ + assets/css/   styles (compiled by GitHub Pages)
assets/js/             main.js (desktop), lightbox.js (gallery), crossref.js (figures and references),
                       updates.js (tag filter)
images/albums/         album photos
mini-denis/             Mini DENIS (browser version of DENIS, see above)
tools/                 preview / publish / new-update scripts, add_album.py, build_mini_denis.py
```

No build step or JavaScript framework for the site itself: everything runs on GitHub Pages' built-in Jekyll.
To run things by hand: `bundle exec jekyll serve` (preview) and a normal `git commit` + `git push` (publish).

## Credits

- Pixel "MS Sans Serif" webfont from [98.css](https://github.com/jdan/98.css) (MIT).
- Icons are original pixel art drawn for this site.
- Mini DENIS: [Pyodide](https://pyodide.org) (MPL-2.0), [Plotly.js](https://plotly.com/javascript/) (MIT),
  [Lucide](https://lucide.dev) icons (ISC), [satlas2](https://iks-nm.github.io/satlas2/index.html) and cls_tools (GPL-3.0, licence in
  `mini-denis/py/vendor/clstools/`).
