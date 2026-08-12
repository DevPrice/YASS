/**
 * The chart index: hash → where that chart lives.
 *
 * One map, built from `songcache.bin` when we can read it and from a disk walk
 * when we can't, cached to disk so a restart is instant, and rebuilt when
 * YARG's cache file moves under us.
 *
 * Everything in `media/` downstream of this — art extraction, preview
 * generation — is a function of a `ChartRef`. This is where a hash from the CSV
 * becomes one.
 *
 * ## Why it persists
 *
 * Parsing `songcache.bin` takes ~15 ms, so the JSON cache is not about the fast
 * path. It is about the slow one: if the cache format has moved and the scanner
 * ran, that cost minutes, and paying it again on every restart would be
 * unreasonable. The persisted file records which strategy produced it and the
 * fingerprint it was built against, so a stale index is detected rather than
 * trusted.
 *
 * ## Freshness
 *
 * `songcache.bin` is rewritten whenever YARG rescans. We watch it exactly the
 * way `CsvWatcher` watches the CSV — parent directory, 500 ms debounce, confirm
 * by `{size, mtimeMs}` — because it is the same problem with the same three
 * traps: the file is replaced rather than appended to, the write is not atomic,
 * and a watcher must never throw into the event loop.
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { appConfigDir, songCachePath } from '../core/paths.js'
import { readSongCache } from './cache.js'
import { scanSongFolders } from './scan.js'
import type { ChartRef } from './types.js'

/** Bump when `ChartRef`'s shape changes, so an old file is discarded not misread. */
const INDEX_FORMAT_VERSION = 1

export type IndexSource = 'cache' | 'scan' | 'none'

export interface ChartIndexMeta {
  source: IndexSource
  /** How many charts are known. */
  count: number
  /** Epoch ms the index was built. */
  builtAt: number
  /** Why the cache path was not used, when it wasn't. Null when it was. */
  fallbackReason: string | null
}

interface PersistedIndex {
  version: number
  meta: ChartIndexMeta
  /** The fingerprint of `songcache.bin` this was built against, if any. */
  fingerprint: { size: number; mtimeMs: number } | null
  refs: ChartRef[]
}

export function chartIndexPath(): string {
  return join(appConfigDir(), 'cache', 'charts.json')
}

const EMPTY_META: ChartIndexMeta = {
  source: 'none',
  count: 0,
  builtAt: 0,
  fallbackReason: null,
}

/**
 * The map, plus how it was made.
 *
 * Deliberately a plain object rather than a class with a watcher inside it:
 * `AppState` owns lifecycle for everything else and there is no reason for this
 * to be the exception.
 */
export class ChartIndex {
  #byHash = new Map<string, ChartRef>()
  #meta: ChartIndexMeta = { ...EMPTY_META }

  get meta(): ChartIndexMeta {
    return this.#meta
  }

  get size(): number {
    return this.#byHash.size
  }

  /**
   * Look a song up by its canonical hash.
   *
   * Case-insensitive on the way in, because the CSV and `currentSong.json`
   * agree on uppercase hex but nothing enforces it.
   */
  get(hash: string | null | undefined): ChartRef | null {
    if (!hash) return null
    return this.#byHash.get(hash.toUpperCase()) ?? null
  }

  has(hash: string | null | undefined): boolean {
    return this.get(hash) !== null
  }

  /**
   * Replace the contents.
   *
   * First writer wins on a duplicate hash — the same rule `AppState` applies to
   * the CSV join, and for the same reason: duplicate charts share a hash and
   * either one is a fine source of art.
   */
  replace(refs: readonly ChartRef[], meta: ChartIndexMeta): void {
    const next = new Map<string, ChartRef>()
    for (const ref of refs) {
      if (!next.has(ref.hash)) next.set(ref.hash, ref)
    }

    this.#byHash = next
    this.#meta = { ...meta, count: next.size }
  }

