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

**Components** — upstream's `components/` are inline-styled `.jsx`. They aren't vendored
yet; YASS currently applies the token layer to its own components. When components are
adopted, copy them **verbatim** (inline styles and all) rather than porting them to
Tailwind — porting forks them from the authority and breaks re-syncing.

## Fonts

`tokens/fonts.css` pulls seven families from Google Fonts. That needs internet access on
the *viewing device*, which is usually fine for phones on the LAN but not for an offline
gaming PC. To self-host, replace the `@import`s with `@font-face` rules; nothing else
needs to change.

## Re-vendoring

Read each upstream path with the DesignSync tool against the project id above and
overwrite the file of the same name here. Then check whether upstream added tokens that
`client/src/index.css` should expose to Tailwind.
