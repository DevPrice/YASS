# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A song browser for [YARG](https://yarg.in). It runs on the machine hosting the game and
serves the player's library to phones on the LAN. It reads YARG's own files and never
writes to them.

## Commands

Run from the repository root. `server`, `client` and `desktop` are npm workspaces;
`shared` is not — it is source consumed through a path alias.

| Command | Does |
|---|---|
| `npm run dev` | Client on :5173, API on :4321, concurrently |
| `npm run build` | Client then server |
| `npm start` | The built server — one process, one port |
| `npm run dist` | Everything, packaged for the platform you are on, into `dist/` |
| `npm run typecheck` | All three workspaces |
| `npm test` | All three workspaces |
| `npm run dev:demo` / `npm run build:demo` | The serverless demo (see `client/src/mock/`) |

**Node 22+ to run the tests**, though the app itself runs on 20. The test scripts hand
`"src/**/*.test.ts"` to `node --test` still quoted, so the test runner does the globbing
itself — which it only learned to do in 22.

**A single test file must be run from inside its workspace.** The glob is relative to the
workspace and tsx needs that workspace's `tsconfig.json` to resolve the `@shared` /
`@server` aliases; the same command from the root fails to resolve the path.

```bash
cd server && node --import tsx --test src/core/genrelizer.test.ts
cd server && node --import tsx --test --test-name-pattern "normalizes" "src/**/*.test.ts"
```

**The `vendor/opensource` submodule is not optional.** `client/src/lib/sources.ts` reads
YARG's OpenSource registry at build time; without it the client build fails on a missing
`@opensource/base/index.json`. `git submodule update --init` if the clone was plain.

## Architecture

### One process, one port

`server/src/index.ts` mounts the JSON API under `/api` and serves the built client on
everything else. That keeps reverse-proxy configuration to a single upstream and makes the
tray executable a single thing to launch.

### The library comes from `songcache.bin`

`server/src/core/library.ts` parses YARG's own song cache — not the CSV export it used to
read. One file answers both questions the app has: what the songs are, and where their
chart files live. The long comment at the top of that file records what changed by
switching, and all three consequences still bite:

- **Genres are normalized here**, by `core/genrelizer.ts`, using the same Genrelizer
  mappings YARG downloads. The cache is written *before* YARG normalizes, so this has to
  redo it. Without the mappings, genres fall back to exactly as authored.
- **Nothing is filtered.** Songs above the player's Max Song Rating appear here even though
  YARG hides them.
- **There is no second source.** `media/scan.ts` recovers paths and hashes from a disk walk
  but no metadata, so an unsupported cache version means an empty library and a warning.
  The version allowlist in `media/cache.ts` is what guards that.

### `AppState` is the process

`server/src/state.ts` owns settings, the song index, the watchers, the chart index and the
media service, deliberately apart from the HTTP layer so a tray or a test can drive the
same state without going through Hono. Two invariants worth knowing before editing it:

- **Settings are held twice.** `#stored` is the file; `#effective` is that plus environment
  overrides. Only `#stored` is ever written back — saving the effective values would bake a
  one-off `YASS_PORT=…` into the user's configuration permanently.
- **Rebuilds are serialised.** The tray's rebuild button, the cache watcher and startup can
  all fire at once, and a fallback scan is far too expensive to run three times.

`songcache.bin` is watched; on change the song list reloads first and the chart index
rebuilds behind it, because the first is a parse and the second can degrade into a walk of
a network share.

### Push, don't poll

`/api/events` is SSE: now-playing, venue lighting, library changes, and a host-triggered
`reload` whose entire payload is the instruction. The client fetches
the whole song index once and filters client-side (~4,000 songs is a few MB, and that makes
search and sort instant). The library event carries only metadata — the message says "it
moved" and the browser's conditional GET decides whether to spend the bandwidth.

### Host-only endpoints fail closed

`server/src/api/local.ts` guards settings, reload and reindex. Configuration exposes
absolute paths and lets the caller repoint the app, so nobody browsing from a phone may see
it. **Any proxy header at all counts as remote**, even though that also hides settings from
a host browsing through its own domain: remote-address alone fails open behind a reverse
proxy, and losing access on the host is recoverable where exposing configuration is not.

### `media/` hangs off the chart index

`media/index.ts` maps hash → `ChartRef` (where the chart lives), built from `songcache.bin`
or a disk walk, persisted with a format version and a fingerprint so a stale index is
detected rather than trusted. Everything downstream — SNG / `.yargsong` / CON readers, art
extraction, previews, the disk cache — is a function of a `ChartRef`. **The index never
leaves the server: it holds absolute paths.**

ffmpeg does the decoding and is fetched on demand. The pinned build is a Windows one, so on
Linux the fetch refuses rather than leaving a PE executable named `ffmpeg` in the app's
directory; art and previews stay dark until the user installs one.

### The tray app

`desktop/` is CommonJS **on purpose, and only here** — preload scripts cannot be ESM under
`sandbox: true`. It spawns the server with Electron's `utilityProcess.fork` rather than
`child_process.fork` because that ties the child's lifetime to the parent at the OS level:
on Windows a crashed Electron would otherwise strand a Node process holding port 4321 with
no UI left to kill it with. The server entry ships as `.mjs` because `server/package.json`
(which is what makes the bundle ESM) does not travel into the packaged layout. The tray
reuses the server's own settings and path modules through `@server/*` rather than
reimplementing them.

