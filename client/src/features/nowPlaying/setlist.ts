/**
 * What the banner says about YARG's setlist.
 *
 * The server sends hashes joined to library ids and nothing else. Names come
 * from the library the client already holds, because that is where every other
 * surface gets them from, and a setlist naming a song differently from the row
 * it came from would be one more thing to reconcile.
 *
 * Kept apart from the banner so the rules are testable without rendering it.
 */

import type { Setlist, Song } from '@shared/types'
import { formatTitleCredit } from '../../lib/format'

export interface SetlistSummary {
  mode: 'building' | 'playing'
  /** 1-based position of the current song. Null unless `playing`. */
  position: number | null
  total: number
  /**
   * The next song's title, when the library knows it.
   *
   * Null in two different cases that `isLast` tells apart: the current song is
   * the last one, or the next one is a chart the library doesn't have (added
   * since YARG last scanned).
   */
  next: string | null
  isLast: boolean
}

/** Null when there is nothing worth saying: no plugin, or no setlist. */
export function summarizeSetlist(setlist: Setlist, songsById: ReadonlyMap<string, Song>): SetlistSummary | null {
  if (!setlist.available || setlist.mode === 'idle' || setlist.songs.length === 0) return null

  const total = setlist.songs.length

  if (setlist.mode === 'building' || setlist.index === null) {
    return { mode: 'building', position: null, total, next: null, isLast: false }
  }

  const isLast = setlist.index >= total - 1
  const nextId = isLast ? null : (setlist.songs[setlist.index + 1]?.libraryId ?? null)
  const nextSong = nextId === null ? undefined : songsById.get(nextId)

  return {
    mode: 'playing',
    position: setlist.index + 1,
    total,
    next: nextSong === undefined ? null : formatTitleCredit(nextSong),
    isLast,
  }
}
