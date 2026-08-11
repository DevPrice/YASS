/**
 * Album art lookup for the currently playing song.
 *
 * `currentSong.json` gives us the chart's location on disk, and `.ini` charts
 * keep their art as a sibling file (`album.jpg`, `album.png`, …). This reads
 * that file and hands the route its path, so `/api/art/current` serves the
 * original bytes — no index, no ffmpeg, nothing derived.
 *
 * **This is no longer the only art the app can serve.** `media/` builds an
 * index of every chart's location out of YARG's own `songcache.bin`, which is
 * what gives the other four thousand songs covers — including the packed
 * formats this function still declines, since art inside a `.sng` or a CON has
 * to be extracted rather than pointed at. See `media/art.ts`.
 *
 * What keeps the two consistent is the candidate list: the `cover=` key from
 * `song.ini` first, then `album.*` in YARG's extension order. If these two
 * files disagreed, a song's cover would change when it started playing.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

/**
 * Extensions YARG will actually load, in its own preference order.
 *
 * Taken from `IMAGE_EXTENSIONS` in `YARG.Core/Song/Entries/SongEntry.cs`, and
 * kept identical to the list `media/art.ts` uses for the rest of the library —
 * the two surfaces answering "does this song have a cover" differently is a bug
 * that shows up as art appearing when a song starts and vanishing when it ends.
 *
 * This list previously accepted `.webp`, which YARG does not support, and
 * omitted `.tga` and `.bmp`, which it does.
 */
const ART_EXTENSIONS = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.tga', 'image/x-tga'],
  ['.bmp', 'image/bmp'],
  ['.psd', 'image/vnd.adobe.photoshop'],
  ['.gif', 'image/gif'],
  ['.pic', 'application/octet-stream'],
])

/** Extension preference, as an index — earlier wins. */
const EXTENSION_ORDER = [...ART_EXTENSIONS.keys()]

/**
 * Basenames to try, in preference order.
 *
 * `album` is YARG's. `cover` and `albumart` are not — they are Clone Hero
 * conventions this app accepted before it could read `song.ini`, and they stay
 * as a fallback because a chart that ships only `cover.png` still has a cover a
 * person would want to see. The chart's declared `cover=` key takes priority
 * over all of them; see `media/art.ts`.
 */
const ART_BASENAMES = ['album', 'cover', 'albumart']

export interface AlbumArt {
  path: string
  contentType: string
  size: number
  mtimeMs: number
}

/**
 * Find album art next to a chart.
 *
 * `location` is the chart directory for `.ini` charts, or the container file
 * for packed formats. Returns null when there's nothing servable.
 */
export async function findAlbumArt(location: string | null | undefined): Promise<AlbumArt | null> {
  if (!location) return null

  let isDirectory: boolean
  try {
    isDirectory = (await stat(location)).isDirectory()
  } catch {
    // Chart moved, drive not mounted (the library spans a network share), or
    // YARG is pointing somewhere we can't read.
    return null
  }

  // Packed container — art is inside, and we don't parse those formats.
  if (!isDirectory) return null

  let entries: string[]
  try {
    entries = await readdir(location)
  } catch {
    return null
  }

  // Match case-insensitively: charts come from many tools and ship `Album.png`
  // as readily as `album.png`.
  const byLowerName = new Map(entries.map((name) => [name.toLowerCase(), name]))

  /**
   * The chart's own declared cover comes first, exactly as it does in YARG.
   *
   * Without this, a chart shipping both a `cover=front.jpg` key and a stray
   * `album.png` showed the stray one here and the declared one in the game.
   */
  const iniName = byLowerName.get('song.ini')
  if (iniName !== undefined) {
    try {
      const declared = readIniCover(await readFile(join(location, iniName), 'utf8'))
      const actual = declared === null ? undefined : byLowerName.get(declared.toLowerCase())

      if (actual !== undefined) {
        const found = await describe(join(location, actual))
        if (found !== null) return found
      }
    } catch {
      // Unreadable `song.ini`; the conventional names below still apply.
    }
  }

  // Ranked by basename first and extension second, so `album.png` beats
  // `album.jpg` and both beat `cover.png` — YARG's order.
  let best: { name: string; rank: number; contentType: string } | null = null

  for (const name of entries) {
    const extension = extname(name).toLowerCase()
    const contentType = ART_EXTENSIONS.get(extension)
    if (!contentType) continue

    const base = name.slice(0, name.length - extension.length).toLowerCase()
    const baseRank = ART_BASENAMES.indexOf(base)
    if (baseRank === -1) continue

    const rank = baseRank * EXTENSION_ORDER.length + EXTENSION_ORDER.indexOf(extension)

    if (!best || rank < best.rank) {
      best = { name, rank, contentType }
    }
  }

  if (!best) return null

  return describe(join(location, best.name))
}

/** Stat a file and describe it for the route, or null if it went away. */
async function describe(path: string): Promise<AlbumArt | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null

    return {
      path,
      contentType: ART_EXTENSIONS.get(extname(path).toLowerCase()) ?? 'application/octet-stream',
      size: info.size,
      mtimeMs: info.mtimeMs,
    }
  } catch {
    return null
  }
}

/**
 * The `cover=` value from a `song.ini`, or null.
 *
 * Loose on purpose: `key = value` lines, sections and comments skipped.
 * `song.ini` is authored by a dozen tools that disagree about whitespace.
 */
function readIniCover(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('[')) continue

    const split = trimmed.indexOf('=')
    if (split === -1) continue

    if (trimmed.slice(0, split).trim().toLowerCase() === 'cover') {
      const value = trimmed.slice(split + 1).trim()
      return value === '' ? null : value
    }
  }

  return null
}
