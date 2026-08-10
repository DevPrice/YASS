/**
 * Category headers over the sorted list.
 *
 * Four thousand rows scroll past as an undifferentiated stream, and the sort
 * header names the *columns* rather than telling you where in the library you
 * currently are. These break the run into the divisions the sort already
 * implies: one per artist, per album, per source, per genre; one per decade of
 * years; one per leading letter of a title.
 *
 * **A header should not repeat what the row beneath it already says — and how
 * much the row says depends on how wide it is.** Artist is the one key that
 * groups differently at the two widths.
 *
 * The wide row gives the artist a column of its own, so a header naming it
 * divides the table along the axis the sort just ordered it by, and there is
 * vertical room to spend on saying so. The narrow row stacks the artist
 * directly under the title on every row, where the same header is that string
 * twice over, 2.6 rows apart — 1,586 of them across a real 4,168-song library,
 * 16% of the entire scroll height, on the device with the least of it. There it
 * groups by leading letter instead, which is the answer the title sort already
 * gives, for the same reason.
 *
 * **Groups are found by walking the sorted list, never by bucketing it.** The
 * songs arrive in order, so a header goes in wherever consecutive songs stop
 * agreeing — which means the grouping cannot disagree with the ordering, and
 * descending sorts get descending headers for free rather than through a second
 * rule that has to be kept in step with the first.
 *
 * Only the keys where a division means something get headers. `charter` is a
 * person rather than a category — a header per charter would be one header per
 * row for most of a library.
 *
 * **Length and difficulty are continuous, and are grouped anyway, because YARG
 * has already cut them.** Both were left out on the grounds that a number line
 * has no natural divisions, which is true and was the wrong conclusion: the
 * divisions do not have to be natural, they have to be *the ones the player
 * already knows*. YARG's own filter menu cuts band difficulty into seven named
 * intensities and length into four buckets, and somebody who has picked a song
 * in the game has read both scales. Inventing our own would have been the
 * mistake; borrowing theirs costs nothing and makes the two longest unbroken
 * runs in the library navigable. `lib/format.ts` holds the tables and cites the
 * files they came from.
 */

import type { Song } from '@shared/types'
import {
  artistCredit,
  foldForSearch,
  intensityName,
  intensityTier,
  lengthBucket,
  LENGTH_BUCKETS,
} from '../../lib/format'
import { sourceName } from '../../lib/sources'
import { normalizeForSort } from './filtering'
import type { SortKey } from './filtering'

/** A header, or a song, in the order they are rendered. */
export type ListItem =
  | { kind: 'header'; key: string; label: string }
  /** `position` is the song's ordinal among songs, which headers must not shift. */
  | { kind: 'song'; key: string; song: Song; position: number }

/**
 * What a group is called, and what makes two songs part of the same one.
 *
 * `id` is compared with `===` against the previous song's, so it has to be
 * canonical — case and diacritics folded away for anything the collator sorts
 * at base sensitivity, or `Beyoncé` and `Beyonce` would sort adjacent and then
 * be given a header each.
 */
export interface Group {
  id: string
  label: string
}

const DIGIT = /\p{Nd}/u
const LETTER = /\p{L}/u

/**
 * Titles that are nothing but punctuation.
 *
 * `normalizeForSort` hands those back their original text rather than an empty
 * string, so `!!!` stays `!!!` and sorts ahead of every letter — which puts the
 * whole class of them in one run at the top of the list, wanting one header.
 * `#` rather than a word because the neighbouring headers are single
 * characters, and `0–9` already has the numbers.
 */
export const SYMBOL: Group = { id: 'symbol', label: '#' }
export const NUMBER: Group = { id: 'number', label: '0–9' }

const UNTITLED: Group = { id: 'untitled', label: '—' }
const UNKNOWN_ARTIST: Group = { id: 'artist:unknown', label: 'Unknown artist' }

/**
 * One header per leading letter, and one for every digit rather than ten.
 *
 * `1979`, `21 Guns` and `99 Problems` have nothing to do with each other beyond
 * starting with a number, and nobody hunting for one of them scans for the
 * digit it happens to begin with.
 *
 * Reads the *filed* form, so this agrees with the sort about where a run
 * begins: `The Beatles` is filed under `Beatles` and gets the `B` header the
 * ordering already put it in.
 */
export function initialGroup(raw: string, missing: Group): Group {
  const filed = normalizeForSort(raw)

  // Code points, not code units: an emoji or an astral-plane character would
  // otherwise be split down the middle and tested as half of itself.
  const first = [...filed][0]
  if (first === undefined) return missing

  if (DIGIT.test(first)) return NUMBER
  if (!LETTER.test(first)) return SYMBOL

  // Folded, so É and E share a header rather than getting one each — they
  // already sort together, since the collator compares at base sensitivity.
  const folded = foldForSearch(first)
  return { id: `letter:${folded}`, label: folded.toLocaleUpperCase() }
}

