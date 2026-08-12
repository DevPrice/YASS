# Vendored YARG design system

**This directory is a copy. The YARG Design System project is the authority — do not
edit these files to change a design.** Fix it upstream and re-vendor, or the next sync
silently reverts the change.

| | |
|---|---|
| Source project | `YARG Design System` (Claude Design) |
| Project id | `ed057d66-45e9-4387-bf0d-1e2a6dc94e9a` |
| Figma file | `YARG - Design System (Original)`, key `v2uJdQ03SKjIL18slAA1wD` |
| Source art | `vendor/opensource` submodule — YARG's own registry, public domain |
| Vendored | 2026-08-10 |

## What's here

```
styles.css        entry point — imports every token file
tokens/           fonts, colors, typography, layout, base  (verbatim copies)
assets/icons/     the eight line icons that exist as real vector geometry
assets/instruments/  14 glyphs              500×500 / 512×512 PNG   (8 in use)
assets/difficulty/   24 difficulty rings         500×500 PNG   (blocked, below)
assets/index.ts   slug → URL lookups; only for globs actually rendered
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
'./genre.svg'` yields a URL, and a URL can't inherit colour. Settled when `random.svg`
became the first one used: `?raw` plus `dangerouslySetInnerHTML`, in `ui/index.tsx`. It's
a build-time constant from this repo with no interpolation, and it adds no dependency.
`vite-plugin-svgr` is the upgrade if several more come into use.

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

A glob emits every file it matches the moment the module is imported, and this module is
imported now — so `index.ts` only globs `instruments/`. Adding a glob back for
`difficulty/` or `sources/` would ship 70 PNGs nothing can render.

Both mappings that used to block this are resolved, and neither the way this file
predicted:

- **`InstrumentKey` → glyph** stopped being a question once the UI worked in instrument
  *groups*. The five families the filters already speak in — guitar, bass, drums, keys,
  vocals — each have a glyph under their own name, so the mapping is exact and nothing
  has to decide what elite drums look like. See `GROUP_ART` in `assets/index.ts`.

  Vocals is the one family whose glyph is not a constant: `vocals-2harmony.png` and
  `vocals-3harmony.png` stand in for `vocals.png` when the CSV's `Vocal Parts` says 2 or
  3. `vocalsArt` in `ui/library.tsx` picks, and falls back to the solo microphone for any
  count nothing was drawn for. These two are the whole reason the app no longer prints a
  `vocal parts` row or a `vocals` stat.

### `band.png` came from the game, not from Figma

`instruments/band.png` is the only file in this directory that did not come out of the
Figma file. It is YARG's own BAND mark, cropped from the sprite sheet the game ships:

```
YARG/Assets/Art/Menu/Common/InstrumentIcons.png   4×4 grid of 512px sprites
```

The rect came from `InstrumentIcons.png.meta`, which names each sprite — `band` is
`x: 512, y: 0, 512×512`. **Unity's sprite origin is bottom-left**, so that `y: 0` is the
*bottom* row of the image, i.e. `crop=512:512:512:1536` in top-left coordinates. Getting
that backwards silently yields the wrong glyph, since every cell is a plausible icon.

It matches the `Instruments` frame's treatment exactly — white disc inside a thin outer
ring, 512×512 — so it sits beside the five instruments without adjustment. The Figma file
has no band mark that we found; re-check there before cropping again, and prefer it if one
has appeared.

### Two generations of instrument glyph

`instruments/` holds art from two different places in the Figma file, and the difference
is visible, not just dimensional.

**The seven in use are 512×512**, from the `Instruments` frame (`10003:17191`) — `guitar`
(upstream `guitar-lead`), `bass`, `drums`, `keys`, `vocals` (upstream `vocals-solo`) and
the two harmony variants. Every glyph there is a disc inside its own thin outer ring, with
a margin around it.

**The six unused ones are 500×500**, from the older Icons page: `bass-pro`,
`drums-5-lane`, `drums-pro`, `guitar-pro`, `harmonies`, `keys-pro`. That generation is a
bare disc with no outer ring and no margin, so it reads noticeably *larger* at the same
CSS size. Mixing the two is what made the first pass at the vocal-count glyphs look
wrong — the new microphones sat in a ring the four glyphs beside them didn't have.
**Don't reintroduce one of these six next to the seven.** Pull its replacement from the
`Instruments` frame instead; they are all there.

The drums art differs between the generations by more than framing: the 500 is a pair of
crossed sticks, the 512 is a drum kit. The kit is busier at the 18px the song row draws it
at. That is upstream's own art direction and the row's glyphs answer "does this have
drums" by being lit or dim, so it was taken as-is rather than held back.

**All seven came from `GET /v1/files/:key/images`** — the image-fill endpoint — because
`/v1/images` was rate limiting and would not render. That is normally the wrong door: the
note under *Re-vendoring* says to render the component, since a source badge layers two
bitmaps and only a render composes them. It is safe for these specifically because every
rectangle in the `Instruments` frame carries exactly one `IMAGE` fill and no effects, so
the fill *is* the render — verified by pulling `vocals-solo` that way and finding the art
identical to the `vocals.png` already vendored. 512 is the native size; the 500s are
scale-1 renders of 500px rectangles, i.e. downsampled.
- **`source` → badge** does not come from this directory at all. It resolves through the
  `vendor/opensource` submodule — 240 sources, 293 id spellings, 212 icons, keyed by the
  ids the library actually contains. Against a real 4,168-song library that covers 85% of
  songs outright, with a short local override for what upstream lacks (Fortnite Festival
  is 618 songs and has no upstream entry). See `lib/sources.ts`.

