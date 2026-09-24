# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The guest-facing product is a web app opened in a phone browser over the LAN. The tray
popover (`desktop/`) is an Electron window, but it renders web UI and follows the same
design language; it is not a native surface.

## Users

**Primary: guests at a party.** People in the same room as the host, on their own phones,
over the host's Wi-Fi. They are deciding what to play next while someone else is mid-song —
standing, talking, one-handed, glancing between the phone and the screen. Nobody installs
anything and nobody is trained; they scan a QR code and are in.

**Secondary: the host.** Sets YASS up once on the machine running YARG, through the tray
popover: finds the YARG data folder, switches between release and nightly installs, shows
the QR code, triggers a reload or reindex. The host is the only person who ever sees
configuration.

## Product Purpose

YASS (Yet Another Song Selector) lets everyone in the room browse the host's YARG library
from their phone — sort, filter, search, see album art, hear previews, and see which song is
playing now — without crowding around the game's own menu. Success is a guest finding a song
they want to play in seconds, and the library on every phone staying in step with the game
without anyone touching it.

## Positioning

It reads YARG's own song cache (`songcache.bin`), so the library is exactly what the game
has — no export step, no configuration, no second copy to drift — and it pushes changes to
every connected phone the moment the host rescans. It is a companion to the game on the
host's machine, not a separate service or account.

## Operating Context

- Runs on the computer that hosts YARG; phones reach it on the LAN, or through a reverse
  proxy mapping a domain to that machine.
- A room with the game on a big screen; the phone is a second screen, used in glances.
  Phones may be held sideways (a short, wide viewport is a real layout, not an edge case).
- Now-playing, venue lighting, library changes and host-triggered reloads arrive over SSE;
  guests never refresh by hand.
- Libraries run to several thousand songs (~4,000 is typical); the whole index is fetched
  once and filtered on the device.
- A serverless demo build is published to GitHub Pages for people evaluating it before
  installing.

## Capabilities and Constraints

- **Read-only toward YARG.** YASS never writes to the game's files.
- **Browse:** sort (including by artist in album running order, charter, subgenre, playlist,
  date added), filter, search; per-song detail with instruments, difficulty, source, length,
  year, genre.
- **Media:** album art and audio previews, extracted from the charts by ffmpeg, which is
  fetched on demand on Windows and must be installed by the user on Linux. Without it, art
  and previews are absent, and the UI must still work.
- **Genres are normalized** the way YARG does it when YARG's mappings are available; they
  fall back to as-authored otherwise.
- **Nothing is filtered:** songs above the player's Max Song Rating appear, though YARG hides
  them.
- **Host-only settings.** Configuration, reload and reindex are only reachable from the host
  machine and fail closed; the web client deliberately has no settings.
- **Not in scope yet: queueing.** No queue features until existing karaoke/music-queue
  technology has been researched and a direction chosen.
- **No scores.** Score data (stars, medals, stats) is not available and must not be shown.

## Brand Commitments

- Name: **YASS**, "Yet Another Song Selector".
- **`DESIGN.md` is the visual authority.** The system began as the YARG Design System,
  whose tokens and art are vendored in `client/src/design/`, so YASS reads as part of the
  game. YARG's bitmap art is art and is never redrawn as vectors.
- Unofficial: not affiliated with YARC, Harmonix, Activision, or Epic Games. Nothing may
  imply otherwise.
- Public domain (the Unlicense).

## Evidence on Hand

- Real libraries and captures in `fixtures/`; the demo's mock data in `client/src/mock/`.
- The vendored YARG design assets: instrument, difficulty and source art under
  `client/src/design/assets/`.
- No testimonials, user counts, or press exist. Do not invent them.

## Product Principles

1. **The game is the source of truth.** Show what YARG has, as YARG has it; never ask a
   guest or host to maintain a second copy.
2. **Built for a glance in a noisy room.** A guest mid-conversation should find a song
   without reading instructions or waiting on the network.
3. **Guests browse; the host configures.** Anything that exposes paths or changes behavior
   stays on the host machine.
4. **Every song is a real song.** Design as though every song has cover art, even where
   today's library cannot supply it yet.
5. **Nothing happens that nobody asked for.** No background update checks, no writes to the
   game, no surprises in front of a room full of guests.

## Accessibility & Inclusion

WCAG 2.2 AA across the guest client and the tray popover: contrast, target size, keyboard
operation, and reduced motion.
