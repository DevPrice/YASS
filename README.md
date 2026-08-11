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

**There is no settings screen in the web app.** Use the tray app, or edit the file, or
set the environment variables below.

The app is opened by a room full of guests, and configuration is not something they
should be able to find. It was host-only before — `/api/settings` 404s for anyone whose
request didn't arrive over loopback without proxy headers, and it still does — but that
check was the last line of the argument rather than the whole of it, and it put the one
control that acts on the host's machine into the same UI as the song list. Configuration
belongs to the tray app, which is what [`desktop/`](#the-tray-app) now is.

Those endpoints exist for the tray process. Nothing in the browser calls them.

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

## The tray app

One portable executable that sits in the notification area, owns configuration behind
native file pickers, and runs the server as a child process. It is the answer to "there
is no settings screen" — the settings screen exists, it just isn't on the LAN.

```bash
npm run dist              # -> dist/YASS-0.1.0.exe  (~96 MB, portable, no installer)
npm run build:desktop     # dev build; then: npx electron desktop/dist/main.js
```

Left-click the icon for the popover: server status, the LAN addresses to hand to a
guest, the loaded song count, and the settings form. Right-click for the menu —
restart the server, reload every connected browser, open the app, copy the LAN address,
quit.

`npm start` is untouched. Headless is still a supported way to run this; the tray is a
second front end onto the same server, not a replacement for it.

Three things about it are worth knowing:

- **It writes settings through the running server**, not around it. While the server is
  up, saving goes out as `PUT /api/settings` over loopback, so a new song list or poll
  interval applies live and the phones already browsing never notice. Only when the
  server is down does the tray write the file itself. The two writers are mutually
  exclusive by construction, and both run the same `normalizeSettings`.
- **Only `host` and `port` need a restart**, because only the listening socket is fixed
  for the life of the process. The popover says so when they change, rather than saving
  a port that silently isn't in force.
- **The server child is a `utilityProcess`**, which ties its lifetime to the app at the
  OS level. Kill the tray from Task Manager and the server goes with it — on Windows a
  plain child would survive, and an invisible process holding port 4321 is the worst
  failure this app could have.

Configuration still lives in `%APPDATA%\yass\settings.json`; the tray only edits it.
Chromium's own caches are pinned to `%APPDATA%\yass\electron\` so they can't land on top
of it, and the server's output is kept in `%APPDATA%\yass\logs\server.log` — rotated on
each start, so a server that failed to bind leaves evidence a packaged build would
otherwise swallow.

The tray and executable wear YARG's own logo, generated from the OpenSource submodule at
build time. It is public domain and unmistakably the right subject, but it is YARG's
identity rather than YASS's — a mark of its own is the honest end state.

## Architecture

```
client/   Vite + React 19 + Tailwind 4 SPA
server/   Hono on Node — JSON API and, in production, the built client
desktop/  Electron tray app: the host's settings UI, and the server's parent process
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
| `GET /api/events` | SSE stream: `now-playing`, `library`, `venue`, `reload`, `ping` |
| `GET /api/art/current` | Album art for the playing song |
| `GET /api/health` | Liveness, unauthenticated — how the tray knows the bind succeeded |
| `GET /api/capabilities` | Whether this caller is the host — no browser consumer, kept for the tray |
| `GET /api/status` | Song count, bound address, restart-required — **host-only**, 404 otherwise |
| `POST /api/clients/reload` | Tell every connected browser to reload — **host-only**, 404 otherwise |
| `GET /api/settings` · `PUT /api/settings` | Read/write configuration — **host-only**, 404 otherwise |

The host-only four exist for the tray process. The browser client binds none of them: it
reads the library, the now-playing state and the event stream, and nothing else. The one
thing the tray can push at a guest's phone is a page reload, and even that arrives as an
event on the stream the phone already holds.

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

### The banner picks up YARG's stage lighting

**Optional, and off unless you turn it on in YARG:** *Settings → Experimental →
Other → **Enable UDP data stream***. That is the feed [YALCY](https://github.com/YARC-Official/YALCY)
consumes to drive real lights. We listen to the same broadcast and tint the
now-playing banner to match the venue — warm when the stage goes warm, blue when
it goes cool, nothing at all during a blackout.

**A cue is a palette, not a colour.** `coolAutomatic` is a blue chase running
against a green counter-chase; `harmony` rotates four. Cues also change slowly —
measured against a live chart, roughly every ten seconds — so mapping each one to
a single swatch left the banner sitting on one colour for a whole verse. Instead
each cue maps to the set of colours lit during it, and the wash drifts between
them every eight beats, at the song's own tempo. The fade is exactly as long as
the gap, so the colour is always moving and never switches.

It is a real broadcast to `255.255.255.255:36107`, not a unicast, so binding with
`SO_REUSEADDR` means YASS and YALCY can both receive it. Running one does not
cost you the other.

Three deliberate reductions, because the source is a firehose aimed at hardware
and the destination is a phone in someone's hand:

- **88 packets a second become at most two.** The server decodes each datagram
  but publishes only on a real change, and never more than twice a second. In
  practice a song produces a couple of events every twenty seconds.
- **Only five fields cross the wire.** Cue, colour grade, song section, tempo,
  and whether the stream is alive. The packet also carries note bitfields, vocal
  pitch, camera cuts and star power; none of that is any of a song browser's
  business. Tempo gets a deadband on the way out — YARG derives it from note
  timing, so it wanders several BPM packet to packet, and untreated it would peg
  the publisher at its ceiling all song.
- **The strobe field is read and dropped.** Nothing in this app flashes. The
  twice-a-second publish ceiling makes that structural rather than a promise —
  a change rate that could reach the three-per-second threshold in WCAG 2.3.1 is
  not expressible. Under `prefers-reduced-motion` the tint doesn't render at all.

Every field we read sits below byte 36, which is the part of the layout that has
not moved since datagram version 3, so v3/v4/v5 senders all parse with one set of
offsets. A version byte above 5 is refused rather than guessed at. If YARG never
broadcasts, `streaming` stays false and the UI is exactly what it was before.

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

Until then the song detail view fills the art slot with the song's own title, set large
in the display face over the selected-row wash. Four thousand identical grey discs would
have been the honest answer to "we don't have this" and the wrong one; a typographic
plate is still a placeholder, but it is a placeholder that tells you what you tapped.

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
- **Code signing.** The portable executable is unsigned, so Windows SmartScreen warns
  on first run — on every machine, forever, until there's a certificate behind it.
- **macOS and Linux builds.** Nothing in the tray app is Windows-only except the `.ico`
  and the portable target, but only Windows is built and only Windows is tested.
- **Self-hosted fonts.** `client/src/index.css` still pulls Red Hat Display, Barlow and
  Inter from Google Fonts, so an offline machine renders the web client in `system-ui`.
  The tray's popover already declines those imports for exactly that reason; vendoring
  the three as woff2 would fix both.
