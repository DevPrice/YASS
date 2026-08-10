/**
 * Process-wide application state: settings, the song index, and the
 * now-playing watcher, plus the wiring between them.
 *
 * Kept separate from the HTTP layer so the same state can be driven by a tray
 * process or a test without going through Hono.
 */

import type { LibraryMeta, Settings, SettingsView, SongLibrary } from '@shared/types.js'
import { CsvWatcher } from './core/csvWatcher.js'
import { emptyLibrary, loadLibraryFromCsv } from './core/library.js'
import { NowPlayingWatcher } from './core/nowPlaying.js'
import { VenueStream } from './core/venueStream.js'
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
  #csvWatcher: CsvWatcher
  /**
   * Venue lighting, if YARG is broadcasting it.
   *
   * Not configurable and not required. It listens, and if nothing ever arrives
   * the app behaves exactly as it did before this existed.
   */
  #venue = new VenueStream()
  #librarySubscribers = new Set<(meta: LibraryMeta) => void>()

  private constructor(stored: Settings) {
    this.#stored = stored
    this.#effective = applyEnvOverrides(stored)

    this.#watcher = new NowPlayingWatcher({
      getDataDir: () => this.#effective.yargDataDir,
      getPollIntervalMs: () => this.#effective.pollIntervalMs,
      resolveLibraryId: (hash) => (hash ? (this.#byHash.get(hash) ?? null) : null),
    })

    this.#csvWatcher = new CsvWatcher({
      getPath: () => this.#effective.songListCsvPath,
      onChange: async () => {
        await this.reloadLibrary()
      },
      onError: (error) => {
        console.error('[yass] song list watch:', error)
      },
    })
  }

  static async create(): Promise<AppState> {
    const state = new AppState(await loadStoredSettings())
    await state.reloadLibrary()
    state.#watcher.start()
    await state.#csvWatcher.start()
    state.#venue.start()
    return state
  }

  /**
   * Listen for the song list being reloaded from disk.
   *
   * Only the metadata is published. The index itself is megabytes, and the
   * client already has a conditional GET for it — so this says "it moved" and
   * lets the browser decide whether to spend the bandwidth.
   */
  subscribeLibrary(listener: (meta: LibraryMeta) => void): () => void {
    this.#librarySubscribers.add(listener)
    return () => this.#librarySubscribers.delete(listener)
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

  get venue(): VenueStream {
    return this.#venue
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

    for (const listener of this.#librarySubscribers) {
      // One bad subscriber must not stop the others from being told, and must
      // not propagate out of a filesystem event into an unhandled rejection.
      try {
        listener(this.#library.meta)
      } catch (error) {
        console.error('[yass] library subscriber:', error)
      }
    }

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
      // Follow the file — the old directory is no longer interesting.
      await this.#csvWatcher.start()
    }

    return this.settingsView
  }

  /** True when the bind address needs a restart to take effect. */
  bindingChanged(view: SettingsView, boundHost: string, boundPort: number): boolean {
    return view.settings.host !== boundHost || view.settings.port !== boundPort
  }

  stop(): void {
    this.#watcher.stop()
    this.#csvWatcher.stop()
    this.#venue.stop()
  }
}