**The 46 source badges that used to live here are gone**, and not only from the tree.
They were exported from Figma before the registry approach existed, matched 7 of
OpenSource's icon slugs, and were keyed by slugs of display names rather than by anything
a song carries — superseded, unglobbed, and 1.3 MB. Since they are game and band logos in
a repository that is now public, they were removed from the history as well rather than
just deleted forward. Source art is the submodule's job, and arrives with
`git submodule update --init` like it always did.

**The 24 difficulty rings are drawn rather than used.** They run `0`–`20`, `21-plus`,
`no-part`, `unknown`, and the axis question that blocked them is unresolved — the CSV's
difficulties are `0`–`6`, these count to twenty-one, and nothing says the two scales mean
the same thing. What changed is that the *form* turned out to be portable even though the
indexing wasn't: six notches round a circle, filling clockwise from a gap at twelve
o'clock, stroke 9% of the diameter, ~16° of air between notches. `DifficultyRing` in
`ui/library.tsx` draws that in SVG against the tier YASS actually has.

Drawing it also bought three things the PNGs could not give: a ring that takes its colour
from tokens (red at the ceiling, two greys below it), one that renders at 26px in the
banner and 42px in the parts grid off one component, and no 24-image import for a value
the CSV does not bound. The rings stay on disk as the reference the proportions were
measured from — re-vendor them if the geometry changes upstream.

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
| `ui/HelperBar` | `components/core/HelperBar.jsx` | 2026-08-10 | 52px instead of 75px — a browser footer, not a 1080p game bar. Desktop only: below `md` its space goes to the filter bar, since a phone can't press the keys it advertises |
| `features/library/SongList` `SongRow` | `components/music/LibraryRow.jsx` | 2026-08-10 | Track variant only. Source tile and instrument glyphs now render (from OpenSource and `GROUP_ART`); stars omitted — the CSV carries no scores |
| `ui/library` `DifficultyRing` | `assets/difficulty/*.png` | 2026-08-10 | Ported from *art*, not from a component — the geometry is traced off the 500×500 rings (see below), the colour is ours. Six notches; red at 6; past that a full red ring plus the number — badged on the bottom edge when the ring wraps a glyph, centred when it doesn't |
| `ui/TextField`, `ui/Select`, `ui/ToggleChip` | no upstream equivalent | 2026-08-10 | Browser controls the game has no analogue for; built from the system's recipes |
| `features/library/SongDetail` `SongDetailSheet` | no upstream equivalent | 2026-08-10 | Master-detail pane and its phone-sized sheet. The game has no "one song, everything about it" screen — it shows this on the track panel of a list it can afford to make 1080p tall. Built from the system's recipes: card fill plus inset stroke, the selected-row wash on the art plate, hairline rules between facts |

**Drift check:** read the upstream path with DesignSync and compare against the port. Worth
doing when re-vendoring tokens, since the two usually change together.

## Fonts

`tokens/fonts.css` pulls seven families from Google Fonts. **`client/src/index.css` does
not import it** — it repeats the three `@import` lines this app actually renders (Red Hat
Display, Barlow, Inter) and skips the other four. Open Sans, Noto Sans, Big Shoulders
Text and Archivo Black are referenced by no token YASS uses, so they were four
render-blocking round trips for nothing. The vendored file stays byte-identical to
upstream so re-vendoring is still a clean diff; the lines in `index.css` are copied from
it verbatim.

Still remote, though. On an offline gaming PC the whole type identity falls back to
`system-ui`. To self-host, replace those `@import`s with `@font-face` rules; nothing else
needs to change.

## Re-vendoring

Read each upstream path with the DesignSync tool against the project id above and
overwrite the file of the same name here. Then check whether upstream added tokens that
`client/src/index.css` should expose to Tailwind.

**Artwork** comes from Figma instead, using a personal access token (see
`GET /v1/files/:key/nodes?ids=276:1197` for the Icons page and `ids=10003:17191` for the
`Instruments` frame, then `/v1/images/:key` with `format=svg` for the eight vector icons
and `format=png&scale=1` for the rest). Render the *components* rather than pulling the
raw image fills — the rule was learned on the source badges, where two of them layered two
bitmaps that only a render composes, and it holds for anything with more than one fill.
The one documented exception is the `Instruments` frame; see *Two generations of
instrument glyph* above for why it is safe there and what it cost.

**Instrument glyphs come from the `Instruments` frame, not the Icons page.** The Icons
page still has an older set under the same names, and taking a glyph from it lands art
that is framed differently from everything beside it.

Not stored with Git LFS, deliberately: 46 files totalling 0.9 MB, largest 39 KB, and they
change approximately never. LFS earns its keep on large or frequently-rewritten binaries,
and costs a working `git-lfs` on every clone — without it the images arrive as pointer
stubs and fail silently. Revisit if the full-resolution backgrounds ever land here.
