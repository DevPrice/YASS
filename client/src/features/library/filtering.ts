/**
 * Search, filter, and sort over the in-memory song list.
 *
 * Pure functions with no React in them, so the behaviour is testable and the
 * hook layer stays thin.
 */

import type { InstrumentGroup, Song } from '@shared/types'
import { INSTRUMENTS } from '@shared/types'
import { artistCredit, foldForSearch } from '../../lib/format'

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
  /** Drop the covers — everything the rows introduce with `as made famous by`. */
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
  return filters.search.trim() !== '' || panelFilterCount(filters) > 0
}

/**
 * How many filter dimensions the collapsible panel currently constrains.
 *
 * Search is excluded on purpose: it has its own always-visible field, so
 * counting it here would make the panel's badge answer for a control the panel
 * doesn't own. Instruments count once however many are picked — the badge
 * answers "how many things are narrowing this list", not "how many taps".
 */
export function panelFilterCount(filters: Filters): number {
  return (
    (filters.sources.length > 0 ? 1 : 0) +
    (filters.genres.length > 0 ? 1 : 0) +
    (filters.formats.length > 0 ? 1 : 0) +
    (filters.instruments.length > 0 ? 1 : 0) +
    (filters.minDifficulty !== null ? 1 : 0) +
    (filters.maxDifficulty !== null ? 1 : 0) +
    (filters.masterOnly ? 1 : 0)
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
    // The same judgment the rows show, not the raw `Master` column: a chart
    // credited to `Blondie (WaveGroup)` reads `as made famous by` whatever that
    // column says, and `Originals only` has to hide exactly what it marks.
    if (filters.masterOnly && artistCredit(song).madeFamousBy) return false

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
 * Leading punctuation, stripped before anything else is read.
 *
 * `…And Justice for All` has to lose its ellipsis before the article rule can
 * see the `And` behind it, and `(What's the Story) Morning Glory?` files under
 * W rather than under `(`.
 */
const LEADING_NOISE = /^[\p{P}\p{S}\s]+/u

/**
 * The articles a title is filed *behind* rather than under.
 *
 * `an` is included though it wasn't asked for: it is the same word as `a` doing
 * the same job, and filing `A Hard Day's Night` under H while `An Innocent Man`
 * stayed under A would read as a bug rather than as a rule. Only English —
 * `Los Lobos` and `Die Ärzte` keep their articles, because knowing that `Die`
 * is an article there and a verb here needs a language tag the CSV doesn't
 * carry.
 *
 * The trailing `\s+` is what makes this safe: it cannot fire on `A.M.`, on
 * `Anthrax`, or on a title that is the bare word `The`.
 */
const LEADING_ARTICLE = /^(?:an?|the)\s+/iu

/**
 * Apostrophes vanish rather than becoming a gap, so `Don't Stop` files as
 * `Dont Stop` — beside `Donna`, which is where someone looking for it will
 * run their finger. Every other mark becomes a space instead: `AC/DC` is two
 * words and sorting it as `ACDC` would be the same mistake in reverse.
 */
const APOSTROPHES = /['‘’ʼ`´]/gu
const SEPARATORS = /[\p{P}\p{S}]+/gu

/**
 * The form a title, artist or album is *filed* under — never the form shown.
 *
 * Diacritics and case are deliberately left alone: the collator already folds
 * both at `sensitivity: 'base'`, and stripping them here would overrule the
 * locale on a question it answers better than we can — Swedish files `ö` after
 * `z`, and `Motörhead` should land wherever the reader's locale puts it.
 *
 * A value that is *entirely* punctuation keeps its original text. `!!!` is a
 * band, and normalizing it to an empty string would file it with the songs
 * that have no artist at all.
 */
export function normalizeForSort(value: string): string {
  const normalized = value
    .replace(LEADING_NOISE, '')
    .replace(LEADING_ARTICLE, '')
    .replace(APOSTROPHES, '')
    .replace(SEPARATORS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

  return normalized === '' ? value.trim() : normalized
}

/**
 * The three normalized fields, computed once per song.
 *
 * Same reasoning as `searchTextCache`: `sortSongs` runs on every sort change
 * and every filter change, and a comparator that normalized on each call would
 * do it O(n log n) times across four thousand songs instead of n.
 */
interface SortText {
  name: string
  artist: string
  album: string
}

const sortTextCache = new WeakMap<Song, SortText>()

function sortTextFor(song: Song): SortText {
  const cached = sortTextCache.get(song)
  if (cached !== undefined) return cached

  const text: SortText = {
    name: normalizeForSort(song.name),
    // The displayed artist, not the raw field: a cover filed as
    // `Blondie (WaveGroup)` sorts into Blondie's run, where the name the row
    // shows says it belongs — and where the artist headers can then find it.
    artist: normalizeForSort(artistCredit(song).name),
    album: normalizeForSort(song.album),
  }

  sortTextCache.set(song, text)
  return text
}

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

/**
 * How one artist's songs order among themselves: year, then album, then title.
 *
 * Alphabetical-by-title was the wrong shape for the one place the list is read
 * as a body of work. Somebody scrolling to an artist is looking at what that
 * artist made, and the order that answers it is the order they made it in —
 * early records first, an album's songs together rather than scattered through
 * the alphabet by their opening letter.
 *
 * **Track number belongs in this chain and is not in the data.** The CSV export
 * has no column for it — `shared/types.ts` carries `albumTrack` only on
 * `NowPlayingSong`, which YARG writes one song at a time into
 * `currentSong.json`. So an album's songs land in title order rather than
 * running order, and the step slots in here without reshuffling anything else
 * if a future export ever carries it.
 *
 * Always ascending, whichever way the artist column points, for the same reason
 * every other tiebreak here is: flipping the direction should reverse the
 * artists, not shuffle each artist's songs into reverse-chronological order.
 * A song with no year sorts after the dated ones and an untitled album after
 * the named ones — unknown last, the rule the whole file uses — and title
 * settles whatever is left, so the two songs that share everything still land
 * in a fixed order rather than wherever the sort happened to leave them.
 */
function compareWithinArtist(a: Song, b: Song): number {
  const byYear = compareNullableNumbers(a.yearNumber, b.yearNumber, 'asc')
  if (byYear !== 0) return byYear

  const byAlbum = compareStrings(sortTextFor(a).album, sortTextFor(b).album, 'asc')
  if (byAlbum !== 0) return byAlbum

  return collator.compare(sortTextFor(a).name, sortTextFor(b).name)
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
      // Title, artist and album sort on their filed form; everything below
      // them sorts on what the CSV said. A charter handle is a username and a
      // source id is an identifier — neither has an article to look behind.
      case 'name':
        primary = compareStrings(sortTextFor(a).name, sortTextFor(b).name, direction)
        break
      case 'album':
        primary = compareStrings(sortTextFor(a).album, sortTextFor(b).album, direction)
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
        primary = compareStrings(sortTextFor(a).artist, sortTextFor(b).artist, direction)
    }

    if (primary !== 0) return primary

    // Under one artist, a discography rather than an alphabet.
    if (key === 'artist') return compareWithinArtist(a, b)

    // Stable, predictable tiebreak: artist → name, always ascending, so equal
    // keys don't reshuffle when the direction flips. Normalized too — a
    // tiebreak that filed The Beatles somewhere the artist column wouldn't
    // would undo the rule one level down.
    const byArtist = collator.compare(sortTextFor(a).artist, sortTextFor(b).artist)
    if (byArtist !== 0) return byArtist

    return collator.compare(sortTextFor(a).name, sortTextFor(b).name)
  })

  return sorted
}