function yearGroup(song: Song): Group {
  if (song.yearNumber === null) return { id: 'year:unknown', label: 'Unknown year' }

  const decade = Math.floor(song.yearNumber / 10) * 10
  return { id: `year:${decade}`, label: `${decade}s` }
}

/**
 * A group per distinct value, labelled with the value as the CSV spells it.
 *
 * Identity is the *filed* form: `The Beatles` and `Beatles` sort as one run, so
 * they are one group, and the label comes from whichever of them the sort put
 * first rather than from a spelling nobody typed.
 */
function valueGroup(raw: string, missing: string): Group {
  const value = raw.trim()
  if (value === '') return { id: 'missing', label: missing }

  return { id: `value:${foldForSearch(normalizeForSort(value))}`, label: value }
}

/**
 * Source is the one key that groups on something other than what it shows.
 *
 * The list sorts on the CSV's raw id — `rb3dlc`, `gh2` — so that is what makes
 * a run contiguous, but a header saying `rb3dlc` would be the internal token
 * the rest of the app works to keep off the screen. Ids are matched
 * case-insensitively for the same reason `resolveSource` does it: one library
 * contains both `rb3dlc` and `RB4`.
 */
function sourceGroup(song: Song): Group {
  const raw = song.source.trim()
  if (raw === '') return { id: 'missing', label: 'Unknown source' }

  return { id: `source:${raw.toLowerCase()}`, label: sourceName(raw) }
}

/**
 * Band difficulty, cut where YARG cuts it and called what YARG calls it.
 *
 * Keyed on the *clamped* tier rather than the raw one, so the handful of charts
 * tiered above six join the run they are already sorted into instead of opening
 * a second `Impossible` header two rows later.
 *
 * Unrated sorts last whichever way the column points — `compareNullableNumbers`
 * puts null at the end in both directions — so this group is always the tail of
 * the list rather than moving with the arrow.
 */
function intensityGroup(song: Song): Group {
  const tier = intensityTier(song.bandDifficulty)
  if (tier === null) return { id: 'diff:unrated', label: 'Unrated' }

  return { id: `diff:${tier}`, label: intensityName(song.bandDifficulty) }
}

/** Four buckets, same source and same rule as the intensities above. */
function lengthGroup(song: Song): Group {
  const bucket = lengthBucket(song.lengthSeconds)
  if (bucket === null) return { id: 'length:unknown', label: 'Unknown length' }

  return { id: `length:${bucket}`, label: LENGTH_BUCKETS[bucket]?.label ?? 'Unknown length' }
}

const GROUPERS: Partial<Record<SortKey, (song: Song) => Group>> = {
  name: (song) => initialGroup(song.name, UNTITLED),
  // Headed by the artist the rows name, which is the one without the cover
  // house's parenthetical on it — and the one the sort put the run in order by.
  artist: (song) => valueGroup(artistCredit(song).name, 'Unknown artist'),
  album: (song) => valueGroup(song.album, 'No album'),
  genre: (song) => valueGroup(song.genre, 'No genre'),
  source: sourceGroup,
  year: yearGroup,
  bandDifficulty: intensityGroup,
  length: lengthGroup,
}

/** How much the row itself is saying — see the artist note at the top. */
export type GroupWidth = 'wide' | 'narrow'

/**
 * The sorted songs, with a header spliced in wherever the group changes.
 *
 * Takes songs already sorted by `key`; grouping an unsorted list would emit a
 * header per row, which is the honest result of asking where the runs are in
 * something that has none.
 */
export function groupSongs(
  songs: readonly Song[],
  key: SortKey,
  width: GroupWidth,
): ListItem[] {
  // The one width-dependent division, kept here rather than in the table above
  // so that the table stays readable as "what a header means for this key".
  const grouper =
    key === 'artist' && width === 'narrow'
      ? (song: Song) => initialGroup(artistCredit(song).name, UNKNOWN_ARTIST)
      : GROUPERS[key]

  if (grouper === undefined) {
    return songs.map((song, position) => ({ kind: 'song', key: song.id, song, position }))
  }

  const items: ListItem[] = []
  let current: string | null = null

  songs.forEach((song, position) => {
    const group = grouper(song)

    if (group.id !== current) {
      current = group.id
      // The position is in the key because a group id is only unique among
      // *consecutive* songs. Two runs of the same id would be a bug in the
      // sort, but a duplicate React key would turn it into a crash.
      items.push({ kind: 'header', key: `header:${group.id}:${position}`, label: group.label })
    }

    items.push({ kind: 'song', key: song.id, song, position })
  })

  return items
}
