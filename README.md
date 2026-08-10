# YASS — YARG Song Search

A web app that runs alongside a [YARG](https://yarg.in) install and shows your song
library as a sortable, filterable, searchable list, plus whatever is currently
playing. Built to be opened from a phone on the LAN.

> **Queueing is not implemented and no queue code should be added yet.** Whether to
> lean on existing karaoke/music-queue technology (OpenKJ, Karaoke Mugen, MPD,
> OpenSubsonic jukebox mode) is an open question that needs research first.

## Quick start

```bash
git submodule update --init      # source icons — see below
npm install
npm run dev                      # Vite on :5173, API on :4321
```

**The submodule is not optional.** `vendor/opensource` is
[YARC-Official/OpenSource](https://github.com/YARC-Official/OpenSource), the public-domain
registry YARG itself uses to turn a chart's internal source id into a name and an icon —
`rb3dlc` into *Rock Band 3 DLC*. Without it the client build fails to resolve
`@opensource/...`, which is deliberate: a silent fallback would mean every source in the
library rendering as a raw id again. Clone with `--recurse-submodules` to skip the extra
step.

It is a build-time dependency only. Nothing reads it at runtime, and the song list itself
still comes from the YARG CSV export and nothing else.

Then open <http://localhost:5173> **on the machine running the server**, go to
**Settings**, and fill in the two paths described below.

For a production run:

```bash
npm run build
npm start            # single process, single port
```

## Configuration

**Settings are host-only.** The settings screen and `/api/settings` are available only
to a browser on the machine running the server; everyone else gets a 404 and never sees
the tab. Two reasons: the responses carry absolute filesystem paths that name your user
account, and nobody wants a guest repointing the app mid-party.

A reverse proxy connects over loopback, so any request carrying proxy headers
(`X-Forwarded-For` and friends) counts as remote. That means reaching YASS through your
own domain also hides settings — deliberately, since the alternative fails open and
exposes configuration to the whole LAN.

Configuration will move to the tray app when that exists. Until then, use the settings
screen on the host, edit the file directly, or set environment variables.

Settings live in `%APPDATA%/yass/settings.json` (Windows), `~/Library/Application
Support/yass` (macOS), or `$XDG_CONFIG_HOME/yass` (Linux) — outside the repo, so a
packaged build behaves like a dev run. The path is printed at startup.

Every field has an environment override. Overrides apply to the running process only and
are **never written to the settings file**, so starting once with `YASS_PORT=9999` won't
bake that port into your configuration the next time anything saves. The settings screen
flags any field an environment variable is currently forcing.

| Setting | Env var | Notes |
|---|---|---|
| `yargDataDir` | `YASS_YARG_DATA_DIR` | Folder containing `currentSong.json` |
| `songListCsvPath` | `YASS_SONG_LIST_CSV` | Your CSV export (see below) |
| `pollIntervalMs` | `YASS_POLL_INTERVAL_MS` | Default 1000 |
| `host` | `YASS_HOST` | Default `0.0.0.0` (LAN-accessible) |
| `port` | `YASS_PORT` | Default 4321 |

### The YARG data folder

Defaults to Unity's `persistentDataPath` plus the build channel:

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\AppData\LocalLow\YARC\YARG\release` |
| macOS | `~/Library/Application Support/YARC/YARG/release` |
| Linux | `~/.config/unity3d/YARC/YARG/release` |

Swap `release` for `nightly` or `dev` to match your build. If YARG was launched with
`-persistent-data-path` (the YARC Launcher may do this), that path wins and you must
set it here manually.

### The song list

**In YARG: Settings → Export Songs List → CSV**, save it anywhere, then point
`songListCsvPath` at it.

CSV is the only export format carrying the song hash, which is what links a library
row to the currently playing song.

This is a **snapshot**. YARG never publishes the library on its own, so the list goes
stale when you add songs — re-export and hit **Reload**. The header shows when the
file was last written.

## Architecture

```
client/   Vite + React 19 + Tailwind 4 SPA
server/   Hono on Node — JSON API and, in production, the built client
shared/   Types used by both (aliased as @shared/*, not an npm workspace)
fixtures/ Real captures from a live YARG install, used by the tests
```

One process serves the API under `/api` and the client everywhere else, so a reverse
proxy needs a single upstream. All client URLs are relative.

### API

| Route | Purpose |
|---|---|
| `GET /api/songs` | Full library + facets + metadata (ETag-cached) |
| `POST /api/songs/reload` | Re-read the CSV from disk |
| `GET /api/now-playing` | Current state, one shot |
| `GET /api/now-playing/stream` | SSE stream of changes |
| `GET /api/art/current` | Album art for the playing song |
| `GET /api/capabilities` | What this caller may do (drives whether a settings tab renders) |
| `GET /api/settings` · `PUT /api/settings` | Read/write configuration — **host-only**, 404 otherwise |

### Reading `currentSong.json` safely

This file is an accidental API — a reflection dump of an internal YARG class, with a
`TODO` in YARG's own source about replacing it. The parser is defensive about four
behaviors, each verified against a live capture:

- **Blank means "in menus", not an error.** YARG writes an empty string whenever the
  scene isn't gameplay. `JSON.parse("")` throws.
- **Writes are not atomic** (truncate-then-write, no temp-and-rename), so a poll can
  catch a half-written file. We re-read up to three times before believing "nothing
  playing", and a parse failure alone never changes state.
- **Rich text is not stripped** here (unlike `currentSong.txt`). Tags are removed
  using YARG's own tag list, so a title like `I <3 You` survives intact.
- **Absolute chart paths are present** and leak the Windows username. They're used
  server-side to find album art and never sent to the browser.

Sentinels are mapped to `null` on the way in: `-1` for an uncharted instrument,
`int.MaxValue` (`2147483647`) for an unknown year or track number.

### Album art

Only the **currently playing** song has art today, because the CSV export has no path
column and art lives next to the chart. Packed containers (`.sng`/`.yargsong`, CON)
keep art inside the archive and fall back to a placeholder.

Library-list art needs chart paths, which arrive with the YARG-side index below.

## Testing

```bash
npm test
```

Tests run against `fixtures/`, captured from a live YARG install rather than written
from the spec — the schema is unstable enough that real bytes are the only reliable
reference. Re-capture `fixtures/currentSong.playing.json` after a YARG upgrade.

## Planned

- **Publish the song index from YARG.** The intended replacement for the manual CSV:
  patch YARG to write a JSON index after each scan. That uses YARG's real scanner, so
  it covers `.sng` and CON charts, carries hashes and chart paths (enabling
  library-wide album art), and never goes stale. `loadLibraryFromCsv` is isolated
  behind the `SongLibrary` type precisely so this is a drop-in swap.
- **Design system.** `client/src/ui/` and the tokens in `client/src/index.css` are
  placeholders. The YARG design system will become the authority; feature components
  are written against the primitives so adopting it is a contained change.
- **Tray app owns configuration.** Including a native file picker for the two paths,
  which is why there's no Browse button in the web UI — a browser can't read a real
  filesystem path, and a picker triggered from a phone would open a dialog on the host.
- **Distribution.** An installer with a system-tray executable. The server bundles to
  a single dependency-free `dist/index.js` and resolves paths without relying on
  `cwd`, so it can be wrapped as a Node SEA, or an Electron/Tauri sidecar. Windows
  first, but nothing is Windows-only.
