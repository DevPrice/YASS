/**
 * The media subsystem's front door.
 *
 * Routes ask this for a file path and get one, or null. Everything behind it —
 * which container format the chart is, whether ffmpeg exists, whether the
 * thumbnail was already made, how many jobs are already running — is this
 * object's problem.
 *
 * Four rules shape it, and they are all about a room full of phones hitting one
 * laptop at once:
 *
 *  1. **Cache on disk, keyed by hash.** Derived media is immutable per hash and
 *     size, so a hit is a `stat` and nothing more.
 *  2. **One job per key.** Concurrent requests for the same song await the same
 *     promise. See `SingleFlight`.
 *  3. **A hard cap on concurrent ffmpeg.** `cpus - 2`, so the server stays
 *     responsive while the precompute pass grinds through 4,168 covers.
 *  4. **Remember failures, briefly.** A chart on a disconnected network share
 *     fails slowly. Without a negative cache, a phone scrolling past forty such
 *     songs queues forty slow failures.
 */

import { ChartIndex } from './index.js'
import { extractArt, deriveArt } from './art.js'
import { resolveFfmpeg, type FfmpegInfo } from './ffmpeg.js'
import { Semaphore, SingleFlight, defaultConcurrency } from './pool.js'
import { generatePreview } from './preview.js'
import {
  artPath,
  enforcePreviewCap,
  ensureMediaDirs,
  exists,
  previewPath,
  safeHash,
  DEFAULT_PREVIEW_CAP_BYTES,
  type ArtSize,
} from './store.js'

/**
 * How long a failure is remembered.
 *
 * Short enough that reconnecting a network share fixes itself within a song,
 * long enough that scrolling the list doesn't re-attempt every broken chart on
 * every render.
 */
const FAILURE_TTL_MS = 60_000

/**
 * How often ffmpeg is looked for again once it is missing.
 *
 * The tray can install it at any moment, and the answer must change without a
 * restart — but re-running the `PATH` search on every thumbnail request would
 * be dozens of `stat` calls per screenful.
 */
const FFMPEG_RECHECK_MS = 5_000

export interface MediaStatus {
  /** Absolute path to ffmpeg, or null when the features are dark. */
  ffmpeg: string | null
  ffmpegSource: FfmpegInfo['source'] | null
  /** Charts the index knows about. */
  charts: number
  /** True while the background thumbnail pass is running. */
  precomputing: boolean
  /** Covers made so far in this pass, and how many it set out to make. */
  precomputed: number
  precomputeTotal: number
}

export class MediaService {
  #charts: ChartIndex
  #jobs = new Semaphore(defaultConcurrency())
  #art = new SingleFlight<string | null>()
  #previews = new SingleFlight<string | null>()
  /**
   * Song length by hash, from the CSV.
   *
   * Only consulted when the audio's own duration cannot be had cheaply — a
   * mogg, where probing means a second pass over a file we just extracted from
   * a 25 MB package.
   */
  #lengths = new Map<string, number>()
  #previewCapBytes = DEFAULT_PREVIEW_CAP_BYTES

  /** key → epoch ms the failure expires. */
  #failures = new Map<string, number>()

  #ffmpeg: FfmpegInfo | null = null
  #ffmpegCheckedAt = 0

  #precomputing = false
  #precomputed = 0
  #precomputeTotal = 0
  #precomputeAbort: AbortController | null = null

  constructor(charts: ChartIndex) {
    this.#charts = charts
  }

  get status(): MediaStatus {
    return {
      ffmpeg: this.#ffmpeg?.path ?? null,
      ffmpegSource: this.#ffmpeg?.source ?? null,
      charts: this.#charts.size,
      precomputing: this.#precomputing,
      precomputed: this.#precomputed,
      precomputeTotal: this.#precomputeTotal,
    }
  }

  /**
   * Locate ffmpeg, remembering the answer.
   *
   * A positive answer is kept for the life of the process — a binary does not
   * move out from under us. A negative one is re-checked on a timer, because
   * the tray's fetch is exactly the thing that changes it.
   */
  async ffmpeg(): Promise<FfmpegInfo | null> {
    if (this.#ffmpeg !== null) return this.#ffmpeg

    const now = Date.now()
    if (now - this.#ffmpegCheckedAt < FFMPEG_RECHECK_MS) return null
    this.#ffmpegCheckedAt = now

    this.#ffmpeg = await resolveFfmpeg()
    if (this.#ffmpeg !== null) {
      console.log(`[media] using ffmpeg at ${this.#ffmpeg.path} (${this.#ffmpeg.source})`)
    }

    return this.#ffmpeg
  }

  /** Called after the tray installs ffmpeg, so the next request finds it. */
  invalidateFfmpeg(): void {
    this.#ffmpeg = null
    this.#ffmpegCheckedAt = 0
    this.#failures.clear()
  }

  #failed(key: string): boolean {
    const until = this.#failures.get(key)
    if (until === undefined) return false

    if (until <= Date.now()) {
      this.#failures.delete(key)
      return false
    }

    return true
  }

  #recordFailure(key: string): void {
    this.#failures.set(key, Date.now() + FAILURE_TTL_MS)
  }

