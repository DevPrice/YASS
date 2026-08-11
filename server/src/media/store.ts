/**
 * Where derived media lives on disk, and how much of it is allowed to.
 *
 * ```
 *   %APPDATA%\yass\cache\
 *     charts.json          the chart index (see index.ts)
 *     art\<hash>.sm.webp   256px thumbnails, precomputed for the whole library
 *     art\<hash>.lg.webp   640px covers, generated when a song is opened
 *     preview\<hash>.opus  ~30s previews, generated when one is played
 * ```
 *
 * Two different caching stories, on purpose:
 *
 * **Art is bounded and precomputed.** Two sizes across 4,168 songs is roughly
 * 60 MB, which is small enough to simply keep. Every entry is immutable — the
 * hash *is* the content key — so nothing ever needs invalidating.
 *
 * **Previews are unbounded and are not.** 4,168 opus files would be ~600 MB for
 * a party that plays thirty songs, so they are generated on demand and kept
 * under an LRU cap. The cap is enforced rather than advisory: a long-lived
 * install that has been to a hundred parties must not quietly fill the disk.
 */

import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { mediaCacheDir } from '../core/paths.js'

export { mediaCacheDir }

export type ArtSize = 'sm' | 'lg'

/** Pixel dimensions per size. Square: covers are square and so is the slot. */
export const ART_PIXELS: Record<ArtSize, number> = {
  // Twice the 48px row thumbnail's largest sensible rendering, so a 3x phone
  // gets a sharp image and the file still averages ~11 KB.
  sm: 256,
  // The detail plate is ~410px in the desktop pane and ~340px in a phone sheet.
  lg: 640,
}

export function isArtSize(value: string): value is ArtSize {
  return value === 'sm' || value === 'lg'
}

/** Default ceiling on the preview cache. ~10,000 previews at ~200 KB each. */
export const DEFAULT_PREVIEW_CAP_BYTES = 2 * 1024 * 1024 * 1024

export function artDir(): string {
  return join(mediaCacheDir(), 'art')
}

export function previewDir(): string {
  return join(mediaCacheDir(), 'preview')
}

/**
 * Path for one derived file.
 *
 * The hash is validated by the route before it reaches here, but these build
 * filesystem paths out of a URL segment, so they refuse anything that isn't
 * 40 hex characters rather than trusting the caller to have checked.
 */
export function artPath(hash: string, size: ArtSize): string | null {
  const safe = safeHash(hash)
  return safe === null ? null : join(artDir(), `${safe}.${size}.webp`)
}

export function previewPath(hash: string): string | null {
  const safe = safeHash(hash)
  return safe === null ? null : join(previewDir(), `${safe}.opus`)
}

/** Canonical uppercase hex, or null. The only thing allowed into a filename. */
export function safeHash(hash: string | null | undefined): string | null {
  if (!hash) return null
  const trimmed = hash.trim()
  if (trimmed.length !== 40 || !/^[0-9a-fA-F]+$/.test(trimmed)) return null
  return trimmed.toUpperCase()
}

export async function ensureMediaDirs(): Promise<void> {
  await mkdir(artDir(), { recursive: true })
  await mkdir(previewDir(), { recursive: true })
}

/** Size in bytes, or null when the file isn't there. */
export async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

export async function exists(path: string): Promise<boolean> {
  return (await fileSize(path)) !== null
}

/**
 * Delete the least recently used previews until the cache fits.
 *
 * By access time, falling back to modification time — `atime` is what "least
 * recently used" means, but Windows updates it lazily and some mounts disable
 * it entirely, so `max(atime, mtime)` is the honest reading of "when was this
 * last relevant".
 *
 * Returns the number of bytes freed, for the log line.
 */
export async function enforcePreviewCap(
  capBytes: number = DEFAULT_PREVIEW_CAP_BYTES,
): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(previewDir())
  } catch {
    return 0
  }

  const files: Array<{ path: string; size: number; used: number }> = []
  let total = 0

  for (const name of entries) {
    if (!name.endsWith('.opus')) continue

    const path = join(previewDir(), name)
    try {
      const info = await stat(path)
      if (!info.isFile()) continue

      files.push({ path, size: info.size, used: Math.max(info.atimeMs, info.mtimeMs) })
      total += info.size
    } catch {
      // Deleted between the listing and the stat. Nothing to account for.
    }
  }

  if (total <= capBytes) return 0

  // Oldest first, so the first deletions are the ones nobody has played.
  files.sort((a, b) => a.used - b.used)

  let freed = 0
  for (const file of files) {
    if (total - freed <= capBytes) break

    try {
      await unlink(file.path)
      freed += file.size
    } catch {
      // Another process holds it, or it just went away. Either way, move on.
    }
  }

  return freed
}

/**
 * Delete every derived file.
 *
 * The chart index is deliberately left alone: it is not derived media, it is
 * the map that lets any of this be regenerated, and rebuilding it can mean a
 * multi-minute scan.
 */
export async function clearDerivedMedia(): Promise<void> {
  await rm(artDir(), { recursive: true, force: true })
  await rm(previewDir(), { recursive: true, force: true })
  await ensureMediaDirs()
}
