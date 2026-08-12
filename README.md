# YASS — Yet Another Song Selector

A web app that runs alongside a [YARG](https://yarg.in) install and shows your song
library as a sortable, filterable, searchable list, with album art, ~30 second previews,
and whatever is currently playing. Built to be opened from a phone on the LAN, so a room
full of guests can browse the library on their own screens.

It reads YARG's own files and never writes to them. There is nothing to export and nothing
to keep in sync: scan in YARG, and the list updates on every connected phone within half a
second.

**[Try the demo →](https://devprice.github.io/yass/)** — the real client with a synthetic
library, no YARG install required. See [The demo build](#the-demo-build).

## Requirements

- Node.js 20 or newer
- A YARG install that has scanned its library at least once
- Windows, macOS or Linux for the server; the tray app is built and tested on Windows only

## Quick start

```bash
git clone --recurse-submodules <repo-url>
cd yass
npm install
npm run dev                      # Vite on :5173, API on :4321
```

If you already cloned without `--recurse-submodules`, run `git submodule update --init`.
**The submodule is not optional.** `vendor/opensource` is
[YARC-Official/OpenSource](https://github.com/YARC-Official/OpenSource), the public-domain
registry YARG uses to turn a chart's internal source id into a name and an icon — `rb3dlc`
into *Rock Band 3 DLC*. Without it the client build fails on a missing
`@opensource/base/index.json`. It is a build-time dependency only; nothing reads it at
runtime.

Open <http://localhost:5173>. If your YARG data folder isn't in the default location, set
`yargDataDir` — see [Configuration](#configuration). That is the only path there is to set.

For a production run:

```bash
npm run build
npm start            # single process, single port — http://localhost:4321
```

The server binds `0.0.0.0` by default, so the app is reachable from other devices on the
network at `http://<your-lan-ip>:4321`.

## The tray app

One portable executable that sits in the notification area, owns configuration behind
native file pickers, and runs the server as a child process. It is where the settings
screen lives — deliberately not on the LAN, where guests could find it.

```bash
npm run dist              # -> dist/YASS-0.1.0.exe  (~96 MB, portable, no installer)
npm run build:desktop     # dev build; then: npx electron desktop/dist/main.js
```

Left-click the icon for the popover. It shows one thing at a time: the address to hand to
a guest as a QR code when the server is up, the remedy when it isn't, and the export
instruction when the library is empty. Settings sit behind a disclosure, opened for you
when a path is wrong. Escape closes it. Right-click for the menu — restart the server,
reload every connected browser, open the app, copy the LAN address, quit.

Only `host` and `port` need a restart to take effect; everything else applies live to
phones already browsing. The server runs as an Electron `utilityProcess`, so killing the
tray from Task Manager takes the server with it rather than leaving an invisible process
holding port 4321.

The executable is unsigned, so Windows SmartScreen warns on first run.

`npm start` is untouched — headless is a fully supported way to run this.

## Configuration

**There is no settings screen in the web app.** Use the tray app, edit the file, or set
the environment variables below. The write endpoints are host-only: `/api/settings` 404s
for any request that didn't arrive over loopback.

Settings live in `%APPDATA%/yass/settings.json` (Windows), `~/Library/Application
Support/yass` (macOS), or `$XDG_CONFIG_HOME/yass` (Linux). The path is printed at startup,
along with any complaint about what it found there.

Everything the app can rebuild — the media cache, a fetched ffmpeg, the server log,
Chromium's own state — goes to `%LOCALAPPDATA%/yass` (Windows), `~/Library/Caches/yass`
(macOS), or `$XDG_CACHE_HOME/yass` (Linux) instead. Delete that directory and YASS loses
only the time to make it again.

Every field has an environment override. Overrides apply to the running process only and
are **never written to the settings file**, so starting once with `YASS_PORT=9999` won't
bake that port into your configuration.

| Setting | Env var | Notes |
|---|---|---|
| `yargDataDir` | `YASS_YARG_DATA_DIR` | Folder containing `currentSong.json` and `songcache.bin` |
| `pollIntervalMs` | `YASS_POLL_INTERVAL_MS` | Default 10000. Backstop for the file watcher |
| `host` | `YASS_HOST` | Default `0.0.0.0` (LAN-accessible) |
| `port` | `YASS_PORT` | Default 4321 |
| — | `YASS_GENRE_MAPPINGS` | Path to YARG's Genrelizer mappings, if auto-discovery fails |
| — | `YASS_FFMPEG` | Absolute path to an ffmpeg binary, instead of the one YASS fetches |

### The YARG data folder

Defaults to Unity's `persistentDataPath` plus the build channel:

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\AppData\LocalLow\YARC\YARG\release` |
| macOS | `~/Library/Application Support/YARC/YARG/release` |
| Linux | `~/.config/unity3d/YARC/YARG/release` |

Swap `release` for `nightly` or `dev` to match your build. If YARG was launched with
`-persistent-data-path` (the YARC Launcher may do this), that path wins and you must set
`yargDataDir` manually.

## What it does

**The song list reloads itself.** The list is read from `songcache.bin`, the index YARG
writes every time it scans. The server watches that file and re-reads it within half a
second of a scan, then pushes the new list to every connected phone. Adding songs means
scanning in YARG and nothing else — there is deliberately no reload button. Note that
nothing is hidden: the cache holds the whole library, including songs above YARG's Max
Song Rating setting.

**Genres are normalized the way YARG normalizes them.** The cache stores the genre a
charter typed, so `Alt Rock`, `Alternative Rock` and `Classicrock` would otherwise be
three separate filter rows. The server applies
[Genrelizer](https://github.com/YARC-Official/Genrelizer) — the same crowdsourced mappings
YARG uses — keeping the specific name as a subgenre: `12-Bar Blues` becomes
`Blues > 12-Bar Blues`. On a 4,168-song library that takes 131 genres down to 56. The
mappings aren't vendored; YARG downloads them into its install directory and the server
reads that copy, so they're always the ones the game is using. Your Genrelizer setting is
honoured (**off**, **genrelize**, **overgenrelize**). If the mappings can't be found,
genres read exactly as authored.

**Album art and previews, in all three chart formats.** `server/src/media/` uses
`songcache.bin` to map each hash to a chart on disk, then opens the packed formats
directly — the SNG mask, the `.yargsong` cipher, Xbox STFS block addressing, DXT textures
inside a CON. ffmpeg does every resize and mix; it's fetched once into
`%LOCALAPPDATA%\yass\bin`, verified against a pinned SHA-256, and cached. When it's
missing, the media features stay dark and everything else works. Thumbnails are
precomputed in the background after startup (about 70 seconds and 67 MB for 4,168 songs);
previews are generated on demand under an LRU cap.

Previews follow the selection rather than a play button: picking a song plays its preview
on a loop, moving to another crossfades over 600 ms, and closing the detail fades out.
Nothing is fetched until the selection has held still, so running through the list costs
no requests. The one control is a mute toggle, which starts muted on every device and is
remembered per browser — while muted, the client requests no audio at all. A preview mixes
every stem except the crowd and starts where YARG would start it.

**The banner picks up YARG's stage lighting.** Optional, and off unless you enable it in
YARG: *Settings → Experimental → Other → **Enable UDP data stream***. That is the same
broadcast [YALCY](https://github.com/YARC-Official/YALCY) consumes to drive real lights;
YASS listens to it and tints the now-playing banner to match the venue. The socket binds
with `SO_REUSEADDR`, so running YASS does not cost you YALCY. Cues map to the set of
colours lit during them and the wash drifts between them at the song's tempo. Nothing in
the app flashes — the publisher is capped at two events per second, which puts it
structurally below the WCAG 2.3.1 threshold — and under `prefers-reduced-motion` the tint
doesn't render at all. If YARG never broadcasts, the UI is exactly what it was before.

## Building

| Command | Result |
|---|---|
| `npm run dev` | Vite dev server on :5173, API on :4321 |
| `npm run build` | Client + server into `client/dist` and `server/dist` |
| `npm start` | Run the built server — API and client on one port |
| `npm run dev:demo` | The serverless demo on the dev server |
| `npm run build:demo` | The demo as a static site in `client/dist` |
| `npm run build:desktop` | The tray app into `desktop/dist` |
| `npm run dist` | Everything, packaged into `dist/YASS-0.1.0.exe` |
| `npm run typecheck` | `tsc --noEmit` across all three workspaces |
| `npm test` | All tests |

### The demo build

**<https://devprice.github.io/yass/>**

A serverless build of the client, for showing the app to somebody who does not have YARG,
a library, or any interest in installing either. It is the real client — the real hooks,
components, filtering and sorting — with `client/src/mock/` standing in for everything
behind the network:

- **`library.ts`** invents 1,650 songs across ~270 bands from word banks. Nothing is a
  real release and nothing is anyone's actual library. Two things in it *are* real,
  because they're what the UI resolves rather than displays: the source ids come from the
  OpenSource registry so badges resolve to real icons, and genres are spelled the way
  Genrelizer spells them.
- **`art.ts`** draws a cover per song — an abstract SVG data URI seeded by the song's hash.
- **`backend.ts`** replaces `fetch` and `EventSource` and runs a simulated now-playing
  feed, so the banner, the venue wash and the route from banner into song details can all
  be demoed.
- **`notice.ts`** says on screen that this is a demo, once per session.

The library is generated from one fixed seed, so it's identical in every browser and on
every load — which is what keeps a link copied out of the demo working, since the view
(including the selected song) lives in the query string.

Previews are the one feature the demo doesn't have. No audio ships with it, so every song
reports `hasPreview: false`, which hides the sound control exactly as it does on a machine
with no ffmpeg.

**None of this reaches a normal build.** `vite.config.ts` defines `import.meta.env.VITE_MOCK`
as a literal, so outside `--mode mock` every branch reaching `src/mock/` is dead code and
Rollup drops the modules with it:

```bash
npm run build --workspace=client
grep -c "bramblecast" client/dist/assets/index-*.js   # 0
```

`.github/workflows/pages.yml` builds the demo and deploys it to GitHub Pages on a push to
`master` that touches the client, or on demand from the Actions tab. Pages has to be
pointed at Actions once by hand: Settings → Pages → Build and deployment → Source →
GitHub Actions. Assets are built with a relative `base`, so the site works from
`/<repo>/` without the repository name being configured anywhere.

## Architecture

```
client/   Vite + React 19 + Tailwind 4 SPA
server/   Hono on Node — JSON API and, in production, the built client
desktop/  Electron tray app: the host's settings UI, and the server's parent process
shared/   Types used by both (aliased as @shared/*, not an npm workspace)
fixtures/ Real captures from a live YARG install, used by the tests
vendor/   The OpenSource registry submodule
```

One process serves the API under `/api` and the client everywhere else, so a reverse proxy
needs a single upstream. All client URLs are relative.

[`YARG-DATA-FORMATS.md`](YARG-DATA-FORMATS.md) documents the file formats this app reads.

### API

| Route | Purpose |
|---|---|
| `GET /api/songs` | Full library + facets + metadata (ETag-cached) |
| `POST /api/songs/reload` | Force a re-read of the song cache — **host-only**, 404 otherwise |
| `GET /api/now-playing` | Current state, one shot |
| `GET /api/events` | SSE stream: `now-playing`, `library`, `venue`, `reload`, `ping` |
| `GET /api/art/current` | Album art for the playing song |
| `GET /api/art/:hash?size=sm\|lg` | Album art for any song — 256px or 640px WebP |
| `GET /api/preview/:hash` | ~30s Opus preview, with `Range` support |
| `POST /api/media/reindex` | Rebuild the chart index — **host-only**, 404 otherwise |
| `POST /api/media/ffmpeg` | Download ffmpeg — **host-only**, 404 otherwise |
| `GET /api/health` | Liveness, unauthenticated |
| `GET /api/capabilities` | Whether this caller is the host |
| `GET /api/status` | Song count, bound address, restart-required — **host-only**, 404 otherwise |
| `POST /api/clients/reload` | Tell every connected browser to reload — **host-only**, 404 otherwise |
| `GET /api/settings` · `PUT /api/settings` | Read/write configuration — **host-only**, 404 otherwise |

The host-only routes exist for the tray process. The browser client binds none of them: it
reads the library, the now-playing state and the event stream, and nothing else. The one
thing the tray can push at a guest's phone is a page reload, and even that arrives as an
event on the stream the phone already holds.

Absolute chart paths from YARG's files leak the Windows username. They're used server-side
to find album art and are never sent to the browser.

## Testing

```bash
npm test
```

Tests run against `fixtures/`, captured from a live YARG install rather than written from
the spec — the schema is unstable enough that real bytes are the only reliable reference.
Re-capture `fixtures/currentSong.playing.json` after a YARG upgrade.

The binary formats under `server/src/media/` are covered by synthetic unit vectors, since
their real inputs can't be committed: `songcache.bin` bakes in absolute paths carrying the
Windows account name, and the charts are gigabytes of copyrighted music. An opt-in pass
reads a real library instead, and is skipped everywhere else:

```bash
YASS_MEDIA_FIXTURE_YARG_DIR="$LOCALAPPDATA/../LocalLow/YARC/YARG/release" \
npm test --workspace=server
```

It asserts the two claims the media features rest on: every song resolves to a chart on
disk and every packed chart re-hashes to what the cache recorded, and the metadata read
back out of the cache is coherent rather than a plausible-looking misalignment.

## Licence

YASS is released into the public domain under [the Unlicense](LICENSE). Take it, sell it,
fork it, no attribution required.

That covers the work that is ours, which is nearly all of it. It cannot cover what came
from elsewhere and travels along: the YARG design system's art and colour tokens, the
source badges from the OpenSource registry — game and band logos, which YARC's own licence
carves out of its dedication — the three vendored fonts under the SIL OFL, and a genre
normaliser ported from YARG's LGPL-3.0 source.
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) itemises every piece of it, says which
ones end up inside a packaged build, and is worth ten minutes before you ship anything
commercial.

YASS is unofficial and unaffiliated with YARC, Harmonix, Activision or Epic Games.