  /**
   * The path to a song's thumbnail, generating it if needed.
   *
   * Null means "there is nothing to serve" for any reason — no chart, no cover
   * inside it, no ffmpeg, or a failure we are still remembering. The route
   * turns all of those into a 404 and the client draws the plate.
   */
  async artFile(hash: string, size: ArtSize): Promise<string | null> {
    const safe = safeHash(hash)
    if (safe === null) return null

    const path = artPath(safe, size)
    if (path === null) return null

    if (await exists(path)) return path

    const key = `art:${safe}:${size}`
    if (this.#failed(key)) return null

    return this.#art.run(key, async () => {
      // Re-check inside the flight: a concurrent job may have just made it.
      if (await exists(path)) return path

      const ref = this.#charts.get(safe)
      if (ref === null) return null

      const ffmpeg = await this.ffmpeg()
      if (ffmpeg === null) return null

      const made = await this.#jobs.run(async () => {
        const art = await extractArt(ref)
        if (art === null) return false

        await ensureMediaDirs()
        return deriveArt(ffmpeg.path, art, size, path)
      })

      if (!made) {
        this.#recordFailure(key)
        return null
      }

      return path
    })
  }

  /**
   * Make every small thumbnail, in the background.
   *
   * ~4,168 covers at ~0.36 s of ffmpeg each, across `cpus - 2` processes: a few
   * minutes. It runs after startup and off the request path, so the song list
   * is interactive immediately and the covers fill in behind it — which is the
   * behaviour a cold start has to have, since the alternative is a four-minute
   * splash screen.
   *
   * Only `sm`. The 640px size is generated when a song is actually opened;
   * precomputing it would double the time and the disk for covers most of which
   * nobody will look at closely.
   */
  async precomputeArt(hashes: readonly string[]): Promise<void> {
    if (this.#precomputing) return

    const ffmpeg = await this.ffmpeg()
    if (ffmpeg === null) return

    const wanted = hashes.filter((hash) => this.#charts.has(hash))
    if (wanted.length === 0) return

    this.#precomputing = true
    this.#precomputed = 0
    this.#precomputeTotal = wanted.length
    this.#precomputeAbort = new AbortController()
    const { signal } = this.#precomputeAbort

    const started = Date.now()
    let made = 0

    try {
      await ensureMediaDirs()

      /*
       * A fixed pool of workers pulling from a shared cursor, rather than
       * `Promise.all` over 4,168 promises.
       *
       * The semaphore in `artFile` would bound the ffmpeg processes either way,
       * but not the 4,168 pending promises and their closures, nor the 4,168
       * `stat` calls that would all be issued at once against a network share
       * before any of them resolved.
       */
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (cursor < wanted.length && !signal.aborted) {
          const hash = wanted[cursor++]!

          try {
            if ((await this.artFile(hash, 'sm')) !== null) made++
          } catch {
            // One unreadable chart must not end the pass.
          }

          this.#precomputed++
        }
      }

      await Promise.all(Array.from({ length: defaultConcurrency() }, worker))

      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      console.log(
        `[media] precomputed ${made} of ${wanted.length} thumbnails in ${seconds}s` +
          (signal.aborted ? ' (stopped early)' : ''),
      )
    } finally {
      this.#precomputing = false
      this.#precomputeAbort = null
    }
  }

  /** Stop the precompute pass — on shutdown, or before an index rebuild. */
  stopPrecompute(): void {
    this.#precomputeAbort?.abort()
  }

  /**
   * Tell the service how long each song is.
   *
   * Called whenever the library reloads. The CSV is the only place a song's
   * length is known without opening its audio.
   */
  setSongLengths(lengths: Iterable<readonly [string, number | null]>): void {
    this.#lengths = new Map()
    for (const [hash, seconds] of lengths) {
      if (seconds !== null && seconds > 0) this.#lengths.set(hash.toUpperCase(), seconds)
    }
  }

  /**
   * The path to a song's preview, generating it if needed.
   *
   * Unlike art, this is never precomputed: 4,168 previews would be ~600 MB and
   * a party plays perhaps thirty songs. A cold request costs about a second,
   * which the client hides by prefetching as soon as a song is selected.
   */
  async previewFile(hash: string): Promise<string | null> {
    const safe = safeHash(hash)
    if (safe === null) return null

    const path = previewPath(safe)
    if (path === null) return null

    if (await exists(path)) return path

    const key = `preview:${safe}`
    if (this.#failed(key)) return null

    return this.#previews.run(key, async () => {
      if (await exists(path)) return path

      const ref = this.#charts.get(safe)
      if (ref === null) return null

      const ffmpeg = await this.ffmpeg()
      if (ffmpeg === null) return null

      const made = await this.#jobs.run(async () => {
        await ensureMediaDirs()

        return generatePreview({
          ffmpegPath: ffmpeg.path,
          ref,
          hash: safe,
          destination: path,
          fallbackLengthSeconds: this.#lengths.get(safe) ?? null,
        })
      })

      if (!made) {
        this.#recordFailure(key)
        return null
      }

      // After writing, not before: the cap is about what is on disk, and
      // trimming first would leave the new file over it anyway. Fire and
      // forget — a full cache is not a reason to delay the response.
      void enforcePreviewCap(this.#previewCapBytes)
        .then((freed) => {
          if (freed > 0) {
            console.log(`[media] preview cache trimmed by ${(freed / 1024 / 1024).toFixed(1)} MB`)
          }
        })
        .catch(() => {})

      return path
    })
  }
}
