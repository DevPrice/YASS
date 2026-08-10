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
 *  3. **No change notification.** No socket, no event. Polling at ~1 Hz is
 *     plenty; the file only changes at song start, pause, and scene changes.
 */

import { readFile } from 'node:fs/promises'

import type { NowPlaying, NowPlayingSong } from '@shared/types.js'
import { findAlbumArt, type AlbumArt } from './art.js'
import { extractCurrentSongHash } from './hash.js'
import { currentSongJsonPath } from './paths.js'
import { stripRichText } from './richtext.js'

/** Re-reads before concluding the file is genuinely blank. */
const CONFIRM_ATTEMPTS = 3

/** Gap between confirmation re-reads — long enough for a write to complete. */
const CONFIRM_DELAY_MS = 75

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
  /** Guards against overlapping ticks when a poll outlives its interval. */
  #ticking = false

  constructor(options: NowPlayingWatcherOptions) {
    this.#options = options
  }

  get current(): NowPlaying {
    return this.#state
  }

  /** Album art for the current song, or null. Server-side only. */
  get currentArt(): AlbumArt | null {
    return this.#art
  }

  start(): void {
    if (!this.#stopped) return
    this.#stopped = false
    void this.#tick()
  }

  stop(): void {
    this.#stopped = true
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

  async #tick(): Promise<void> {
    if (this.#stopped) return

    if (!this.#ticking) {
      this.#ticking = true
      try {
        await this.#poll()
      } catch (err) {
        console.warn('[now-playing] poll failed:', err)
      } finally {
        this.#ticking = false
      }
    }

    if (this.#stopped) return

    const interval = Math.max(250, this.#options.getPollIntervalMs())
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
