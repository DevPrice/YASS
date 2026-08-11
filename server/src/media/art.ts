/**
 * Album art: getting it out of a chart, and turning it into a thumbnail.
 *
 * Three formats keep their cover in three different places, and this file is
 * the one place that knows all three:
 *
 *  - **Ini** — a sibling file. The `cover=` key from `song.ini` if there is
 *    one, then `album.png`, `album.jpg`, … in YARG's own order.
 *  - **Sng** — the same names, looked up in the container's listing table.
 *  - **CON / ExCON** — `songs/<sub>/gen/<sub>_keep.png_xbox`, a DXT texture
 *    that has to be decoded to pixels before ffmpeg will look at it.
 *
 * ## Why every path ends at ffmpeg
 *
 * The library holds 1.16 GB of album art — 3,208 JPEGs and 186 PNGs at
 * 1024×1024 and ~350 KB each, plus what is inside the containers. Serving those
 * unresized to a room full of phones is not an option: one screenful of the
 * song list would be 20 MB.
 *
 * ffmpeg does the resizing, which also means no native image dependency. That
 * is not a preference — the server bundles to a single ESM file, so `sharp`
 * could never have been part of this.
 *
 * The DXT path is where that choice pays off twice: `dxt.ts` produces raw RGBA,
 * and ffmpeg accepts raw RGBA on stdin (`-f rawvideo -pix_fmt rgba -s WxH`).
 * No intermediate encode, no temp file.
 */

import { readFile, readdir, rename, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { openConPackage, findConListing } from './stfs.js'
import { decodeDxt } from './dxt.js'
import { runFfmpeg } from './ffmpeg.js'
import { findListing, openSngPackage } from './sng.js'
import { ART_PIXELS, type ArtSize } from './store.js'
import type { ChartRef } from './types.js'

/**
 * Image extensions YARG accepts, in preference order.
 *
 * `IMAGE_EXTENSIONS` in `YARG.Core/Song/Entries/SongEntry.cs`. Worth noting
 * what is *not* here: `.webp`, which YARG does not read. An earlier version of
 * this app's now-playing art lookup accepted `.webp` and omitted `.tga` and
 * `.bmp`, which meant the two surfaces could disagree about whether a song had
 * a cover.
 */
export const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.tga',
  '.bmp',
  '.psd',
  '.gif',
  '.pic',
] as const

/** `album.png`, `album.jpg`, … — `ALBUMART_FILES` in YARG. */
export const ALBUMART_FILES = IMAGE_EXTENSIONS.map((extension) => `album${extension}`)

/**
 * Extracted art, in whichever form the source gave it.
 *
 * `encoded` is a real image file's bytes, which ffmpeg sniffs for itself.
 * `rgba` is decoded pixels from a DXT texture, which ffmpeg has to be told the
 * shape of.
 */
export type ExtractedArt =
  | { kind: 'encoded'; data: Buffer }
  | { kind: 'rgba'; data: Buffer; width: number; height: number }

/**
 * Read the `cover=` key out of a `song.ini`.
 *
 * A deliberately loose reader: `key = value` lines, `[section]` headers
 * ignored, `;` and `#` comments dropped. `song.ini` is authored by a dozen
 * different tools and half of them disagree about whitespace.
 */
function readIniKey(text: string, wanted: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('[')) continue

    const split = trimmed.indexOf('=')
    if (split === -1) continue

    if (trimmed.slice(0, split).trim().toLowerCase() === wanted) {
      return trimmed.slice(split + 1).trim()
    }
  }

  return null
}

/** Case-insensitive directory lookup, since charts ship `Album.PNG` too. */
async function directoryFiles(directory: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()

  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile()) files.set(entry.name.toLowerCase(), entry.name)
    }
  } catch {
    // Chart moved, or the share went away.
  }

  return files
}

async function extractIniArt(directory: string): Promise<ExtractedArt | null> {
  const files = await directoryFiles(directory)

  const candidates: string[] = []

  // The chart's own declared cover wins, exactly as it does in YARG.
  const iniName = files.get('song.ini')
  if (iniName !== undefined) {
    try {
      const cover = readIniKey(await readFile(join(directory, iniName), 'utf8'), 'cover')
      if (cover) candidates.push(cover.toLowerCase())
    } catch {
      // Unreadable `song.ini`. The conventional names still apply.
    }
  }

  candidates.push(...ALBUMART_FILES)

  for (const candidate of candidates) {
    const actual = files.get(candidate)
    if (actual === undefined) continue

    try {
      return { kind: 'encoded', data: await readFile(join(directory, actual)) }
    } catch {
      // Keep looking: a chart can name a cover it no longer ships.
    }
  }

  return null
}

