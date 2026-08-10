# YASS — Yet Another Song Selector

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

Set the two paths described under [Configuration](#configuration) before the first run —
there is no settings screen, deliberately — then open <http://localhost:5173>.

For a production run:

```bash
npm run build
npm start            # single process, single port
```

## Configuration

**There is no settings screen.** Edit the file or set the environment variables below.

The app is opened by a room full of guests, and configuration is not something they
should be able to find. It was host-only before — `/api/settings` 404s for anyone whose
request didn't arrive over loopback without proxy headers, and it still does — but that
check was the last line of the argument rather than the whole of it, and it put the one
control that acts on the host's machine into the same UI as the song list. Configuration
belongs to the tray app, and until that exists it belongs to a text editor.

The endpoints remain for the tray process to use. Nothing in the browser calls them.

Settings live in `%APPDATA%/yass/settings.json` (Windows), `~/Library/Application
Support/yass` (macOS), or `$XDG_CONFIG_HOME/yass` (Linux) — outside the repo, so a
packaged build behaves like a dev run. The path is printed at startup, along with any
complaint about what it found there.

Every field has an environment override. Overrides apply to the running process only and
are **never written to the settings file**, so starting once with `YASS_PORT=9999` won't
bake that port into your configuration the next time anything saves.

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

It is a snapshot, but not a stale one: the server watches the file and re-reads it
within half a second of a re-export, then pushes the new list to every connected phone.
Adding songs to YARG means exporting again and nothing else.

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
| `POST /api/songs/reload` | Force a re-read of the CSV — **host-only**, 404 otherwise |
| `GET /api/now-playing` | Current state, one shot |
| `GET /api/events` | SSE stream: `now-playing`, `library`, `ping` |
| `GET /api/art/current` | Album art for the playing song |
| `GET /api/capabilities` | Whether this caller is the host — no browser consumer, kept for the tray |
| `GET /api/settings` · `PUT /api/settings` | Read/write configuration — **host-only**, 404 otherwise |

The last three exist for the tray process. The browser client binds none of them: it
reads the library, the now-playing state and the event stream, and nothing else.

### The song list reloads itself

The CSV is a snapshot YARG writes only when someone picks Settings → Export Songs
List, so it goes stale silently. The server watches the file and re-reads it on change,
then emits a `library` event on the SSE stream; every connected phone refetches through
a conditional GET, so an unchanged list costs a 304.

It watches the *directory* and filters by filename, because an export replaces the file
rather than appending to it — on Windows a watch bound to the path itself follows the
old inode and goes deaf after the first export. Events are debounced 500ms and confirmed
against size and mtime, since a CSV write is not atomic and fires a burst.

There is deliberately no reload button in the UI. Re-exporting from YARG is the whole
gesture.

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