### Client

- **`client/src/design/` is a vendored copy of the YARG design system.** It is not the
  authority — fix designs upstream and re-vendor, or the next sync silently reverts them.
  Token files are byte-for-byte copies so re-vendoring is a straight overwrite. Style
  through the tokens, never through literal values.
- **`client/src/ui/` holds ports of upstream components to Tailwind.** A port is a fork; the
  recipes it follows are listed at the top of `ui/index.tsx`.
- **Layout asks about height, not just width.** A phone held sideways is 844×390:
  every width-only rule called it a desktop and left one song row on screen. The
  `short` / `bar-stack` / `bar-top` / `roomy` / `cramped` / `has-table` variants at
  the top of `client/src/index.css` are the vocabulary for that, named after the
  layout mode rather than the device, and the block comment there is the reasoning.
  Two things follow: the paired variants are exact complements so no utility ever
  has to win a cascade fight with its opposite, and an `or` must be written in the
  block form with two `@slot`s — `@custom-variant x (@media A, B)` parses and then
  matches nothing. `SHORT_QUERY` in `lib/useMediaQuery.ts` is the same 500px for the
  three decisions JavaScript has to make before paint.
- **`client/src/mock/` is the demo build only.** `vite.config.ts` defines
  `import.meta.env.VITE_MOCK` as a literal `false` outside mock mode, so Rollup removes it
  and every module it was the only reference to. Verify with `npm run build` then grep
  `client/dist/assets` for a string from that folder — nothing should match.
- The dev proxy target is read out of the settings file rather than hardcoded, because the
  port is configurable and a wrong target reports as `500` on `/api/songs`, which is a true
  statement about the proxy and a misleading one about the server.

### Path aliases

`@shared/*` → `shared/src/*` (all three) · `@server/*` → `server/src/*` (desktop only) ·
`@opensource/*` → `vendor/opensource/*` (client, build time).

## Tests

`node --test` with tsx, against real captures in `fixtures/`. The media tests write their
songcache fixtures in the host's own path spelling, because that is what the parser reads
and what YARG wrote — which is why CI is a two-platform matrix rather than one runner.

## CI and releasing

`.github/workflows/build.yml` is the real job — typecheck, test, package both platforms,
and on Linux extract the AppImage and launch it under `xvfb` until it answers on
`127.0.0.1:4321`. It is a `workflow_call` reusable workflow with one optional `version`
input, and both other workflows call it, so a release ships what CI has been checking.

- `ci.yml` — every push to master, no version input.
- `release.yml` — every `v*` tag, with `version: ${{ github.ref_name }}`.
- `pages.yml` — the demo to GitHub Pages, on pushes touching the client.

### Cutting a release

```bash
npm version --no-git-tag-version --workspaces --include-workspace-root 1.2.3
git commit -am "1.2.3"                    # the README names no version — nothing to update there
git push origin master
git tag -a v1.2.3 -m "1.2.3" && git push origin v1.2.3
```

The tag then builds both platforms and leaves a **draft** release holding
`YASS-1.2.3.exe` and `YASS-1.2.3-x86_64.AppImage`. Write the notes, run both binaries,
publish by hand with `gh release edit v1.2.3 --draft=false --latest`. Publishing is the
only step that is not automated, and it stays that way deliberately.

Things that follow from how this is wired:

- **Tag-triggered, not triggered by drafting a release in the web UI.** GitHub does not
  create the tag until a draft is published, so a workflow woken by the draft has no tagged
  commit to check out — only the branch, which may have moved on.
- **Bumping the manifests is optional.** `.github/scripts/stamp-version.mjs` writes the
  tag's version into all four `package.json` files on the runner *and* switches
  `desktop/electron-builder.yml`'s two `artifactName` lines over to their versioned
  templates, so the tag decides the filenames either way. Neither edit is ever committed. It
  runs **after `npm ci`, never before** — the lockfile records those versions and rewriting
  them first makes the install fail as out of sync.
- **A local `npm run dist` is deliberately unversioned.** `dist/YASS.exe` and
  `dist/YASS.AppImage`, overwritten in place, so a pinned shortcut, a script or a Windows
  firewall rule keeps matching across rebuilds. The version appears only on what the
  releases page hands out, where a file in somebody's Downloads folder has to be datable
  against a bug report. Bumping the manifests locally does not change what a local build is
  called — only tagging does.
- **A failed build produces no release**, because the `draft` job needs `build`.
- **Re-pushing the same tag updates the draft in place** rather than erroring (`gh release
  view` first, then `upload --clobber`).
- **A non-semver tag fails fast**, before the client, server and tray are built.
- Do not force-push a tag to move a release. `v0.2.0` is tagged on a commit that never
  built and has no release; cutting the next patch was the cheaper fix.

## Conventions

Comments here explain **why**, at length, and are load-bearing documentation — most files
open with a block covering the decision and its cost. Match that when editing: a change
that invalidates one of those comments needs the comment changed too.
