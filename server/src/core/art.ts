/**
 * Album art lookup for the currently playing song.
 *
 * `currentSong.json` gives us the chart's location on disk, and `.ini` charts
 * keep their art as a sibling file (`album.jpg`, `album.png`, …). That is the
 * only art we can serve today.
 *
 * Packed charts (`.sng` / `.yargsong`, CON, ExCON) embed art inside the
 * container, which would need a format parser — those return null and the UI
 * falls back to a placeholder.
 *
 * Note this only ever runs for the *current* song. The CSV export has no path
 * column, so library-list art isn't possible until YARG publishes an index that
 * includes locations.
 */

import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

/** Art basenames YARG/Clone Hero charts use, in preference order. */
const ART_BASENAMES = ['album', 'cover', 'albumart']

const ART_EXTENSIONS = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])

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
  let best: { name: string; rank: number; contentType: string } | null = null

  for (const name of entries) {
    const extension = extname(name).toLowerCase()
    const contentType = ART_EXTENSIONS.get(extension)
    if (!contentType) continue

    const base = name.slice(0, name.length - extension.length).toLowerCase()
    const rank = ART_BASENAMES.indexOf(base)
    if (rank === -1) continue

    if (!best || rank < best.rank) {
      best = { name, rank, contentType }
    }
  }

  if (!best) return null

  const path = join(location, best.name)
  try {
    const info = await stat(path)
    return {
      path,
      contentType: best.contentType,
      size: info.size,
      mtimeMs: info.mtimeMs,
    }
  } catch {
    return null
  }
}
