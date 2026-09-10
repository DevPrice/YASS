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
 *
 * Which is why `findInstalls` at the bottom looks rather than assumes: somebody
 * running both the release and the nightly build has two data directories, and
 * the channel they are on is a fact about `yargDataDir` rather than a setting
 * of its own. Two settings would be two things to disagree.
 */

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { BuildChannel, YargInstall } from '@shared/types.js'

export type { BuildChannel }

/** In the order the settings UI offers them, which is also how they escalate. */
export const BUILD_CHANNELS: readonly BuildChannel[] = ['release', 'nightly', 'dev']

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

/**
 * One spelling of a directory, for comparing two of them.
 *
 * A path reaches us from three places that spell it differently: `join`, the
 * settings file (hand-edited, possibly with forward slashes or a trailing one)
 * and a directory picker. `resolve` settles separators and trailing slashes;
 * the fold to lower case is Windows' case-insensitive filesystem, and must not
 * happen anywhere else — `/home/Devin` and `/home/devin` are two directories.
 *
 * Comparison only. Never open a file by this: it is a key, not a path.
 */
export function pathKey(path: string): string {
  if (path === '') return ''
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * The channel a data directory names, or null when it is somewhere else.
 *
 * Matched on the last segment with a regex rather than `basename`, because a
 * Windows path is read back from a settings file on whichever platform the
 * tests run on, and POSIX `basename` does not split on a backslash.
 */
export function channelOf(dir: string): BuildChannel | null {
  const name = /([^\\/]+)[\\/]*$/.exec(dir)?.[1]?.toLowerCase()
  return BUILD_CHANNELS.find((channel) => channel === name) ?? null
}

function mtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

/**
 * Where to look for sibling installs of a configured data directory.
 *
 * The configured directory's parent joins the list only when that directory is
 * itself a channel folder. `…/YARG/nightly` implies `…/YARG/release` next to
 * it; a hand-picked `D:\yarg-stuff` implies nothing about `D:\`, and inventing
 * installs out of an unrelated parent's subfolders is worse than finding none.
 */
export function installRoots(yargDataDir: string): string[] {
  const configured =
    yargDataDir !== '' && channelOf(yargDataDir) !== null ? [dirname(yargDataDir)] : []

  // Ahead of the platform default, so that a channel present under both is
  // listed at the location actually in use — otherwise the install the app is
  // pointed at could be shadowed by a same-named folder it has never read.
  return [...configured, unityPersistentDataPath()]
}

/**
 * Which YARG builds are installed, as far as their data directories show it.
 *
 * `roots` are directories that hold channel folders — see `installRoots`. One
 * entry per channel at most: the earliest root holding it, so a channel can
 * never be listed twice under two spellings of the same build.
 *
 * Nine `stat`s in the worst case, against directories in the user's profile, on
 * the settings poll. Cheap enough to answer freshly every time, which is what
 * keeps "nightly is the one that's playing" true rather than remembered.
 */
export function findInstalls(roots: readonly string[], activeDir: string): YargInstall[] {
  const active = pathKey(activeDir)
  const installs: YargInstall[] = []

  for (const channel of BUILD_CHANNELS) {
    for (const root of roots) {
      const path = join(root, channel)
      if (!existsSync(path)) continue

      installs.push({
        channel,
        path,
        active: pathKey(path) === active,
        hasSongCache: existsSync(songCachePath(path)),
        playedAt: mtimeMs(currentSongJsonPath(path)),
      })
      break
    }
  }

  return installs
}
