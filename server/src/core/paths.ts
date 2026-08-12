/**
 * Platform path defaults.
 *
 * YARG writes `currentSong.json` to Unity's `persistentDataPath` (derived from
 * companyName `YARC` / productName `YARG`) plus a build-channel subfolder:
 * `release`, `nightly`, or `dev`.
 *
 * These are defaults only. YARG can be launched with `-persistent-data-path`,
 * which replaces the whole path including the channel — and the YARC Launcher
 * may pass it — so the resolved directory always stays user-configurable.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export type BuildChannel = 'release' | 'nightly' | 'dev'

/** Unity's `Application.persistentDataPath` for YARG on this platform. */
export function unityPersistentDataPath(): string {
  const home = homedir()

  switch (process.platform) {
    case 'win32':
      return join(home, 'AppData', 'LocalLow', 'YARC', 'YARG')
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'YARC', 'YARG')
    default:
      return join(home, '.config', 'unity3d', 'YARC', 'YARG')
  }
}

/** Default YARG data directory, defaulting to the stable-release channel. */
export function defaultYargDataDir(channel: BuildChannel = 'release'): string {
  return join(unityPersistentDataPath(), channel)
}

/**
 * Where YASS stores its own settings — and nothing else.
 *
 * On Windows this is `%APPDATA%`, which on a domain profile is copied to the
 * server at every logon and logoff. `settings.json` is a kilobyte of genuine
 * preferences and belongs there; everything else the app writes does not, which
 * is what `appCacheDir()` below is for.
 */
export function appConfigDir(): string {
  const home = homedir()

  switch (process.platform) {
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'yass')
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'yass')
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'yass')
  }
}

export function settingsFilePath(): string {
  return join(appConfigDir(), 'settings.json')
}

/**
 * Everything the app can rebuild: derived media, a fetched ffmpeg, logs, and
 * Chromium's own state.
 *
 * Machine-local on purpose. Between a 2 GB preview cap, a ~100 MB ffmpeg build
 * and Chromium's caches, a roaming profile would be dragging gigabytes across
 * the network to reproduce files that are either regenerated from the library
 * on the next run or wrong on the next machine anyway. Delete this whole
 * directory and YASS loses nothing but the time to make it again.
 */
export function appCacheDir(): string {
  const home = homedir()

  switch (process.platform) {
    case 'win32':
      return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'yass')
    case 'darwin':
      return join(home, 'Library', 'Caches', 'yass')
    default:
      return join(process.env.XDG_CACHE_HOME ?? join(home, '.cache'), 'yass')
  }
}

/**
 * Derived media — thumbnails, previews, and the chart index.
 *
 * Here rather than in `media/store.ts` so that every directory the app writes
 * to is named in one file. The tray offers to open these, and a second spelling
 * of `'cache'` somewhere else is how a menu item ends up pointing at a folder
 * nothing uses.
 */
export function mediaCacheDir(): string {
  return join(appCacheDir(), 'cache')
}

/** Binaries the app fetched for itself, which today means ffmpeg. */
export function managedBinDir(): string {
  return join(appCacheDir(), 'bin')
}

/** The server child's rotated stdout, written by the tray that spawns it. */
export function logDir(): string {
  return join(appCacheDir(), 'logs')
}

/** Chromium's caches, cookies and preferences. See `desktop/src/main.ts`. */
export function electronDataDir(): string {
  return join(appCacheDir(), 'electron')
}

/** The now-playing file inside a YARG data directory. */
export function currentSongJsonPath(yargDataDir: string): string {
  return join(yargDataDir, 'currentSong.json')
}

/**
 * YARG's own song index, rewritten on every scan.
 *
 * The single most load-bearing path in the app: the song list is built from
 * this file, and so is the map from a song to its files on disk. Named here
 * with the other YARG paths rather than in `media/`, because it stopped being a
 * media-only concern when the library started coming out of it too.
 */
export function songCachePath(yargDataDir: string): string {
  return join(yargDataDir, 'songcache.bin')
}
