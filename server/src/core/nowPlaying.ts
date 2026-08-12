/**
 * Watches YARG's `currentSong.json`.
 *
 * Three behaviors of that file drive this design:
 *
 *  1. **Blank, not `{}`, when nothing is playing.** YARG writes an empty string
 *     on startup, on quit, and on any state change that isn't gameplay. So a
 *     zero-byte file is "in menus", not an error.
 *
 *  2. **Writes are not atomic.** The writer truncates then writes, with no
 *     temp-and-rename, so a poll can land mid-write and see a truncated or
 *     empty file for a song that is genuinely playing. We therefore re-read a
 *     few times before believing "nothing is playing", and never let a parse
 *     failure alone flip the state.
 *
 *  3. **No change notification from YARG.** No socket, no event, no callback.
 *     But the file lives on a local disk, so the *filesystem* will tell us:
 *     this watches the directory and re-reads on write, which is what makes the
 *     banner land in about a tenth of a second instead of averaging half a
 *     poll behind.
 *
 * The poll did not go away, it just stopped being the mechanism. `fs.watch` on
 * Windows can go deaf without raising an error — a dropped
 * `ReadDirectoryChangesW` buffer, a directory replaced underneath the handle —
 * and a watch that dies silently never fires again. A poll notices on its next
 * tick regardless. So the watch is the trigger and a slow poll is the backstop,
 * and the failure that used to be "the banner lags a second" cannot become
 * "the banner lies for the rest of the party".
 */

import { readFile } from 'node:fs/promises'

import type { NowPlaying, NowPlayingSong } from '@shared/types.js'
import { findAlbumArt, type AlbumArt } from './art.js'
import { FileWatcher } from './fileWatcher.js'
import { extractCurrentSongHash } from './hash.js'
import { currentSongJsonPath } from './paths.js'
import { stripRichText } from './richtext.js'

/** Re-reads before concluding the file is genuinely blank. */
const CONFIRM_ATTEMPTS = 3

/** Gap between confirmation re-reads — long enough for a write to complete. */
const CONFIRM_DELAY_MS = 75

/**
 * Quiet period before reacting to a write.
 *
 * Far shorter than the library watchers use: this is the latency of the banner
 * on every phone in the room, the work behind it is one small read, and
 * `readStable` already absorbs a torn one. It exists only to collapse the
 * truncate-then-write pair into a single read.
 */
const WATCH_SETTLE_MS = 100

/**
 * Floor for the backstop poll, whatever the settings say.
 *
 * The watch is what makes this feel immediate; a backstop firing faster than
 * that is just the old poll under a new name, burning reads to save nothing.
 */
const MIN_BACKSTOP_MS = 1000

/** `int.MaxValue`, YARG's "unset" sentinel. */
const INT_MAX = 2147483647

type ReadOutcome =
  | { kind: 'song'; raw: Record<string, unknown> }
  | { kind: 'empty' }
  | { kind: 'unreadable' }
  | { kind: 'malformed' }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function readOnce(path: string): Promise<ReadOutcome> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    // Missing file or unreadable directory — YARG isn't running, or the
    // configured path is wrong. Either way, not a crash.
    return { kind: 'unreadable' }
  }

  if (text.trim() === '') return { kind: 'empty' }

  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return { kind: 'malformed' }
    return { kind: 'song', raw: parsed as Record<string, unknown> }
  } catch {
    // Almost always a torn read of a valid write.
    return { kind: 'malformed' }
  }
}

/**
 * Read until the answer is trustworthy.
 *
 * A single successful parse is conclusive. "Empty" and "unreadable" only count
 * once every attempt agrees. Persistent malformed reads stay inconclusive so
 * the caller can hold the previous state rather than flapping.
 */
async function readStable(path: string): Promise<ReadOutcome> {
  let last: ReadOutcome = { kind: 'malformed' }
  let allEmpty = true
  let allUnreadable = true

  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(CONFIRM_DELAY_MS)

    const outcome = await readOnce(path)
    last = outcome

    if (outcome.kind === 'song') return outcome
    if (outcome.kind !== 'empty') allEmpty = false
    if (outcome.kind !== 'unreadable') allUnreadable = false
  }

  if (allEmpty) return { kind: 'empty' }
  if (allUnreadable) return { kind: 'unreadable' }

  return last
}

