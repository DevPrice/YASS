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

/** Where YASS stores its own settings. */
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
 * Derived media — thumbnails, previews, and the chart index.
 *
 * Here rather than in `media/store.ts` so that every directory the app writes
 * to is named in one file. The tray offers to open these, and a second spelling
 * of `'cache'` somewhere else is how a menu item ends up pointing at a folder
 * nothing uses.
 */
export function mediaCacheDir(): string {
  return join(appConfigDir(), 'cache')
}

/** Binaries the app fetched for itself, which today means ffmpeg. */
export function managedBinDir(): string {
  return join(appConfigDir(), 'bin')
}

/** The now-playing file inside a YARG data directory. */
export function currentSongJsonPath(yargDataDir: string): string {
  return join(yargDataDir, 'currentSong.json')
}
