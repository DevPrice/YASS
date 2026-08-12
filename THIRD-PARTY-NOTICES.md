# Third-party material

YASS itself is released into the public domain — see `LICENSE`. A dedication can
only cover what its author owns, though, and this repository carries a fair
amount of material that came from somewhere else. This file is the inventory:
what it is, where it came from, under what terms, and whether it travels inside
a packaged build.

It is a factual inventory rather than legal advice. If you are redistributing
YASS, and especially if you are selling it, read the upstream terms yourself.

## The short version

| | In the repo | In `YASS.exe` |
|---|---|---|
| YARG design system art and colour tokens | yes | partly — see below |
| OpenSource source-badge registry (`vendor/opensource`) | as a submodule | yes |
| Red Hat Display, Barlow, Inter (woff2) | yes | yes |
| Tables ported or transcribed from YARG's source | yes | yes |
| ffmpeg | no | no — fetched by the user's own machine |
| npm dependencies | lockfile only | the ones the bundles pull in |

Everything else — the server, the client, the tray app, the binary-format
readers, the tests and the documentation — is original to YASS and is covered by
the dedication.

## 1. YARG design system — `client/src/design/`

| | |
|---|---|
| Upstream | `YARG - Design System (Original)`, YARC-Official |
| What | `tokens/*.css` (colour, type, layout, spacing), 8 vector icons, 14 instrument glyphs, 24 difficulty rings |
| Terms | YARC's own artwork and design work. No public licence grant travels with the Figma file, so treat it as reserved to YARC and its contributors unless they say otherwise. |

`client/src/design/README.md` records exactly how each file was exported and
what was changed on the way in. Two details matter for redistribution:

- **Only part of it is in a build.** The 14 instrument glyphs and `icons/random.svg`
  are imported by the client and end up in `client/dist`, and therefore inside
  the packaged executable. The 24 difficulty rings and the other 7 icons sit in
  the repository but are deliberately not globbed — they are reference art for
  geometry that is now drawn in SVG. `client/src/design/assets/index.ts`
  explains why.
- **The source badges are not here at all.** A Figma export of 46 of them once
  was; it was superseded by the OpenSource registry below, and removed from this
  repository's history rather than merely deleted, since game and band logos are
  not something a public repo should carry for no reason.
- **`instruments/band.png` did not come from Figma.** It is YARG's own BAND
  mark, cropped from `YARG/Assets/Art/Menu/Common/InstrumentIcons.png` in the
  game's own source tree.

The colour values in `tokens/colors.css` were transcribed from the same design
file; the CSS that carries them is compiled into every build.

## 2. OpenSource registry — `vendor/opensource`

| | |
|---|---|
| Upstream | <https://github.com/YARC-Official/OpenSource> (git submodule) |
| What | The source registry YARG itself uses: 240 sources, 293 id spellings, 212 icons |
| Terms | The Unlicense, **with an explicit carve-out** — see `vendor/opensource/LICENSE` |

Worth reading that carve-out rather than assuming the headline. YARC dedicates
the registry to the public domain *excluding brand logos and trademarks*, and
states plainly that some icons remain subject to copyright and trademark rights
held by others. Those icons are the game and band logos.

This one does travel: `client/src/lib/sources.ts` globs the icons at build time,
so they are baked into `client/dist` and into the packaged executable. The app
icon and favicon are `base/icons/yarg.png` — YARG's own logo — with
`desktop/scripts/make-icon.mjs` generating `desktop/build/icon.ico` from it.

## 3. Fonts — `desktop/ui/fonts/`

Red Hat Display 800, Barlow 400 and Inter 400, subset to `latin` and
`latin-ext`, fetched from Google Fonts by `desktop/scripts/fetch-fonts.mjs` and
committed so the tray popover renders correctly with no network.

All three are under the **SIL Open Font License 1.1**, reproduced in full with
its copyright notices in `desktop/ui/fonts/OFL.txt`. The OFL requires that
notice and licence to travel with the font files — keep `OFL.txt` beside them in
anything you redistribute.

The web client pulls the same three families from `fonts.googleapis.com` at
runtime instead, so nothing is redistributed there.

## 4. Tables ported or transcribed from YARG

YARG and YARG.Core are licensed **LGPL-3.0**. A few small pieces of this
codebase come from them:

| Here | Upstream | Nature |
|---|---|---|
| `server/src/core/genrelizer.ts` | `Assets/Script/Song/Genrelizer.cs` | A port. `expandAliases` reproduces `_getAllKeys`. |
| `server/src/core/genrelizer.magma.ts` | YARG's Magma value pairs | Transcribed data table |
| `server/src/core/genrelizer.broad.ts` | YARG's broad genre list | Transcribed data table |
| `shared/src/types.ts` (`LIGHTING_EVENTS`) | `LightingEvent.cs` | Enum ordering — the array *is* the wire decode table |
| `server/src/core/art.ts` | `IMAGE_EXTENSIONS` in `YARG.Core/Song/Entries/SongEntry.cs` | File-extension list |
| `client/src/lib/format.ts` (`INTENSITY_NAMES`) | `Assets/StreamingAssets/lang/en-US.json` | Seven tier names, indexed as `FiltersMenu.cs` indexes them |

**The genrelizer files are a port of LGPL-3.0 code, and the public-domain
dedication is not offered for them.** Treat `genrelizer.ts`, `genrelizer.magma.ts`
and `genrelizer.broad.ts` as carrying LGPL-3.0. If that is inconvenient for what
you are building, they are self-contained and replaceable: genre normalisation
degrades to leaving genres exactly as the charter wrote them.

The last three rows are short interop constants — a byte-to-name decode table, a
list of file extensions, seven UI labels — reproduced so that YASS agrees with
the game rather than inventing a second vocabulary. Whether material that thin
carries copyright at all is a judgement call; they are listed here so you can
make it rather than discover it.

**Not derived from YARG:** the readers for `songcache.bin`, STFS/CON, SNG,
`.yargsong`, DTA and `.png_xbox` are original implementations written against
observed file layouts, with YARG named in the comments only as the reference
implementation the behaviour was checked against. `YARG-DATA-FORMATS.md` is an
original description of those formats. All of it is covered by the dedication.

## 5. Fetched at run time, never redistributed

- **ffmpeg** — `server/src/media/ffmpeg.ts` downloads the GyanD/codexffmpeg
  8.1.2 *essentials* build (**GPL-3.0**) on demand, pinned by tag and SHA-256,
  into `%APPDATA%\yass\bin`. Nothing about it is bundled or redistributed by
  this project, and the media features degrade quietly when it is absent. If you
  ever ship it inside a build, the GPL's obligations attach to what you ship.
- **Genrelizer mappings** — read from the YARG installation already on the
  user's machine, under `StreamingAssets`. No copy is kept here.
- **Google Fonts** — the web client's `@import`s, as above.

## 6. npm dependencies

Not vendored; `node_modules/` is not in the repository. Each package carries its
own licence — `package-lock.json` pins the exact versions, and `npm ls` will
enumerate them. Whatever the client and server bundlers pull in ends up in a
build, so run a licence check before shipping a commercial derivative.

## If you ship a binary

Two of the items above carry obligations that follow the build rather than the
repository, so `desktop/electron-builder.yml` puts three files into
`resources/` beside the server and the client:

| File | Why |
|---|---|
| `fonts-OFL.txt` | The OFL requires its notice to travel with the font files, and the popover's woff2 faces are inside the asar. |
| `THIRD-PARTY-NOTICES.md` | This file — the notice for the LGPL-3.0 genrelizer port compiled into the server bundle, and the map to everything else. |
| `LICENSE` | Not required by anything. It costs 2 KB and makes the build self-describing. |

If you repackage YASS some other way, carry those three yourself. For the
LGPL-3.0 portion, the corresponding source is the public repository this build
came from; if you have modified it, point at your fork instead.

## Trademarks

Public-domain dedication moves copyright, not trademarks, and nothing here
grants you rights in anyone's marks.

*YARG* and *YARC* are the names and marks of the YARG project. *Rock Band*,
*Guitar Hero*, *Fortnite Festival* and the rest of the source badges are
trademarks of Harmonix, Activision, Epic Games and their respective owners,
as are the band logos among them. They appear in YASS for one reason: to
identify the source a chart came from, which is the same thing the registry
they come from exists to do.

**YASS is an unofficial project.** It is not affiliated with, endorsed by, or
sponsored by YARC, Harmonix, Activision, Epic Games, or any artist or label
whose name or artwork appears in a song library.
