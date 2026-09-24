# YASS: Yet Another Song Selector

YASS is a song browser for [YARG](https://yarg.in). It runs on the computer that hosts the
game and serves your song library to phones on the same network. Guests can sort, filter,
and search the library, see album art, play previews, and see which song is playing now.

YASS reads YARG's files and never writes to them. When you scan songs in YARG, every
connected phone updates automatically.

To see YASS without installing it, [try the demo](https://devprice.github.io/YASS/).

## Get started

Before you begin, scan your songs in YARG at least once.

1. From the [releases page](https://github.com/DevPrice/YASS/releases), download the file
   for your operating system: the `.exe` for Windows or the `.AppImage` for Linux.
1. Run the file on the computer that runs YARG. YASS has no installer and no window; its
   icon appears in the notification area.
1. Open the YASS popover. On Windows, click the icon. On Linux, right-click the icon, and
   then click **Settings…**.
1. On a phone that's on the same Wi-Fi network, scan the QR code in the popover, or enter
   the address shown there in a browser.

The Windows build isn't code-signed. If SmartScreen warns you, click **More info**, and
then click **Run anyway**.

On Linux, also do the following:

- Make the AppImage executable with `chmod +x`.
- On Ubuntu 24.04 or later, install `libfuse2`, or run the AppImage with
  `--appimage-extract-and-run`.
- For album art and previews, install ffmpeg with your package manager, and then restart
  the server.

If YASS doesn't find your songs, open the popover, expand **Settings**, and set **YARG data
folder** to the folder that contains `songcache.bin`.

## Build from source

You need Node.js 20 or later, or Node.js 22 or later to run the tests.

```bash
git clone --recurse-submodules https://github.com/DevPrice/YASS.git
cd YASS
npm install
npm run dev
```

The `vendor/opensource` submodule is required. If you cloned without it, run
`git submodule update --init`.

The following commands are the most common:

| Command | Description |
|---|---|
| `npm run dev` | Runs the client on port 5173 and the API on port 4321. |
| `npm test` | Runs the tests. |
| `npm run build` then `npm start` | Builds and runs the server at `http://localhost:4321`. |
| `npm run dist` | Packages the tray app for your platform into `dist/`. |

## License

YASS is in the public domain under [the Unlicense](LICENSE). Some bundled third-party
material has its own license; see [Third-party notices](THIRD-PARTY-NOTICES.md).

YASS is unofficial and isn't affiliated with YARC, Harmonix, Activision, or Epic Games.
