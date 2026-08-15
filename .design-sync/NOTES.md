# design-sync notes — YASS → claude.ai/design

Project: **YASS Design System** (`71a639d9-093a-4dfd-b886-40bbd3b86e28`).
Scope: the 19 presentational components in `client/src/ui/`. `features/` is
deliberately out — those are composed screens that read app state and fetch.

**This is not the upstream YARG Design System.** That project
(`ed057d66-45e9-4387-bf0d-1e2a6dc94e9a`, named in `client/src/design/README.md`)
is hand-authored, is the authority, and holds 21 components in a *flat* layout
plus guidelines, templates and a companion ui_kit that this repo does not
produce. Syncing this repo into it would delete all of that — the converter owns
the whole project root and reconciles deletes. Never point `projectId` at it.

## Why there is a `prep.mjs` at all

The converter expects a package with a built `dist/`, a `.d.ts` tree and a
shipped stylesheet. YASS is an app with none of those, so `cfg.buildCmd`
(`node .design-sync/prep.mjs`) manufactures all three from the repo's own
toolchain. Each step exists because of a specific failure:

1. **Pruned `@opensource` mirror.** `lib/sources.ts` eagerly globs 213 source
   icons (5.8 MB) and every asset has to inline as a data URI, which would land
   a ~9 MB bundle on every design the agent renders. The mirror keeps both
   `index.json` files whole — so all 240 source *names* resolve exactly as in
   the app — and carries only `base/` icons. An `extra/` source renders its real
   name with no glyph, which is the same graceful path `resolveSource` already
   takes for an unknown id.
2. **The client's real production build**, because it is the only thing that
   compiles the Tailwind these components' class strings refer to.
3. **A stable stylesheet name.** Vite content-hashes the real one and
   `cfg.cssEntry` cannot name a filename that changes every build.
4. **The Vite pre-bundle.** The components use `?raw` SVG imports,
   `import.meta.glob` over the art, and the `@shared`/`@opensource` aliases —
   none of which esbuild does. Vite resolves them first and hands the converter
   plain ESM, so the shipped bundle is still the repo's real compiled output.
5. **An ASCII fold** (see below).
6. **Declaration emit** + **7. a types barrel** (see below).

## Traps that cost real time — each fails silently

- **`PKG_DIR` is found by walking up from `--entry`** to the first `package.json`
  with a name. Emitting the pre-bundle under `.design-sync/` walks up to the
  *repo root*, so `cssEntry`, `tsconfig`, `srcDir` and every `componentSrcMap`
  path miss — and the build still exits 0, writing an unstyled bundle. It is
  emitted to `client/.ds-lib/` so it resolves to `client/package.json`.
- **The `.d.ts` glob skips dot-directories.** The extractor globs
  `<pkgDir>/**/*.d.ts` through fast-glob, so declarations emitted to
  `client/.ds-lib/types/` were found by nothing. They go to `client/ds-types/`.
- **The prop extractor only reads `.d.ts`, never `.tsx`.** With no declaration
  tree every component shipped `[key: string]: unknown` — an API contract of
  "anything goes", which is the one file the design agent codes against.
- **Emitting declarations is necessary but not sufficient.** The extractor looks
  for an interface named `<Name>Props`; only Button, TextField and Select have
  one. The other 16 declare props as an inline object literal, and for those it
  falls back to the first call signature of the component exported from
  `<pkgDir>/index.d.ts`. That file does not exist in an app, so prep generates
  it. It is deliberately *not* added to `client/package.json` as `types` — the
  client ships types to nobody and claiming otherwise would lie to every tool
  that reads that manifest.
- **`ChevronRight` and `RandomIcon` take no parameter at all**, so there is no
  call signature to read and they fall back to the index signature regardless.
  They are the only two entries in `cfg.dtsPropsFor`.
- **Nothing serves the bundle with a charset.** `foldForSearch`'s combining-marks
  class in `client/src/lib/format.ts` is written with literal characters, so a
  latin-1 decode turns it into a reversed range and throws
  `SyntaxError: Range out of order in character class` *while the IIFE is
  evaluating* — `window.YASS` is never assigned and all 19 components fail as
  `[BUNDLE_EXPORT]` with nothing pointing at the cause. esbuild escapes strings
  but passes regex literals through verbatim, so prep folds the whole pre-bundle
  to `\uXXXX`. The preview cards declare `<meta charset="utf-8">` and were fine;
  the validator's synthetic page does not, which is where this surfaced. Keep the
  fold: it costs nothing and removes the whole class of risk downstream.
- **Every preview card hardcodes `<style>body{background:#fff}</style>`** after
  the stylesheet links, which is wrong for a dark DS. `prep.mjs` appends an
  `html body` rule to `cfg.cssEntry` — specificity is compared before source
  order, so `(0,0,2)` beats the card's `(0,0,1)` without `!important` and without
  forking `lib/emit.mjs`, which owns the contract with the app's self-check.

## Two upstream token bugs this surfaced

- **`--text-body` is declared twice** — a colour in `colors.css`, a `20px` size
  in `typography.css` — and `styles.css` imports the token files alphabetically,
  so typography lands last and wins. `base.css`'s `color:var(--text-body)`
  therefore resolves to `20px`, which is not a colour, and body text falls back
  to black on a near-black ground. Use the `--yarg-`-prefixed originals; they
  have no collisions. Both files are byte-for-byte upstream copies, so this is
  the upstream DS's bug, not a vendoring mistake — worth reporting there.
- **Tailwind v4 tree-shakes against YASS's own source.** `bg-surface-card`,
  `text-content-muted` and `font-numeric` ship; `bg-surface-row`, `rounded-card`
  and `font-display` were never used in `client/src/` and do not exist — and
  unused `@theme` entries are dropped as custom properties too
  (`--color-surface-row` is not even defined). A design agent cannot invent a
  utility. This is why `conventions.md` points at `var(--yarg-*)` as the
  reliable vocabulary and tells it to style its own wrappers inline.

