# YASS — Yet Another Song Selector

A song browser for [YARG](https://yarg.in). Runs on the machine hosting the game and
serves your library to any phone on the network — sortable, filterable, searchable, with
album art, 30-second previews, and whatever is playing right now.

It reads YARG's own files and never writes to them. Scan in YARG and every connected
phone updates itself; there is nothing to export and nothing to keep in sync.

**[Try the demo →](https://devprice.github.io/YASS/)** — the real app, a made-up library,
no install required.

## Running it

Needs Node 20+ and a YARG install that has scanned at least once.

```bash
git clone --recurse-submodules https://github.com/DevPrice/YASS.git
cd YASS
npm install
npm run build
npm start                       # http://localhost:4321
```

Open the address on your phone — the server listens on the LAN, so
`http://<your-lan-ip>:4321` works from anywhere in the house.

If YARG isn't in the default location, set `YASS_YARG_DATA_DIR` to the folder holding
`currentSong.json` and `songcache.bin`. That's the only path there is to set, and usually
it's found for you.

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

### Or use the tray app

A portable Windows executable that puts YASS in the notification area: a QR code with the
address to hand guests, settings behind native file pickers, and the server running
underneath it.

```bash
npm run dist            # -> dist/YASS-0.1.0.exe  (~96 MB, no installer)
```

It's unsigned, so SmartScreen warns on first run. Windows-only for now.

## Configuring it

There's no settings screen in the web app — it's opened by a room full of guests, and
configuration isn't theirs. Use the tray app, or edit
`%APPDATA%/yass/settings.json` (`~/Library/Application Support/yass` on macOS,
`$XDG_CONFIG_HOME/yass` on Linux). The path is printed at startup.

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

## Building it

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
| `npm run dist` | Everything, packaged as a Windows executable |
| `npm test` | Tests, against real captures in `fixtures/` |

**The submodule isn't optional.** `vendor/opensource` is
[YARC-Official/OpenSource](https://github.com/YARC-Official/OpenSource), the registry that
turns a chart's source id into a name and an icon — `rb3dlc` into *Rock Band 3 DLC*. The
build fails without it. `git submodule update --init` if you cloned the plain way.

### The demo

`npm run build:demo` swaps everything behind the network for `client/src/mock/` — 1,650
invented songs, generated cover art, and a simulated now-playing feed. Nothing in it is a
real release or anyone's real library. It's what
[GitHub Pages serves](https://devprice.github.io/YASS/), deployed by
`.github/workflows/pages.yml` on every push that touches the client.

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

[`YARG-DATA-FORMATS.md`](YARG-DATA-FORMATS.md) documents the file formats behind all of
that.

## Licence

Public domain, under [the Unlicense](LICENSE) — take it, sell it, fork it, no attribution
required. That covers our work but not what travels with it: the source badges, the fonts,
YARG's design tokens, and a genre normaliser ported from LGPL-3.0 source.
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) has the details, and is worth reading
before you ship anything commercial.

YASS is unofficial and unaffiliated with YARC, Harmonix, Activision or Epic Games.
