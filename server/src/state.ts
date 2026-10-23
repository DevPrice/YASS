/**
 * Process-wide application state: settings, the song index, and the
 * now-playing watcher, plus the wiring between them.
 *
 * Kept separate from the HTTP layer so the same state can be driven by a tray
 * process or a test without going through Hono.
 */

import type { LibraryMeta, Settings, SettingsView, SongLibrary } from '@shared/types.js'
import { FileWatcher } from './core/fileWatcher.js'
import { emptyLibrary, loadLibraryFromCache, type LoadedLibrary } from './core/library.js'
import { NowPlayingWatcher } from './core/nowPlaying.js'
import { Setlist } from './core/setlist.js'
import { SetlistClient } from './core/setlistClient.js'
import { VenueStream } from './core/venueStream.js'
import {
  DEFAULT_YARG_SETTINGS,
  readSetlistSocketSettings,
  readYargSettings,
  sameYargSettings,
  type SetlistSocketSettings,
  type YargSettings,
} from './core/yargSettings.js'
import { fetchFfmpeg } from './media/ffmpeg.js'
import { songCachePath, yargSettingsPath } from './core/paths.js'
import { buildChartIndex, ChartIndex, type ChartIndexMeta } from './media/index.js'
import type { PreviewMix } from './media/preview.js'
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
  /**
   * What `#library` was built against, assigned with it and never apart: the
   * ratings in the list and the audio the preview route hands out must come
   * from the same reading of YARG's censorship setting.
   */
  #yarg: YargSettings = DEFAULT_YARG_SETTINGS
  #previewMix: PreviewMix = 'legacy'
  /** The data directory `#yarg` was read from, so it is never a fallback for another. */
  #libraryDir: string | null = null
  /** Bumped by every reload. See `reloadLibrary`. */
  #reloadGeneration = 0
  #latestReload: Promise<SongLibrary> | null = null
  /** hash → song id, for joining now-playing to the library. */
  #byHash = new Map<string, string>()
  #watcher: NowPlayingWatcher
  /**
   * hash → the chart's location on disk, which is what makes album art and
   * previews possible for songs other than the one YARG is playing.
   *
   * Built from `songcache.bin`, or scanned when that can't be read. Never sent
   * to a client: it holds absolute paths. See `media/types.ts`.
   */
  #charts = new ChartIndex()
  /**
   * One watcher over `songcache.bin`, because it is now one file answering both
   * questions — what the songs are, and where their files are.
   */
  #cacheWatcher: FileWatcher
  /**
   * And one over YARG's own `settings.json`, because the player toggling
   * censorship or the Genrelizer in game re-sorts YARG's in-memory list and
   * rewrites nothing else — the cache watcher would never hear of it.
   */
  #yargSettingsWatcher: FileWatcher
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
  /**
   * YARG's live setlist, when its setlist socket is on.
   *
   * Like the venue stream, optional: with the socket off or YARG closed it
   * reports why and keeps trying, and nothing else waits on it.
   */
  #setlistClient = new SetlistClient()
  /** The same setlist, with the rules for editing it from a phone. */
  #setlist: Setlist
  /** The last reading of the socket's settings, and the directory it came from. */
  #setlistSettings: SetlistSocketSettings | null = null
  #setlistSettingsDir: string | null = null
  #librarySubscribers = new Set<(meta: LibraryMeta) => void>()
  #reloadSubscribers = new Set<() => void>()

  private constructor(stored: Settings) {
    this.#stored = stored
    this.#effective = applyEnvOverrides(stored)
    this.#setlist = new Setlist(this.#setlistClient, () => this.#effective.guestSetlistEdits)

    this.#watcher = new NowPlayingWatcher({
      getDataDir: () => this.#effective.yargDataDir,
      getPollIntervalMs: () => this.#effective.pollIntervalMs,
      resolveLibraryId: (hash) => (hash ? (this.#byHash.get(hash) ?? null) : null),
    })

    // YARG rewrites its cache whenever it rescans, which is exactly when songs
    // appear, vanish, or gain the files the chart index points at. The list is
    // reloaded first and the index rebuilt behind it: the first is a parse of a
    // file already in the page cache, the second can fall through to a disk
    // walk, and there is no reason for the song list to wait on that.
    this.#cacheWatcher = new FileWatcher({
      getPath: () => songCachePath(this.#effective.yargDataDir),
      onChange: async () => {
        await this.reloadLibrary()
        await this.rebuildChartIndex()
      },
      onError: (error) => {
        console.error('[yass] song cache watch:', error)
      },
    })

    // YARG saves this file for every setting it has — volume, calibration —
    // so most writes change nothing here, and a reload is only worth its
    // library event when one of the two values this app reads has moved. The
    // setlist socket's settings ride the same file but never reload anything.
    this.#yargSettingsWatcher = new FileWatcher({
      getPath: () => {
        const dir = this.#effective.yargDataDir
        return dir ? yargSettingsPath(dir) : ''
      },
      onChange: async () => {
        const dir = this.#effective.yargDataDir
        this.#setlistClient.configure(await this.#readSetlistSettings(dir))

        const next = await this.#readYargSettings(dir)
        if (!sameYargSettings(next, this.#yarg)) await this.reloadLibrary()
      },
      onError: (error) => {
        console.error('[yass] YARG settings watch:', error)
      },
    })
  }

  static async create(): Promise<AppState> {
    const state = new AppState(await loadStoredSettings())
    await state.reloadLibrary()
    await state.#watcher.start()
    await state.#cacheWatcher.start()
    await state.#yargSettingsWatcher.start()
    state.#venue.start()
    state.#setlistClient.start(await state.#readSetlistSettings(state.#effective.yargDataDir))

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

        // Thumbnails for whatever the song list actually holds, rather than for
        // every chart on disk: the list is what anybody can see.
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

  /** The YARG settings the current library was built with. */
  get yargSettings(): YargSettings {
    return this.#yarg
  }

  /** The stem rules previews follow, as of the current library. */
  get previewMix(): PreviewMix {
    return this.#previewMix
  }

  get watcher(): NowPlayingWatcher {
    return this.#watcher
  }

  get venue(): VenueStream {
    return this.#venue
  }

  get setlist(): Setlist {
    return this.#setlist
  }

  /**
   * Re-read the song list from disk and rebuild the hash join index.
   *
   * Overlapping calls are ordinary — the cache watcher, the settings watcher,
   * the tray's reload and a change of data directory each start one — and the
   * one that *started* last wins. A reload that finishes after a newer one has
   * begun throws its result away and answers with the newer one's, so a slow
   * read of the old censorship setting can never land on top of a fast read of
   * the new one and leave every phone with the wrong ratings.
   */
  reloadLibrary(): Promise<SongLibrary> {
    const generation = ++this.#reloadGeneration
    const dir = this.#effective.yargDataDir

    const reload = this.#readYargSettings(dir)
      .then((settings) => loadLibraryFromCache(dir, settings))
      .then((loaded) => {
        if (generation !== this.#reloadGeneration) return this.#latestReload!
        this.#applyLibrary(loaded, dir)
        return this.#library
      })

    this.#latestReload = reload
    return reload
  }

  /**
   * YARG's settings for `dir`, keeping the last reading if the file is caught
   * mid-write — but only a reading from the same directory. See `yargSettings.ts`.
   */
  #readYargSettings(dir: string): Promise<YargSettings> {
    return readYargSettings(dir, this.#libraryDir === dir ? this.#yarg : null)
  }

  /** The same rule for the setlist socket's settings, which are read on their own. */
  async #readSetlistSettings(dir: string): Promise<SetlistSocketSettings> {
    const previous = this.#setlistSettingsDir === dir ? this.#setlistSettings : null
    const settings = await readSetlistSocketSettings(dir, previous)
    this.#setlistSettings = settings
    this.#setlistSettingsDir = dir
    return settings
  }

  #applyLibrary(loaded: LoadedLibrary, dir: string): void {
    if (this.#libraryDir === dir && loaded.previewMix !== this.#previewMix) {
      console.log(`[yass] previews now follow YARG's ${loaded.previewMix} mix`)
    }

    this.#library = loaded.library
    this.#yarg = loaded.settings
    this.#previewMix = loaded.previewMix
    this.#libraryDir = dir

    this.#byHash = new Map()
    for (const song of this.#library.songs) {
      // First writer wins: duplicate charts share a hash, and either is a fine
      // target for the now-playing link.
      if (song.hash && !this.#byHash.has(song.hash)) {
        this.#byHash.set(song.hash, song.id)
      }
    }

    this.#decorateLibrary()

    // The song list is the only place a song's length is known without opening
    // its audio, and the preview window needs one for songs whose audio can't
    // be probed cheaply.
    this.#media.setSongLengths(
      this.#library.songs
        .filter((song): song is typeof song & { hash: string } => song.hash !== null)
        .map((song) => [song.hash, song.lengthSeconds] as const),
    )

    // A song may already be playing; re-resolve its library link.
    this.#watcher.refreshLibraryJoin()

    this.#publishLibrary()
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
    const previousDataDir = this.#effective.yargDataDir
    const previousGuestEdits = this.#effective.guestSetlistEdits

    this.#stored = await saveStoredSettings({ ...this.#stored, ...patch })
    this.#effective = applyEnvOverrides(this.#stored)

    if (this.#effective.guestSetlistEdits !== previousGuestEdits) this.#setlist.republish()

    // A new data directory is a different YARG install, and so a different
    // `songcache.bin` — a different song list and a different set of files
    // behind it.
    if (this.#effective.yargDataDir !== previousDataDir) {
      await this.reloadLibrary()
      // Follow the files; the old directory is no longer interesting. All three
      // watchers are bound to a directory, so none can pick this up on its own
      // the way a path-reading poll could.
      await this.#cacheWatcher.start()
      await this.#yargSettingsWatcher.start()
      await this.#watcher.rearm()
      this.#setlistClient.configure(await this.#readSetlistSettings(this.#effective.yargDataDir))
      // Not forced: the persisted index is keyed to the directory it was built
      // from, so this cannot pick up the old install's paths, and flipping back
      // to a build already indexed costs a file read rather than a rescan.
      void this.rebuildChartIndex()
    }

    return this.settingsView
  }

  /** True when the bind address needs a restart to take effect. */
  bindingChanged(view: SettingsView, boundHost: string, boundPort: number): boolean {
    return bindingChanged(view.settings, boundHost, boundPort)
  }

  stop(): void {
    this.#watcher.stop()
    this.#cacheWatcher.stop()
    this.#yargSettingsWatcher.stop()
    this.#media.stopPrecompute()
    this.#venue.stop()
    this.#setlistClient.stop()
  }
}