async function extractSngArt(path: string): Promise<ExtractedArt | null> {
  const pkg = await openSngPackage(path)
  if (pkg === null) return null

  try {
    const cover = pkg.metadata.get('cover')
    const names = cover ? [cover, ...ALBUMART_FILES] : ALBUMART_FILES

    const found = findListing(pkg, names)
    if (found === null) return null

    return { kind: 'encoded', data: await pkg.readFile(found.listing) }
  } catch {
    return null
  } finally {
    await pkg.close()
  }
}

async function extractConArt(ref: ChartRef): Promise<ExtractedArt | null> {
  if (ref.subName === undefined) return null

  const pkg = await openConPackage(ref.path)
  if (pkg === null) return null

  try {
    const listing = findConListing(pkg, `songs/${ref.subName}/gen/${ref.subName}_keep.png_xbox`)
    if (listing === null) return null

    const decoded = decodeDxt(await pkg.read(listing))
    if (decoded === null) return null

    return { kind: 'rgba', data: decoded.rgba, width: decoded.width, height: decoded.height }
  } catch {
    return null
  } finally {
    await pkg.close()
  }
}

/**
 * An unpacked console package keeps the same texture as a loose file.
 *
 * `.png_xbox` on disk, or `.png_ps3` for a PS3-derived package — which is byte
 * -identical except that every adjacent pair is swapped, i.e. it is already in
 * the order `decodeDxt` swaps *into*. We only claim support for the Xbox
 * variant: swapping twice would be trivial, but nothing in this library is a
 * PKG and shipping an untested path is how a wrong image ends up on screen.
 */
async function extractExConArt(ref: ChartRef): Promise<ExtractedArt | null> {
  if (ref.subName === undefined) return null

  const path = join(ref.path, 'songs', ref.subName, 'gen', `${ref.subName}_keep.png_xbox`)

  try {
    if (!(await stat(path)).isFile()) return null

    const decoded = decodeDxt(await readFile(path))
    if (decoded === null) return null

    return { kind: 'rgba', data: decoded.rgba, width: decoded.width, height: decoded.height }
  } catch {
    return null
  }
}

/** Get a chart's cover in whatever form it is stored, or null. */
export async function extractArt(ref: ChartRef): Promise<ExtractedArt | null> {
  switch (ref.format) {
    case 'Ini':
      return extractIniArt(ref.path)
    case 'Sng':
      return extractSngArt(ref.path)
    case 'CON':
      return extractConArt(ref)
    case 'ExCON':
      return extractExConArt(ref)
  }
}

/**
 * Resize art to one of our sizes and write it as WebP.
 *
 * `increase_w` on the scale filter means a cover smaller than the target is
 * left alone rather than upscaled — a 200px `album.jpg` blown up to 640 is
 * bigger, blurrier, and no more informative.
 *
 * Written to a temp name and renamed into place, because the file it produces
 * is served directly: a reader must never see a half-written image, and two
 * generations racing must not interleave.
 */
export async function deriveArt(
  ffmpegPath: string,
  art: ExtractedArt,
  size: ArtSize,
  destination: string,
): Promise<boolean> {
  const pixels = ART_PIXELS[size]
  const temp = `${destination}.${process.pid}.tmp.webp`

  const input =
    art.kind === 'rgba'
      ? ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${art.width}x${art.height}`, '-i', 'pipe:0']
      : ['-i', 'pipe:0']

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...input,
    '-vf',
    `scale=${pixels}:${pixels}:force_original_aspect_ratio=decrease:flags=lanczos`,
    // One frame: a `.gif` cover is a real thing and we want its first frame,
    // not an animation.
    '-frames:v',
    '1',
    '-c:v',
    'libwebp',
    '-quality',
    '82',
    '-compression_level',
    '5',
    '-preset',
    'photo',
    temp,
  ]

  try {
    const result = await runFfmpeg(ffmpegPath, args, {
      input: art.data,
      // Generous: this runs against a network share, and the precompute pass
      // has `cpus - 2` of these going at once.
      timeoutMs: 30_000,
    })

    if (result.code !== 0) {
      console.warn(`[media] art derive failed (${result.code}): ${result.stderr.trim()}`)
      return false
    }

    await rename(temp, destination)
    return true
  } catch (error) {
    console.warn('[media] art derive failed:', error)
    return false
  }
}

/**
 * Guess a content type for art we are serving straight from a chart.
 *
 * Only used by the now-playing route, which still serves the original file
 * rather than a derived one — see `core/art.ts`.
 */
export function contentTypeForImage(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    case '.tga':
      return 'image/x-tga'
    default:
      return 'application/octet-stream'
  }
}
