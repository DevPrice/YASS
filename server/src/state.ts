/**
 * Process-wide application state: settings, the song index, and the
 * now-playing watcher, plus the wiring between them.
 *
 * Kept separate from the HTTP layer so the same state can be driven by a tray
 * process or a test without going through Hono.
 */

import type { LibraryMeta, Settings, SettingsView, SongLibrary } from '@shared/types.js'
import { FileWatcher } from './core/fileWatcher.js'
import { emptyLibrary, loadLibraryFromCsv } from './core/library.js'
import { NowPlayingWatcher } from './core/nowPlaying.js'
import { VenueStream } from './core/venueStream.js'
import { fetchFfmpeg } from './media/ffmpeg.js'
import { buildChartIndex, songCachePath, ChartIndex, type ChartIndexMeta } from './media/index.js'
import { MediaService } from './media/service.js'
import {
  applyEnvOverrides,
  bindingChanged,
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
  #csvWatcher: FileWatcher
  /**
   * hash → the chart's location on disk, which is what makes album art and
   * previews possible for songs other than the one YARG is playing.
   *
   * Built from `songcache.bin`, or scanned when that can't be read. Never sent
   * to a client: it holds absolute paths. See `media/types.ts`.
   */
  #charts = new ChartIndex()
  #chartWatcher: FileWatcher
  /** Serialises index rebuilds so a burst of events can't start three. */
  #indexing: Promise<ChartIndexMeta> | null = null
  /** Art and preview generation, caching and concurrency. */
  #media = new MediaService(this.#charts)
  /** In-flight ffmpeg download, so two clicks don't become two downloads. */
  #installingFfmpeg: Promise<string> | null = null
  /**
   * Venue lighting, if YARG is broadcasting it.
   *
   * Not configurable and not required. It listens, and if nothing ever arrives
   * the app behaves exactly as it did before this existed.
   */
  #venue = new VenueStream()
  #librarySubscribers = new Set<(meta: LibraryMeta) => void>()
  #reloadSubscribers = new Set<() => void>()

  private constructor(stored: Settings) {
    this.#stored = stored
    this.#effective = applyEnvOverrides(stored)

    this.#watcher = new NowPlayingWatcher({
      getDataDir: () => this.#effective.yargDataDir,
      getPollIntervalMs: () => this.#effective.pollIntervalMs,
      resolveLibraryId: (hash) => (hash ? (this.#byHash.get(hash) ?? null) : null),
    })

    this.#csvWatcher = new FileWatcher({
      getPath: () => this.#effective.songListCsvPath,
      onChange: async () => {
        await this.reloadLibrary()
      },
      onError: (error) => {
        console.error('[yass] song list watch:', error)
      },
    })

    // YARG rewrites its cache whenever it rescans, which is exactly when songs
    // gain or lose the files this index points at.
    this.#chartWatcher = new FileWatcher({
      getPath: () => songCachePath(this.#effective.yargDataDir),
      onChange: async () => {
        await this.rebuildChartIndex()
      },
      onError: (error) => {
        console.error('[yass] song cache watch:', error)
      },
    })
  }

  static async create(): Promise<AppState> {
    const state = new AppState(await loadStoredSettings())
    await state.reloadLibrary()
    state.#watcher.start()
    await state.#csvWatcher.start()
    await state.#chartWatcher.start()
    state.#venue.start()

    /*
     * The index is built after the server is otherwise ready, and not awaited.
     *
     * Reading `songcache.bin` takes milliseconds, but the fallback is a walk of
     * the whole library over a network share — minutes. Blocking startup on the
     * bad case would mean the song list, the now-playing banner and the whole
     * app wait on a feature that degrades to a placeholder. It fills in behind
     * the list instead.
     */
    void state.rebuildChartIndex()

    return state
  }

  /** The chart index. Server-side only — it carries absolute paths. */
  get charts(): ChartIndex {
    return this.#charts
  }

  get media(): MediaService {
    return this.#media
  }

  /**
   * Rebuild the chart index from whichever source is available.
   *
   * Concurrent callers share one build: the tray's "rebuild" button, the cache
   * watcher and startup can all land at once, and a scan is far too expensive
   * to run three times.
   */
  async rebuildChartIndex(force = false): Promise<ChartIndexMeta> {
    if (this.#indexing !== null) return this.#indexing

    // A pass over the old index is describing a library that no longer exists.
    this.#media.stopPrecompute()

    this.#indexing = buildChartIndex(this.#charts, {
      yargDataDir: this.#effective.yargDataDir,
      force,
    })
      .then((meta) => {
        // The library payload carries `hasArt` / `hasPreview`, so a newly built
        // index means the songs the client is holding are out of date.
        this.#decorateLibrary()
        this.#publishLibrary()

        // Thumbnails for whatever the CSV actually lists, rather than for every
        // chart on disk: the list is what anybody can see.
        void this.#media.precomputeArt(
          this.#library.songs
            .map((song) => song.hash)
            .filter((hash): hash is string => hash !== null),
        )

        return meta
      })
      .catch((error) => {
        console.error('[media] index build failed:', error)
        return this.#charts.meta
      })
      .finally(() => {
        this.#indexing = null
      })

    return this.#indexing
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

  /**
   * Listen for "reload yourself" being asked of every connected browser.
   *
   * There is no payload: the whole message is the instruction. It exists for
   * the host, who can see the phones in the room and knows when one is showing
   * something stale — a guest can't trigger it, because the endpoint behind it
   * is host-only.
   */
  subscribeReload(listener: () => void): () => void {
    this.#reloadSubscribers.add(listener)
    return () => this.#reloadSubscribers.delete(listener)
  }

  broadcastReload(): void {
    for (const listener of this.#reloadSubscribers) {
      // Same contract as the library fan-out: one broken stream must not stop
      // the other browsers in the room from being told.
      try {
        listener()
      } catch (error) {
        console.error('[yass] reload subscriber:', error)
      }
    }
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

    this.#decorateLibrary()

    // The CSV is the only place a song's length is known without opening its
    // audio, and the preview window needs one for songs whose audio can't be
    // probed cheaply.
    this.#media.setSongLengths(
      this.#library.songs
        .filter((song): song is typeof song & { hash: string } => song.hash !== null)
        .map((song) => [song.hash, song.lengthSeconds] as const),
    )

    // A song may already be playing; re-resolve its library link.
    this.#watcher.refreshLibraryJoin()

    this.#publishLibrary()

    return this.#library
  }

  /**
   * Stamp each song with whether media exists for it.
   *
   * Two booleans on a payload the client already fetches conditionally, and the
   * alternative is 4,168 speculative requests that mostly 404. `hasArt` is
   * "there is a chart on disk we could extract art from" rather than "art has
   * been extracted" — the route generates on demand, and promising only what is
   * already cached would leave every cover dark until something asked for it.
   */
  #decorateLibrary(): void {
    for (const song of this.#library.songs) {
      const ref = this.#charts.get(song.hash)
      song.hasArt = ref !== null
      song.hasPreview = ref !== null
    }
  }

  /**
   * Fetch and install ffmpeg, then start using it.
   *
   * Deduplicated here rather than in the route: the download is 110 MB, and two
   * clicks on the tray's button must not become two of them. Returns the
   * installed path, or null if the media features were already working.
   */
  async installFfmpeg(): Promise<string | null> {
    if (this.#installingFfmpeg !== null) return this.#installingFfmpeg

    this.#installingFfmpeg = fetchFfmpeg()
      .then(async (path) => {
        console.log(`[media] installed ffmpeg to ${path}`)
        this.#media.invalidateFfmpeg()

        // Everything that was refused for want of ffmpeg can now happen, and
        // the whole library's thumbnails are the bulk of it.
        void this.#media.precomputeArt(
          this.#library.songs
            .map((song) => song.hash)
            .filter((hash): hash is string => hash !== null),
        )

        return path
      })
      .finally(() => {
        this.#installingFfmpeg = null
      })

    return this.#installingFfmpeg
  }

  /** Tell every connected browser the library metadata moved. */
  #publishLibrary(): void {
    for (const listener of this.#librarySubscribers) {
      // One bad subscriber must not stop the others from being told, and must
      // not propagate out of a filesystem event into an unhandled rejection.
      try {
        listener(this.#library.meta)
      } catch (error) {
        console.error('[yass] library subscriber:', error)
      }
    }
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
    const previousDataDir = this.#effective.yargDataDir

    this.#stored = await saveStoredSettings({ ...this.#stored, ...patch })
    this.#effective = applyEnvOverrides(this.#stored)

    if (this.#effective.songListCsvPath !== previousCsvPath) {
      await this.reloadLibrary()
      // Follow the file — the old directory is no longer interesting.
      await this.#csvWatcher.start()
    }

    // A new data directory is a different YARG install, and so a different
    // `songcache.bin` describing a different library.
    if (this.#effective.yargDataDir !== previousDataDir) {
      await this.#chartWatcher.start()
      void this.rebuildChartIndex(true)
    }

    return this.settingsView
  }

  /** True when the bind address needs a restart to take effect. */
  bindingChanged(view: SettingsView, boundHost: string, boundPort: number): boolean {
    return bindingChanged(view.settings, boundHost, boundPort)
  }

  stop(): void {
    this.#watcher.stop()
    this.#csvWatcher.stop()
    this.#chartWatcher.stop()
    this.#media.stopPrecompute()
    this.#venue.stop()
  }
}
