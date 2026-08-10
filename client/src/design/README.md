# Vendored YARG design system

**This directory is a copy. The YARG Design System project is the authority — do not
edit these files to change a design.** Fix it upstream and re-vendor, or the next sync
silently reverts the change.

| | |
|---|---|
| Source project | `YARG Design System` (Claude Design) |
| Project id | `ed057d66-45e9-4387-bf0d-1e2a6dc94e9a` |
| Vendored | 2026-08-10 |

## What's here

```
styles.css        entry point — imports every token file
tokens/           fonts, colors, typography, layout, base  (verbatim copies)
```

Files are byte-for-byte copies of the upstream paths of the same name, so re-vendoring
is a straight overwrite and a diff shows exactly what changed upstream.

## What's deliberately not here

**Bitmap assets** — instrument glyphs, difficulty rings, stars, EX-mode medals, source
badges, and backgrounds. Upstream ships these as 512px PNGs, and the transfer tool can
only deliver them base64-encoded, which isn't practical for ~40 files.

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
