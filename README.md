# YASS — Yet Another Song Selector

A song browser for [YARG](https://yarg.in). Runs on the machine hosting the game and
serves your library to any phone on the network — sortable, filterable, searchable, with
album art, 30-second previews, and whatever is playing right now.

It reads YARG's own files and never writes to them. Scan in YARG and every connected
phone updates itself; there is nothing to export and nothing to keep in sync.

**[Try the demo →](https://devprice.github.io/YASS/)** — the real app, a made-up library,
no install required.

## Getting it

Download the latest build from the
[releases page](https://github.com/DevPrice/YASS/releases): the `.exe` for Windows, the
`.AppImage` for Linux. It's a single file with nothing to install, and it needs a YARG
that has scanned its songs at least once.

1. Run it on the machine YARG is on. There's no window — it appears in the notification
   area (the system tray, next to the clock).
2. Click the tray icon (on Linux, right-click → *Settings…*). It shows whether the server
   is up, the address to reach it at, and a QR code for that address.
3. Point a phone's camera at the QR code, or type the address in by hand. Anyone on the
   same Wi-Fi can open it — the address looks like `http://192.168.1.24:4321`.

Right-click the icon for the rest: a browser link, the folders YASS writes to, *Quit* —
which stops the server for everyone, not just for you.

A phone that opens the address gets the song list and nothing else: settings are reachable
from the host machine only.

**On Windows**, the build is unsigned, so SmartScreen warns the first time. *More info →
Run anyway.*

**On Linux**, `chmod +x` the AppImage before running it, and two things differ:

- AppImages mount themselves with FUSE, which Ubuntu 24.04 and up no longer ship.
  Either install `libfuse2`, or run it with `--appimage-extract-and-run`.
- ffmpeg — which album art and previews need — is not fetched for you, because the build
  YASS pins is a Windows one. `apt install ffmpeg` (or your distro's equivalent) and
  restart the server. Without it the song list works and the art stays dark.

### If it can't find YARG

YASS looks in the usual place for your OS. If YARG lives somewhere else, point *Settings
→ YARG data folder* at the folder holding `currentSong.json` and `songcache.bin`. That's
the only path there is to set.

<details>
<summary>Default YARG data folders</summary>

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\AppData\LocalLow\YARC\YARG\release` |
| macOS | `~/Library/Application Support/YARC/YARG/release` |
| Linux | `~/.config/unity3d/YARC/YARG/release` |

Swap `release` for `nightly` or `dev` to match your build. If YARG was launched with
`-persistent-data-path`, that path wins and you'll have to set this by hand.
</details>

## Configuring it

There's no settings screen in the web app — it's opened by a room full of guests, and
configuration isn't theirs. Use the tray app, or edit `%APPDATA%/yass/settings.json`
(`~/Library/Application Support/yass` on macOS, `$XDG_CONFIG_HOME/yass` on Linux). The
path is printed at startup and the tray's *Open folder* menu leads to it.

Each setting has an environment override, which applies to that run only and is never
written to the file:

| Setting | Env var | Default |
|---|---|---|
| `yargDataDir` | `YASS_YARG_DATA_DIR` | Auto-detected — see above |
| `host` | `YASS_HOST` | `0.0.0.0` |
| `port` | `YASS_PORT` | `4321` |
| `pollIntervalMs` | `YASS_POLL_INTERVAL_MS` | `10000` |
| — | `YASS_FFMPEG` | Fetched on demand |
| — | `YASS_GENRE_MAPPINGS` | Found in YARG's install |

## Notes

- **The library comes from `songcache.bin`**, the index YARG writes when it scans. The
  server watches that file, so a scan reaches every phone in about half a second. Nothing
  is filtered out, including songs above YARG's Max Song Rating.
- **Album art and previews are read straight out of the charts** — SNG, `.yargsong` and
  CON all work. ffmpeg does the decoding; it's downloaded once and cached. Without it
  those features stay dark and everything else is fine.
- **Genres are normalized the way YARG normalizes them**, using the same
  [Genrelizer](https://github.com/YARC-Official/Genrelizer) mappings the game downloads,
  so `Alt Rock` and `Alternative Rock` stop being separate filters.
- **The banner can pick up YARG's stage lighting.** Turn on *Settings → Experimental →
  Other → Enable UDP data stream* and the now-playing banner tints to match the venue.
  Nothing flashes, and it's off under `prefers-reduced-motion`.

## Building it

Needs Node 20+ to run, and Node 22+ to run the tests.

```bash
git clone --recurse-submodules https://github.com/DevPrice/YASS.git
cd YASS
npm install
npm run build
npm start                       # http://localhost:4321
```

That's the server on its own, without the tray. `npm run dist` packages the tray app for
the platform you're on, into `dist/` — `YASS.exe` on Windows (~82 MB), `YASS.AppImage` on
Linux.

```
client/   Vite + React 19 + Tailwind 4
server/   Hono on Node — the API, and in production the client too
desktop/  Electron tray app
shared/   Types used by both
```

| Command | Does |
|---|---|
| `npm run dev` | Client on :5173, API on :4321 |
| `npm run build` | Client and server |
| `npm start` | The built server, one process, one port |
| `npm run dev:demo` | The serverless demo, locally |
| `npm run build:demo` | The demo as a static site in `client/dist` |
| `npm run dist` | Everything, packaged for the platform you're on |
| `npm test` | Tests, against real captures in `fixtures/` |

**The submodule isn't optional.** `vendor/opensource` is
[YARC-Official/OpenSource](https://github.com/YARC-Official/OpenSource), the registry that
turns a chart's source id into a name and an icon — `rb3dlc` into *Rock Band 3 DLC*. The
build fails without it. `git submodule update --init` if you cloned the plain way.

[`YARG-DATA-FORMATS.md`](YARG-DATA-FORMATS.md) documents the file formats behind the
library, the art and the now-playing feed.

### The demo

`npm run build:demo` swaps everything behind the network for `client/src/mock/` — 1,650
invented songs, generated cover art, and a simulated now-playing feed. Nothing in it is a
real release or anyone's real library. It's what
[GitHub Pages serves](https://devprice.github.io/YASS/), deployed by
`.github/workflows/pages.yml` on every push that touches the client.

## Licence

Public domain, under [the Unlicense](LICENSE) — take it, sell it, fork it, no attribution
required. That covers our work but not what travels with it: the source badges, the fonts,
YARG's design tokens, and a genre normaliser ported from LGPL-3.0 source.
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) has the details, and is worth reading
before you ship anything commercial.

YASS is unofficial and unaffiliated with YARC, Harmonix, Activision or Epic Games.
