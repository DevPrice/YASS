/**
 * Process-wide application state: settings, the song index, and the
 * now-playing watcher, plus the wiring between them.
 *
 * Kept separate from the HTTP layer so the same state can be driven by a tray
 * process or a test without going through Hono.
 */

import type { Settings, SettingsView, SongLibrary } from '@shared/types.js'
import { emptyLibrary, loadLibraryFromCsv } from './core/library.js'
import { NowPlayingWatcher } from './core/nowPlaying.js'
import {
  applyEnvOverrides,
  describeSettings,
  loadStoredSettings,
  saveStoredSettings,
} from './core/settings.js'

export class AppState {
  /**
   * Settings are held twice on purpose.
   *
   * `#stored` is what the settings file says; `#effective` is that with
   * environment overrides applied. Only `#stored` is ever written back — saving
   * the effective values would permanently bake a one-off `YASS_PORT=…` into
   * the user's configuration.
   */
  #stored: Settings
  #effective: Settings

  #library: SongLibrary = emptyLibrary()
  /** hash → song id, for joining now-playing to the library. */
  #byHash = new Map<string, string>()
  #watcher: NowPlayingWatcher

  private constructor(stored: Settings) {
    this.#stored = stored
    this.#effective = applyEnvOverrides(stored)

    this.#watcher = new NowPlayingWatcher({
      getDataDir: () => this.#effective.yargDataDir,
      getPollIntervalMs: () => this.#effective.pollIntervalMs,
      resolveLibraryId: (hash) => (hash ? (this.#byHash.get(hash) ?? null) : null),
    })
  }

  static async create(): Promise<AppState> {
    const state = new AppState(await loadStoredSettings())
    await state.reloadLibrary()
    state.#watcher.start()
    return state
  }

  /** The values actually in force. */
  get settings(): Settings {
    return this.#effective
  }

  get settingsView(): SettingsView {
    return describeSettings(this.#effective)
  }

  get library(): SongLibrary {
    return this.#library
  }

  get watcher(): NowPlayingWatcher {
    return this.#watcher
  }

  /** Re-read the song list from disk and rebuild the hash join index. */
  async reloadLibrary(): Promise<SongLibrary> {
    this.#library = await loadLibraryFromCsv(this.#effective.songListCsvPath)

    this.#byHash = new Map()
    for (const song of this.#library.songs) {
      // First writer wins: duplicate charts share a hash, and either is a fine
      // target for the now-playing link.
      if (song.hash && !this.#byHash.has(song.hash)) {
        this.#byHash.set(song.hash, song.id)
      }
    }

    // A song may already be playing; re-resolve its library link.
    this.#watcher.refreshLibraryJoin()

    return this.#library
  }

  /**
   * Persist new settings and apply them live.
   *
   * The patch merges onto the *stored* values, never the effective ones, so an
   * environment override in force during this run doesn't get written to disk.
   *
   * `host` and `port` changes are stored but need a restart to bind.
   */
  async updateSettings(patch: Partial<Settings>): Promise<SettingsView> {
    const previousCsvPath = this.#effective.songListCsvPath

    this.#stored = await saveStoredSettings({ ...this.#stored, ...patch })
    this.#effective = applyEnvOverrides(this.#stored)

    if (this.#effective.songListCsvPath !== previousCsvPath) {
      await this.reloadLibrary()
    }

    return this.settingsView
  }

  /** True when the bind address needs a restart to take effect. */
  bindingChanged(view: SettingsView, boundHost: string, boundPort: number): boolean {
    return view.settings.host !== boundHost || view.settings.port !== boundPort
  }

  stop(): void {
    this.#watcher.stop()
  }
}