function str(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  return typeof value === 'string' ? stripRichText(value) : ''
}

function num(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value === INT_MAX) return null
  return value
}

/**
 * Map a parsed `currentSong.json` onto the wire shape.
 *
 * Everything is treated as optional — this is a reflection dump of an internal
 * YARG class with no DTO, so fields come and go between versions and extra keys
 * appear for CON-derived entries.
 */
function toNowPlayingSong(
  raw: Record<string, unknown>,
  libraryId: string | null,
  hasArt: boolean,
): NowPlayingSong {
  const lengthSeconds = num(raw, 'SongLengthSeconds')
  const lengthMs = num(raw, 'SongLengthMilliseconds')
  const bandDifficulty = num(raw, 'BandDifficulty')

  return {
    hash: extractCurrentSongHash(raw.Hash),
    libraryId,

    name: str(raw, 'Name'),
    artist: str(raw, 'Artist'),
    album: str(raw, 'Album'),
    genre: str(raw, 'Genre'),
    charter: str(raw, 'Charter'),
    source: str(raw, 'Source'),
    year: str(raw, 'ParsedYear') || str(raw, 'UnmodifiedYear'),

    lengthSeconds: lengthSeconds ?? (lengthMs === null ? null : lengthMs / 1000),
    // sbyte `-1` means unset.
    bandDifficulty: bandDifficulty === null || bandDifficulty < 0 ? null : bandDifficulty,
    vocalsCount: num(raw, 'VocalsCount') ?? 0,
    isMaster: raw.IsMaster === true,
    albumTrack: num(raw, 'AlbumTrack'),

    hasArt,
  }
}

/** The chart location, needed server-side for art but never sent to clients. */
function locationOf(raw: Record<string, unknown>): string | null {
  const actual = raw.ActualLocation
  if (typeof actual === 'string' && actual !== '') return actual

  const sortBased = raw.SortBasedLocation
  if (typeof sortBased === 'string' && sortBased !== '') return sortBased

  return null
}

export interface NowPlayingWatcherOptions {
  /** Read lazily so a settings change takes effect without a restart. */
  getDataDir: () => string
  /** Period of the backstop poll, not of the normal path. See the file header. */
  getPollIntervalMs: () => number
  /** Join the now-playing hash to a library song, when the library has one. */
  resolveLibraryId: (hash: string | null) => string | null
}

const NOTHING_PLAYING: NowPlaying = { playing: false, song: null, updatedAt: 0 }

export class NowPlayingWatcher {
  #options: NowPlayingWatcherOptions
  #state: NowPlaying = { ...NOTHING_PLAYING, updatedAt: Date.now() }
  #art: AlbumArt | null = null
  #listeners = new Set<(state: NowPlaying) => void>()
  #timer: NodeJS.Timeout | null = null
  #stopped = true
  /** Guards against overlapping reads when a write lands mid-poll. */
  #ticking = false
  /** A write that arrived while a read was in flight. */
  #pending = false
  /** The normal path: YARG writes the file, we re-read it. */
  #file: FileWatcher

