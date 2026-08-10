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
```

Token files are byte-for-byte copies of the upstream paths of the same name, so
re-vendoring is a straight overwrite and a diff shows exactly what changed upstream.

## Icons

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

## What's deliberately not here

**Bitmap assets** — instrument glyphs, difficulty rings, stars, EX-mode medals, source
badges, and backgrounds.

These are not vector *anywhere*, which took a look at the Figma file to establish: of the
136 components on the Icons page, 115 are a bare `RECTANGLE` with a placed image fill.
Figma will happily export them as `.svg`, but the result is a base64 PNG in an XML
wrapper — larger than the PNG and no more scalable. The originals behind those fills are
500×500 PNGs, i.e. the same art upstream ships at 512px. So there is no SVG version to
find, and PNG is the correct format rather than a compromise. This matches upstream's own
note that the bitmap art is art, not glyphs, and should never be redrawn as vectors.

Components that reference them resolve paths through `window.__YARG_ASSETS__` (falling
back to `assets/`), so once the PNGs are in place, set that global and they light up
with no code change.

Until then, YASS uses the token layer only, and any component needing bitmap art either
falls back to text or is left out.

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
