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
comes from YARG's own song index and nothing else.

Point `yargDataDir` at your YARG install — see [Configuration](#configuration) — and open
<http://localhost:5173>. That is the only path there is to set.

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

**That directory holds the settings file and nothing else.** Everything the app can
rebuild — the media cache, a fetched ffmpeg, the server log, Chromium's own state — goes
to `%LOCALAPPDATA%/yass` (Windows), `~/Library/Caches/yass` (macOS), or
`$XDG_CACHE_HOME/yass` (Linux). On Windows that is the difference between a kilobyte and
a couple of gigabytes being copied across the network at every logon of a roaming
profile; ffmpeg is machine-specific besides. Delete the cache directory and YASS loses
only the time to make it again.

Every field has an environment override. Overrides apply to the running process only and
are **never written to the settings file**, so starting once with `YASS_PORT=9999` won't
bake that port into your configuration the next time anything saves.

| Setting | Env var | Notes |
|---|---|---|
| `yargDataDir` | `YASS_YARG_DATA_DIR` | Folder containing `currentSong.json` and `songcache.bin` |
| `pollIntervalMs` | `YASS_POLL_INTERVAL_MS` | Default 10000. Backstop only — see below |
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

There is nothing to configure. The list is read from `songcache.bin` — the index YARG
writes into its data folder every time it scans — which is the same file the app already
used to find each chart on disk for album art.

So adding songs means scanning in YARG and nothing else: the server watches the file and
re-reads it within half a second of a scan, then pushes the new list to every connected
phone.

This replaced a CSV export the user had to produce by hand from Settings → Export Songs
List. One consequence is worth knowing: **nothing is hidden any more.** The export dropped
anything above YARG's Max Song Rating setting, where the cache holds the whole library.

### Genres

The cache stores the genre a charter typed, because YARG normalizes genres *after* writing
it. Left alone that means `Alt Rock`, `Alternative Rock` and `Classicrock` are three
separate rows in a filter, so the server applies the same normalization YARG does —
[Genrelizer](https://github.com/YARC-Official/Genrelizer), a crowdsourced set of mappings
onto the closed list of genres YARG sorts by, with the specific name kept as a subgenre.
`12-Bar Blues` becomes `Blues > 12-Bar Blues`. On a 4,168-song library it takes 131
distinct genres down to 56, matching YARG's own output song for song.

**The mappings are not vendored here.** YARG downloads them into its install directory on
startup, and the server reads that copy — so they are always the ones the game is using.
That folder is *not* under `yargDataDir`, and no path leads from one to the other, so it is
searched for under the YARC Launcher's install root; `YASS_GENRE_MAPPINGS` overrides the
search for a Steam or portable install. If they cannot be found, genres read exactly as
authored and everything else works normally.

YARG's own Genrelizer setting is honoured, read from its `settings.json`: **off** leaves
genres as charted, **genrelize** is the above, and **overgenrelize** collapses everything
into thirteen broad headings with no subgenres.

## The tray app

One portable executable that sits in the notification area, owns configuration behind
native file pickers, and runs the server as a child process. It is the answer to "there
is no settings screen" — the settings screen exists, it just isn't on the LAN.

```bash
npm run dist              # -> dist/YASS-0.1.0.exe  (~96 MB, portable, no installer)
npm run build:desktop     # dev build; then: npx electron desktop/dist/main.js
```

Left-click the icon for the popover. It shows one thing at a time and sizes itself to
it: the address to hand to a guest when the server is up — as a QR code, since the job
is getting a URL into a phone across a loud room — the remedy when the server isn't up,
and the export instruction when the library is empty. The settings sit folded behind a
disclosure, opened for you when a path is wrong. Escape closes it. Right-click for the
menu — restart the server, reload every connected browser, open the app, copy the LAN
address, quit.

Quitting and reloading the guests' browsers are on the menu and not in the window, on
the grounds that a window which cannot be resized should not spend its height on verbs
a menu already carries — least of all the one that stops the music.

`npm start` is untouched. Headless is still a supported way to run this; the tray is a
second front end onto the same server, not a replacement for it.

Three things about it are worth knowing:

- **It writes settings through the running server**, not around it. While the server is
  up, saving goes out as `PUT /api/settings` over loopback, so a new data folder applies
  live and the phones already browsing never notice. Only when the
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
Chromium's own caches are pinned to `%LOCALAPPDATA%\yass\electron\` so they can't land on
top of it — Electron would otherwise default to `%APPDATA%\YASS`, which is the same
directory on a case-insensitive filesystem — and the server's output is kept in
`%LOCALAPPDATA%\yass\logs\server.log`, rotated on each start, so a server that failed to
bind leaves evidence a packaged build would otherwise swallow.

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
| `POST /api/songs/reload` | Force a re-read of the song cache — **host-only**, 404 otherwise |
| `GET /api/now-playing` | Current state, one shot |
| `GET /api/events` | SSE stream: `now-playing`, `library`, `venue`, `reload`, `ping` |
| `GET /api/art/current` | Album art for the playing song, straight off disk |
| `GET /api/art/:hash?size=sm\|lg` | Album art for any song — 256px or 640px WebP |
| `GET /api/preview/:hash` | ~30s Opus preview, with `Range` support |
| `POST /api/media/reindex` | Rebuild the chart index — **host-only**, 404 otherwise |
| `POST /api/media/ffmpeg` | Download ffmpeg — **host-only**, 404 otherwise |
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

YARG rewrites `songcache.bin` every time it scans. The server watches that file and
re-reads it on change, then emits a `library` event on the SSE stream; every connected
phone refetches through a conditional GET, so an unchanged list costs a 304. The same
event rebuilds the chart index behind it, since the songs that just appeared are also the
ones that just gained files on disk.

It watches the *directory* and filters by filename, because a scan replaces the file
rather than appending to it — on Windows a watch bound to the path itself follows the
old inode and goes deaf after the first rewrite. Events are debounced 500ms and confirmed
against size and mtime, since the write is not atomic and fires a burst.

There is deliberately no reload button in the UI. Scanning in YARG is the whole gesture.

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
- **Writes are not atomic** (truncate-then-write, no temp-and-rename), so a read can
  catch a half-written file. We re-read up to three times before believing "nothing
  playing", and a parse failure alone never changes state.
- **Rich text is not stripped** here (unlike `currentSong.txt`). Tags are removed
  using YARG's own tag list, so a title like `I <3 You` survives intact.
- **Absolute chart paths are present** and leak the Windows username. They're used
  server-side to find album art and never sent to the browser.

Sentinels are mapped to `null` on the way in: `-1` for an uncharted instrument,
`int.MaxValue` (`2147483647`) for an unknown year or track number.

**How a change is noticed.** YARG pushes nothing, but the file is on a local disk, so
the directory is watched and the file re-read on write — the banner lands in about a
tenth of a second. A slow poll (`pollIntervalMs`, default 10s) runs underneath as a
backstop, because `fs.watch` on Windows can go deaf without raising an error, and a
watch that dies silently never fires again. The poll notices on its next tick regardless,
which turns "the banner lies for the rest of the party" back into "the banner is late
once". There is no reason to tune it, so it isn't in the tray window.

### Album art and previews

Every song has a cover and a ~30 second preview, in all three chart formats. This is the
feature that found `songcache.bin` in the first place: no export YARG writes says where a
chart *lives*, and the cache does. `server/src/media/` reads it into a `hash → location`
map and everything else follows from it — including, since the song list moved there too,
the list itself.

- **`media/cache.ts`** parses the cache. Every group and entry is length-prefixed, so it
  reads the two or three fields at the head of each and skips the ~90-field metadata
  tail. It refuses any layout version it has not been checked against by hand.
- **`media/scan.ts`** is the fallback: walk the folders from YARG's `settings.json` and
  `SHA1` the chart files, which is exactly how YARG derives the same hashes. Slower, and
  it means a YARG format change costs a slow first scan rather than the feature.
- **`media/{sng,yargsong,con,dxt,dta}.ts`** open the packed formats — the SNG mask, the
  `.yargsong` outer cipher, Xbox STFS block addressing, and the DXT textures inside a CON.
- **ffmpeg** does every resize and every mix. It is fetched once into `%LOCALAPPDATA%\yass\bin`,
  verified against a pinned SHA-256, and cached forever; when it is missing the media
  features stay dark and the client draws what it always drew.

Thumbnails are precomputed for the whole library in the background after startup — about
70 seconds and 67 MB for 4,168 songs — so the list is interactive immediately and the
covers fill in behind it. Previews are generated on demand and kept under an LRU cap,
because 4,168 of them would be ~600 MB for a party that plays thirty songs.

A preview mixes every stem except the crowd, which is what YARG plays: `song.ogg` alone is
the *backing track*, measured 7 dB below the seven-stem sum. The window is ported from
`PreviewContext.cs`, so a preview starts where YARG would start it.

**Previews follow the selection, and start muted.** There is no play button: picking a song
plays its preview on a loop, moving to another song crossfades to it over 600 ms, and
closing the detail fades it out over 400. Two `<audio>` decks, reused forever, feeding two
`GainNode`s through equal-power curves — a `volume` ramp would have been simpler and does
nothing on iOS, where the property is read-only, so it would have faded on every desktop
and cut on every iPhone.

It follows where you *stop*, not where you pass through. Nothing is fetched until the
selection has held still for 300 ms **and** the key is up — a timer alone cannot do this at
any value, because what a held key produces first is not repeat but the repeat *delay*
(250–1000 ms, a setting nobody remembers changing), so any window short enough to keep a
click feeling immediate expires inside it and plays the neighbouring song. `event.repeat`
and `keyup` are the facts that settle it. A run through the list also silences whatever was
playing, since it is a hundred rows nobody chose; a single step keeps it up until the new
song is ready, which is what makes that handover a crossfade rather than a gap.

Measured against this machine's real keyboard timings — 500 ms delay, ~30/s repeat — a
1.5 s hold costs zero requests, one after release.

The one control is a mute toggle on the detail surface, which starts
muted on every device and is remembered per browser once it is changed — and while it is
muted the client requests no audio at all. The default is also what satisfies the autoplay
policy: the only route to sound is the tap that unmutes, which is the user gesture browsers
are asking for. See `client/src/lib/usePreview.ts`.

The typographic plate stays, and is still what a song with no cover gets. It was always
written as a square image slot standing in for a record it did not have a photograph of
yet — so nothing below it moved when the photographs arrived.

## Testing

```bash
npm test
```

Tests run against `fixtures/`, captured from a live YARG install rather than written
from the spec — the schema is unstable enough that real bytes are the only reliable
reference. Re-capture `fixtures/currentSong.playing.json` after a YARG upgrade.

The binary formats under `server/src/media/` are covered by synthetic unit vectors, since
their real inputs cannot be committed: `songcache.bin` bakes in absolute paths carrying
the Windows account name, and the charts are gigabytes of copyrighted music. An opt-in
pass reads a real library instead, and is skipped everywhere else:

```bash
YASS_MEDIA_FIXTURE_YARG_DIR="$LOCALAPPDATA/../LocalLow/YARC/YARG/release" \
npm test --workspace=server
```

It asserts the two claims the features rest on: every song resolves to a chart on disk and
every packed chart re-hashes to what the cache recorded, and the metadata read back out of
the cache is coherent rather than a plausible-looking misalignment.

## Planned

- **Design system.** `client/src/ui/` and the tokens in `client/src/index.css` are
  placeholders. The YARG design system will become the authority; feature components
  are written against the primitives so adopting it is a contained change.
- **Code signing.** The portable executable is unsigned, so Windows SmartScreen warns
  on first run — on every machine, forever, until there's a certificate behind it.
- **macOS and Linux builds.** Nothing in the tray app is Windows-only except the `.ico`
  and the portable target, but only Windows is built and only Windows is tested.
- **Self-hosted fonts in the web client.** `client/src/index.css` still pulls Red Hat
  Display, Barlow and Inter from Google Fonts, so a guest's phone on a LAN with no
  internet renders the client in `system-ui`. The tray's popover vendors all three as
  woff2 (`desktop/ui/fonts/`, regenerated by `desktop/scripts/fetch-fonts.mjs`), so the
  files are already in the repo and this is now a much smaller job than it was.

## Licence

YASS is released into the public domain under [the Unlicense](LICENSE). Take it,
sell it, fork it, no attribution required.

That covers the work that is ours, which is nearly all of it. It cannot cover what
came from elsewhere and travels along: the YARG design system's art and colour
tokens, the source badges from the OpenSource registry — game and band logos, which
YARC's own licence carves out of its dedication — the three vendored fonts under the
SIL OFL, and a genre normaliser ported from YARG's LGPL-3.0 source.
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) itemises every piece of it, says
which ones end up inside a packaged build, and is worth ten minutes before you ship
anything commercial.

YASS is unofficial and unaffiliated with YARC, Harmonix, Activision or Epic Games.
