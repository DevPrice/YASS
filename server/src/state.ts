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
import { describeSettings, loadSettings, saveSettings } from './core/settings.js'

export class AppState {
  #settings: Settings
  #library: SongLibrary = emptyLibrary()
  /** hash → song id, for joining now-playing to the library. */
  #byHash = new Map<string, string>()
  #watcher: NowPlayingWatcher

  private constructor(settings: Settings) {
    this.#settings = settings
    this.#watcher = new NowPlayingWatcher({
      getDataDir: () => this.#settings.yargDataDir,
      getPollIntervalMs: () => this.#settings.pollIntervalMs,
      resolveLibraryId: (hash) => (hash ? (this.#byHash.get(hash) ?? null) : null),
    })
  }

  static async create(): Promise<AppState> {
    const state = new AppState(await loadSettings())
    await state.reloadLibrary()
    state.#watcher.start()
    return state
  }

  get settings(): Settings {
    return this.#settings
  }

  get settingsView(): SettingsView {
    return describeSettings(this.#settings)
  }

  get library(): SongLibrary {
    return this.#library
  }

  get watcher(): NowPlayingWatcher {
    return this.#watcher
  }

  /** Re-read the song list from disk and rebuild the hash join index. */
  async reloadLibrary(): Promise<SongLibrary> {
    this.#library = await loadLibraryFromCsv(this.#settings.songListCsvPath)

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
   * `host` and `port` changes are stored but need a restart to bind, which the
   * settings UI tells the user.
   */
  async updateSettings(patch: Partial<Settings>): Promise<SettingsView> {
    const previous = this.#settings
    this.#settings = await saveSettings({ ...previous, ...patch })

    if (this.#settings.songListCsvPath !== previous.songListCsvPath) {
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