  constructor(options: NowPlayingWatcherOptions) {
    this.#options = options

    this.#file = new FileWatcher({
      getPath: () => {
        // An unconfigured directory must not become a watch on the process's
        // own cwd, which is what joining onto '' would produce.
        const dir = this.#options.getDataDir()
        return dir === '' ? '' : currentSongJsonPath(dir)
      },
      settleMs: WATCH_SETTLE_MS,
      // Deleting the file is YARG saying nothing is playing, so it has to reach
      // the banner like any other change.
      notifyOnMissing: true,
      onChange: () => this.#tick(),
      onError: (error) => {
        // The backstop poll covers this, so it is a note rather than a failure.
        console.warn('[now-playing] watch failed, falling back to polling:', error)
      },
    })
  }

  get current(): NowPlaying {
    return this.#state
  }

  /** Album art for the current song, or null. Server-side only. */
  get currentArt(): AlbumArt | null {
    return this.#art
  }

  async start(): Promise<void> {
    if (!this.#stopped) return
    this.#stopped = false

    await this.#file.start()
    // Not awaited: the first read can be up to three attempts against a file
    // YARG may be writing, and nothing else about startup needs to wait for it.
    void this.#tick()
  }

  /**
   * Follow a new data directory.
   *
   * The watch is bound to a directory, so unlike the poll it cannot pick up a
   * settings change by reading a closure on its next tick — it has to be
   * re-pointed, and then read once, because the new directory has a state of
   * its own that no event is going to arrive to announce.
   */
  async rearm(): Promise<void> {
    if (this.#stopped) return
    await this.#file.start()
    await this.#tick()
  }

  stop(): void {
    this.#stopped = true
    this.#file.stop()
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
  }

  subscribe(listener: (state: NowPlaying) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Re-resolve the library join, e.g. after the song list is reloaded. */
  refreshLibraryJoin(): void {
    const song = this.#state.song
    if (!song) return

    const libraryId = this.#options.resolveLibraryId(song.hash)
    if (libraryId === song.libraryId) return

    this.#setState({
      ...this.#state,
      song: { ...song, libraryId },
      updatedAt: Date.now(),
    })
  }

  /** Read now, then restart the backstop clock. */
  async #tick(): Promise<void> {
    if (this.#stopped) return

    if (this.#ticking) {
      // A write landed mid-read, and the read in flight may already be past it.
      // Owe another one rather than reading the same bytes twice concurrently.
      this.#pending = true
      return
    }

    this.#ticking = true
    try {
      await this.#poll()
    } catch (err) {
      console.warn('[now-playing] read failed:', err)
    } finally {
      this.#ticking = false
    }

    if (this.#pending && !this.#stopped) {
      this.#pending = false
      await this.#tick()
      return
    }

    this.#schedule()
  }

  /**
   * Arm the backstop.
   *
   * Always clears first: a watch event and an expiring timer both land here,
   * and leaving the old timer running would quietly double the poll rate every
   * time a song changed.
   */
  #schedule(): void {
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }

    if (this.#stopped) return

    const interval = Math.max(MIN_BACKSTOP_MS, this.#options.getPollIntervalMs())
    this.#timer = setTimeout(() => void this.#tick(), interval)
  }

  async #poll(): Promise<void> {
    const dataDir = this.#options.getDataDir()
    if (!dataDir) {
      this.#setNothingPlaying()
      return
    }

    const outcome = await readStable(currentSongJsonPath(dataDir))

    switch (outcome.kind) {
      case 'empty':
      case 'unreadable':
        this.#setNothingPlaying()
        return

      case 'malformed':
        // Inconclusive: hold whatever we last knew rather than flashing the UI.
        return

      case 'song':
        await this.#setPlaying(outcome.raw)
    }
  }

  #setNothingPlaying(): void {
    if (!this.#state.playing && this.#state.song === null) return

    this.#art = null
    this.#setState({ playing: false, song: null, updatedAt: Date.now() })
  }

  async #setPlaying(raw: Record<string, unknown>): Promise<void> {
    const hash = extractCurrentSongHash(raw.Hash)
    const location = locationOf(raw)

    // Only hit the filesystem for art when the song actually changed.
    const isSameSong =
      this.#state.playing &&
      this.#state.song !== null &&
      this.#state.song.hash === hash &&
      this.#state.song.name === stripRichText(raw.Name as string | undefined)

    if (!isSameSong) {
      this.#art = await findAlbumArt(location)
    }

    const song = toNowPlayingSong(raw, this.#options.resolveLibraryId(hash), this.#art !== null)

    if (isSameSong && this.#state.song && sameSong(this.#state.song, song)) return

    this.#setState({ playing: true, song, updatedAt: Date.now() })
  }

  #setState(state: NowPlaying): void {
    // A read is several awaits long — three attempts at the file, then possibly
    // a hunt for album art — and `stop()` can land in the middle of one. The
    // result of that read is about a directory we are no longer watching, so
    // publishing it would push a stale song to every subscriber on the way out,
    // or to the browsers still connected across a change of data directory.
    if (this.#stopped) return

    this.#state = state
    for (const listener of this.#listeners) {
      try {
        listener(state)
      } catch (err) {
        console.warn('[now-playing] listener failed:', err)
      }
    }
  }
}

/** Field-wise comparison, so we only notify subscribers on a real change. */
function sameSong(a: NowPlayingSong, b: NowPlayingSong): boolean {
  return (
    a.hash === b.hash &&
    a.libraryId === b.libraryId &&
    a.name === b.name &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.lengthSeconds === b.lengthSeconds &&
    a.hasArt === b.hasArt
  )
}