  /** Every ref, for persistence. */
  toArray(): ChartRef[] {
    return [...this.#byHash.values()]
  }
}

/** `{size, mtimeMs}` of a file, or null when it isn't there. */
async function fingerprint(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const stats = await stat(path)
    return { size: stats.size, mtimeMs: stats.mtimeMs }
  } catch {
    return null
  }
}

const sameFingerprint = (
  a: { size: number; mtimeMs: number } | null,
  b: { size: number; mtimeMs: number } | null,
): boolean => (a === null || b === null ? a === b : a.size === b.size && a.mtimeMs === b.mtimeMs)

async function readPersisted(): Promise<PersistedIndex | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(chartIndexPath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null

    const persisted = parsed as PersistedIndex
    if (persisted.version !== INDEX_FORMAT_VERSION) return null
    if (!Array.isArray(persisted.refs)) return null

    return persisted
  } catch {
    return null
  }
}

/** Write via temp-and-rename, so a kill mid-write can't leave a torn index. */
async function writePersisted(persisted: PersistedIndex): Promise<void> {
  const path = chartIndexPath()
  await mkdir(dirname(path), { recursive: true })

  const temp = join(dirname(path), `charts.${process.pid}.tmp`)
  await writeFile(temp, JSON.stringify(persisted), 'utf8')
  await rename(temp, path)
}

export interface BuildOptions {
  yargDataDir: string
  /** Ignore the persisted index and rebuild from source. */
  force?: boolean
  onProgress?: (found: number) => void
  signal?: AbortSignal
}

/**
 * Build the index, preferring the cheapest source that works.
 *
 * Order is: the persisted file if its fingerprint still matches, then
 * `songcache.bin`, then a full scan. The scan is genuinely expensive, so it is
 * only reached when the cache file is missing or in a layout we have not
 * verified.
 */
export async function buildChartIndex(
  index: ChartIndex,
  options: BuildOptions,
): Promise<ChartIndexMeta> {
  const cachePath = songCachePath(options.yargDataDir)
  const current = await fingerprint(cachePath)

  if (options.force !== true) {
    const persisted = await readPersisted()
    // Only trust a persisted index built from a `songcache.bin` that has not
    // moved since. A scan-derived index has no fingerprint to check, so it is
    // reused only while the cache file is still unreadable — the moment one
    // appears, the fast path takes over.
    if (persisted !== null && sameFingerprint(persisted.fingerprint, current)) {
      index.replace(persisted.refs, persisted.meta)
      return index.meta
    }
  }

  let refs: ChartRef[] = []
  let source: IndexSource = 'none'
  let fallbackReason: string | null = null

  try {
    const { songs, version } = await readSongCache(cachePath)
    // The metadata rides along in the same parse — `core/library.ts` is what
    // wants it. Here it is thrown away rather than persisted: `charts.json`
    // exists to answer "where is this hash", and it stays that size.
    refs = songs.map((song) => song.ref)
    source = 'cache'
    console.log(`[media] read ${refs.length} charts from songcache.bin (version ${version})`)
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : String(error)
    console.warn(`[media] falling back to a disk scan: ${fallbackReason}`)

    try {
      refs = await scanSongFolders(options.yargDataDir, {
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      })
      source = refs.length > 0 ? 'scan' : 'none'
      console.log(`[media] scanned ${refs.length} charts from disk`)
    } catch (scanError) {
      // An aborted or failed scan leaves the previous index in place rather
      // than blanking media for the whole library.
      console.error('[media] scan failed:', scanError)
      return index.meta
    }
  }

  const meta: ChartIndexMeta = {
    source,
    count: refs.length,
    builtAt: Date.now(),
    fallbackReason,
  }

  index.replace(refs, meta)

  try {
    await writePersisted({
      version: INDEX_FORMAT_VERSION,
      meta: index.meta,
      // A scan is not tied to the cache file's identity; recording the
      // fingerprint anyway would claim it was built from a file it never read.
      fingerprint: source === 'cache' ? current : null,
      refs: index.toArray(),
    })
  } catch (error) {
    // A cache we cannot write is a slower next start, not a failure now.
    console.warn('[media] could not persist the chart index:', error)
  }

  return index.meta
}
