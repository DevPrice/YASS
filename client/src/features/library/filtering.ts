/**
 * Search, filter, and sort over the in-memory song list.
 *
 * Pure functions with no React in them, so the behaviour is testable and the
 * hook layer stays thin.
 */

import type { InstrumentGroup, Song } from '@shared/types'
import { INSTRUMENTS } from '@shared/types'
import { foldForSearch } from '../../lib/format'

export type SortKey =
  | 'name'
  | 'artist'
  | 'album'
  | 'year'
  | 'length'
  | 'bandDifficulty'
  | 'charter'
  | 'source'
  | 'genre'

export type SortDirection = 'asc' | 'desc'

export interface Filters {
  search: string
  sources: string[]
  genres: string[]
  formats: string[]
  /** Only songs charting every selected instrument group. */
  instruments: InstrumentGroup[]
  /** Inclusive band-difficulty bounds; null means unbounded. */
  minDifficulty: number | null
  maxDifficulty: number | null
  masterOnly: boolean
}

export const EMPTY_FILTERS: Filters = {
  search: '',
  sources: [],
  genres: [],
  formats: [],
  instruments: [],
  minDifficulty: null,
  maxDifficulty: null,
  masterOnly: false,
}

export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.sources.length > 0 ||
    filters.genres.length > 0 ||
    filters.formats.length > 0 ||
    filters.instruments.length > 0 ||
    filters.minDifficulty !== null ||
    filters.maxDifficulty !== null ||
    filters.masterOnly
  )
}

/** Instrument keys that satisfy each group, precomputed once. */
const GROUP_KEYS = new Map<InstrumentGroup, readonly (typeof INSTRUMENTS)[number]['key'][]>()
for (const instrument of INSTRUMENTS) {
  const existing = GROUP_KEYS.get(instrument.group) ?? []
  GROUP_KEYS.set(instrument.group, [...existing, instrument.key])
}

function hasInstrumentGroup(song: Song, group: InstrumentGroup): boolean {
  const keys = GROUP_KEYS.get(group) ?? []
  return keys.some((key) => song.difficulties[key] !== null)
}

/**
 * A song's searchable text, folded once and cached.
 *
 * Recomputing this per keystroke across thousands of songs is the difference
 * between instant and sluggish, so it's memoized against the Song object.
 */
const searchTextCache = new WeakMap<Song, string>()

function searchTextFor(song: Song): string {
  const cached = searchTextCache.get(song)
  if (cached !== undefined) return cached

  const text = foldForSearch(
    [song.name, song.artist, song.album, song.charter, song.genre, song.year].join(' '),
  )

  searchTextCache.set(song, text)
  return text
}

/**
 * Match every whitespace-separated term independently, so "beatles yellow"
 * finds "Yellow Submarine" by The Beatles regardless of term order.
 */
function matchesSearch(song: Song, terms: readonly string[]): boolean {
  if (terms.length === 0) return true

  const haystack = searchTextFor(song)
  return terms.every((term) => haystack.includes(term))
}

export function filterSongs(songs: readonly Song[], filters: Filters): Song[] {
  const terms = foldForSearch(filters.search).split(/\s+/).filter(Boolean)

  // Sets beat repeated Array.includes when a facet has many selections.
  const sources = new Set(filters.sources)
  const genres = new Set(filters.genres)
  const formats = new Set(filters.formats)

  return songs.filter((song) => {
    if (sources.size > 0 && !sources.has(song.source)) return false
    if (genres.size > 0 && !genres.has(song.genre)) return false
    if (formats.size > 0 && !formats.has(song.format)) return false
    if (filters.masterOnly && !song.isMaster) return false

    if (filters.minDifficulty !== null) {
      if (song.bandDifficulty === null || song.bandDifficulty < filters.minDifficulty) return false
    }
    if (filters.maxDifficulty !== null) {
      if (song.bandDifficulty === null || song.bandDifficulty > filters.maxDifficulty) return false
    }

    for (const group of filters.instruments) {
      if (!hasInstrumentGroup(song, group)) return false
    }

    return matchesSearch(song, terms)
  })
}

/** Locale-aware, case-insensitive, and numeric-aware ("Track 2" before "Track 10"). */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * Compare two possibly-null numbers, always sorting null last regardless of
 * direction — an unknown year is never "the earliest".
 */
function compareNullableNumbers(a: number | null, b: number | null, direction: SortDirection): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return direction === 'asc' ? a - b : b - a
}

function compareStrings(a: string, b: string, direction: SortDirection): number {
  // Empty strings sort last for the same reason nulls do.
  if (a === '' && b !== '') return 1
  if (b === '' && a !== '') return -1

  const result = collator.compare(a, b)
  return direction === 'asc' ? result : -result
}

export function sortSongs(songs: Song[], key: SortKey, direction: SortDirection): Song[] {
  const sorted = [...songs]

  sorted.sort((a, b) => {
    let primary: number

    switch (key) {
      case 'year':
        primary = compareNullableNumbers(a.yearNumber, b.yearNumber, direction)
        break
      case 'length':
        primary = compareNullableNumbers(a.lengthSeconds, b.lengthSeconds, direction)
        break
      case 'bandDifficulty':
        primary = compareNullableNumbers(a.bandDifficulty, b.bandDifficulty, direction)
        break
      case 'name':
        primary = compareStrings(a.name, b.name, direction)
        break
      case 'album':
        primary = compareStrings(a.album, b.album, direction)
        break
      case 'charter':
        primary = compareStrings(a.charter, b.charter, direction)
        break
      case 'source':
        primary = compareStrings(a.source, b.source, direction)
        break
      case 'genre':
        primary = compareStrings(a.genre, b.genre, direction)
        break
      case 'artist':
      default:
        primary = compareStrings(a.artist, b.artist, direction)
    }

    if (primary !== 0) return primary

    // Stable, predictable tiebreak: artist → name, always ascending, so equal
    // keys don't reshuffle when the direction flips.
    if (key !== 'artist') {
      const byArtist = collator.compare(a.artist, b.artist)
      if (byArtist !== 0) return byArtist
    }

    return collator.compare(a.name, b.name)
  })

  return sorted
}