## Component facts worth keeping

- **Only `Button`, `Select` and `TextField` accept a `style` prop** (they spread
  native attributes). `Panel`, `HelperBar`, `AlbumThumb`, `DifficultyRing`,
  `InstrumentStrip` and `SourceBadge` take `className` only; the rest take
  neither. Check the `.d.ts` before reaching for a prop.
- **`GROUP_ART` / `INSTRUMENT_ART` are exported from the bundle** (added during
  this sync). They were always bundled — `PartsGrid` and `InstrumentStrip` reach
  for them internally — but nothing *composing with* the DS could get at them,
  which matters most for `DifficultyRing`, whose centre glyph is `children`.
- **`AlbumThumb` cannot show loaded art in this pipeline.** It returns `null`
  unless `song.hasArt` and the `<img>` loads, and the art URL points at a YASS
  server that is not running during a static capture, so `onError` lands on the
  same `null`. Its cells show the honest empty-slot state. A future sync wanting
  a real cover needs either a running server reachable from the capture browser
  or a `data:` URI swapped in as the source.
- **`Select` and `Panel` have no call sites in `client/src/features/` today.**
  Their previews are plausible compositions built from the app's real sort
  vocabulary and `SongDetail.tsx`'s fact-list markup, not ports of existing code.
- **`SortArrow` direction is easy to state backwards**: the source rotates 180°
  for `asc` (arrow points up) and leaves `desc` unrotated (points down).

## Fixtures and the invention rule

`.design-sync/previews/_fixtures.ts` follows `client/src/mock/library.ts`'s rule
for the same reason: song, artist and album names are invented, and source ids
are real OpenSource ones restricted to YARG's own setlists and community packs
(`yarg`, `yargdlc`, `$DEFAULT$`). Attaching an invented song to a licensed
catalogue id would read as a fabricated record of a real release. The single
exception is `SourceBadge`'s `Registry` cell, which renders registry entries with
no song attached — there, showing licensed ids is honest and shows the range.

## Known render warns

**This sync ends with `package-validate.mjs` exiting 0 and printing no warnings
at all — 19/19 previews render cleanly.** Treat any warn on a re-sync as new.

Two classes were hit and fixed during this run; they are recorded because the
fixes are load-bearing and easy to undo by accident:

- `[RENDER_BLANK]` / `[RENDER_THIN]` fired on **`ChevronRight`** (6x9),
  **`SortArrow`** (9x6) and **`RandomIcon`** (18px) while their previews rendered
  the glyph bare. These are fixed-size icons with no scale prop, and scaling them
  up in isolation would misrepresent the footprint a design agent has to imitate.
  The fix was to render each **in the context it really appears in** — a table
  header row, a disclosure row, inside a `Button` — which cleared the warn
  honestly rather than suppressing it. Do not "simplify" those previews back to a
  bare glyph.
- `[GRID_OVERFLOW]` fired on **`EmptyState`**, **`HelperBar`**, **`Panel`**,
  **`SortArrow`** and **`DifficultyRing`**: their stories are wider than the
  product's grid cell and were being cropped in the card view. Each now carries
  `{"cardMode": "column"}` in `cfg.overrides`, which gives one story per row at
  full card width. This is presentation-only and does not affect grades.

Informational lines that are expected and need no action:

- `[FONT_REMOTE]` for the seven families. `tokens/fonts.css` is upstream's file
  and pulls all seven from Google Fonts; the app itself only imports three. They
  load at runtime and there is nothing to ship.
- `[CSS_RUNTIME]` appears only if `cfg.cssEntry` fails to resolve. If you see it,
  the path is wrong — see the `PKG_DIR` trap above.

## Not a sync problem, but found here

`client/src/App.tsx:815` still tells users *"In YARG: Settings → Export Songs
List → CSV"*, and nearby comments (198, 250, 803, 808) still describe a CSV
export. Per `CLAUDE.md` the library has come from `songcache.bin` since that
switch, so this is user-facing copy pointing at a flow that no longer feeds the
app. Left alone deliberately — out of scope for a design sync.

## Re-sync risks — what can go stale silently

- **The pruned mirror is rebuilt from `vendor/opensource` every run.** If the
  submodule gains icons, `base/` grows and the bundle grows with it; if it is not
  checked out, `mirror-opensource.mjs` fails loudly, which is intended.
- **`cfg.cssEntry` depends on the client build emitting exactly one stylesheet.**
  `prep.mjs` fails with a named error if that stops being true (e.g. CSS
  splitting), rather than silently picking the wrong one.
- **The ground rule and the ASCII fold are appended by `prep.mjs`, not committed.**
  Anyone running `package-build.mjs` without running prep first gets a white-page,
  charset-fragile bundle that still exits 0. Always run `cfg.buildCmd` first.
- **`_fixtures.ts` hardcodes the `Song` shape.** A required field added to
  `shared/src/types.ts` will fail the preview compile — which is the good
  outcome; a field whose *meaning* changes will not, and the cards will quietly
  illustrate the wrong thing.
- **The conventions header names real tokens, utilities and components.** It was
  validated against this build; re-validate after any token re-vendor rather than
  trusting it. `bg-surface-row` / `rounded-card` / `font-display` are named there
  as *absent*, and a future app that starts using them would make that claim
  wrong in the opposite direction.
- **Previews and grades are keyed to the authored `.tsx` and preview-affecting
  config.** Styling and bundle churn do not invalidate them, so a re-sync should
  print `carried forward` for every graded component and clear nothing.
