# Vendored YARG design system

**This directory is a copy. The YARG Design System project is the authority — do not
edit these files to change a design.** Fix it upstream and re-vendor, or the next sync
silently reverts the change.

| | |
|---|---|
| Source project | `YARG Design System` (Claude Design) |
| Project id | `ed057d66-45e9-4387-bf0d-1e2a6dc94e9a` |
| Figma file | `YARG - Design System (Original)`, key `v2uJdQ03SKjIL18slAA1wD` |
| Vendored | 2026-08-10 |

## What's here

```
styles.css        entry point — imports every token file
tokens/           fonts, colors, typography, layout, base  (verbatim copies)
assets/icons/     the eight line icons that exist as real vector geometry
assets/instruments/  11 instrument glyphs        500×500 PNG
assets/difficulty/   24 difficulty rings         500×500 PNG
assets/sources/      46 source badges            300×300 PNG
assets/index.ts   slug → URL lookups for the three PNG directories
```

Token files are byte-for-byte copies of the upstream paths of the same name, so
re-vendoring is a straight overwrite and a diff shows exactly what changed upstream.

## Vector icons

`assets/icons/` holds the only artwork in the system that is genuinely vector:

| File | Figma component | Size |
|---|---|---|
| `genre.svg` `length.svg` `year.svg` `source.svg` | Music Data Icons | 25×25 |
| `random.svg` `setlist.svg` `show.svg` `return.svg` | Action Icons | 35×35 |

Exported 2026-08-09 from the Figma file below. Two edits on the way in, both deliberate:
the hardcoded `#2ED9FF` stroke became `currentColor` (it matched no token — the nearest
are `--yarg-vivid-sky-blue` and `--yarg-text-cyan`, and neither is exact), and the fixed
`width`/`height` were dropped so CSS sizes them. The `viewBox` carries the aspect ratio.

**`currentColor` only works if the SVG is inlined.** Vite's default `import icon from
'./genre.svg'` yields a URL, and a URL can't inherit colour. Import with `?raw`, or add
`vite-plugin-svgr` — decide when the first one is actually used.

## Bitmap art

The instrument glyphs, difficulty rings and source badges are PNG, and that is not a
compromise — **there is no vector version of them anywhere.** Of the 136 components on
the Figma Icons page, 115 are a bare `RECTANGLE` with a placed image fill. Figma exports
those as `.svg` happily, but the output is a base64 PNG in an XML wrapper: larger than
the PNG and no more scalable. The bitmaps behind the fills are 500×500, i.e. the same art
upstream ships at 512px. This matches upstream's own note that the bitmap art is art, not
glyphs, and should never be redrawn as vectors.

They live in `src/` and are reached through `assets/index.ts`, **not** in `public/`. Vite
fingerprints anything imported from `src/`, and `server/src/static.ts` serves `/assets/`
with a one-year `immutable` cache — only safe because the names carry a content hash. A
verbatim `public/` copy would be cached for a year under a stable name, so re-exporting
an icon would never reach a browser that had already loaded it.

Nothing imports `assets/index.ts` yet, so the PNGs are tree-shaken out and cost the
bundle nothing until something renders them.

Two mappings are deliberately absent, because both are judgement calls rather than
lookups, and both are documented at their export in `assets/index.ts`:

- **`InstrumentKey` → glyph.** 20 instruments, 11 glyphs. Nothing is drawn for 6-fret or
  elite drums, and whether rhythm and co-op borrow the guitar glyph is a decision.
- **CSV `source` → badge.** The badges are slugs of display names (`rock-band-3`); the
  CSV holds YARG's raw ids (`rb3dlc`, `$DEFAULT$`). Translating needs YARG's source list.

Also not here: **stars, EX-mode medals, star slots, and Extra Stats** (25 components).
They render score data, and the CSV export carries no scores, so there is nothing to
draw them against. Re-export them from the same Figma page when that changes.

Upstream components resolve art through `window.__YARG_ASSETS__` (falling back to
`assets/`). YASS ports rather than vendoring components, so it uses the lookups above
instead; set that global only if a vendored upstream component ever ships here.

**Components** — upstream's `components/` are inline-styled `.jsx` and are **not** copied
here. See the porting policy below.

## Component policy: port to Tailwind

Upstream components are **ported to Tailwind**, not vendored verbatim. The codebase keeps
one styling idiom, at the cost of the port being manual.

The tradeoff to stay honest about: a ported component is a fork. Upstream changes do not
flow in automatically, and drift is silent — nothing fails a build when a colour or a
radius changes upstream. Two habits keep that manageable:

1. **Port through the tokens, never through literals.** If a port reaches for `#45D8FE`
   instead of `var(--yarg-vivid-sky-blue)`, an upstream palette change silently stops
   reaching it. Re-vendoring tokens should be enough to pick up most upstream changes.
2. **Record what each port came from**, in the table below, so a drift check is a diff
   against a known upstream path rather than an archaeology exercise.

### Ported components

| YASS | Upstream source | Ported | Notes |
|---|---|---|---|
| `ui/Button` | `components/core/Button.jsx` | 2026-08-10 | Tones `confirm`/`accent`/`danger`/`neutral`; adds a `quiet` variant for toolbars |
| `ui/HelperBar` | `components/core/HelperBar.jsx` | 2026-08-10 | 52px instead of 75px — a browser footer, not a 1080p game bar |
| `features/library/SongList` `SongRow` | `components/music/LibraryRow.jsx` | 2026-08-10 | Track variant only. Source tile, instrument glyph and stars omitted pending assets |
| `ui/TextField`, `ui/Select`, `ui/ToggleChip` | no upstream equivalent | 2026-08-10 | Browser controls the game has no analogue for; built from the system's recipes |

**Drift check:** read the upstream path with DesignSync and compare against the port. Worth
doing when re-vendoring tokens, since the two usually change together.

## Fonts

`tokens/fonts.css` pulls seven families from Google Fonts. That needs internet access on
the *viewing device*, which is usually fine for phones on the LAN but not for an offline
gaming PC. To self-host, replace the `@import`s with `@font-face` rules; nothing else
needs to change.

## Re-vendoring

Read each upstream path with the DesignSync tool against the project id above and
overwrite the file of the same name here. Then check whether upstream added tokens that
`client/src/index.css` should expose to Tailwind.

**Artwork** comes from Figma instead, using a personal access token (see
`GET /v1/files/:key/nodes?ids=276:1197` for the Icons page, then `/v1/images/:key` with
`format=svg` for the eight vector icons and `format=png&scale=1` for the rest). Render
the *components* rather than pulling the raw image fills — two source badges layer two
bitmaps, and only a render composes them. Every asset here was exported at scale 1, which
is native size for all three sets.

Not stored with Git LFS, deliberately: 81 files totalling 2.2 MB, largest 42 KB, and they
change approximately never. LFS earns its keep on large or frequently-rewritten binaries,
and costs a working `git-lfs` on every clone — without it the images arrive as pointer
stubs and fail silently. Revisit if the full-resolution backgrounds ever land here.
