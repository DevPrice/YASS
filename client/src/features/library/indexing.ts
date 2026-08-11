/**
 * The jump index: where the rail can put you, in the order the list is in.
 *
 * A library of four thousand songs has one way through it — the flick — and a
 * flick answers "further down" rather than "at the M's". The category headers
 * in `grouping.ts` already name every division the sort implies; this turns the
 * same divisions into targets, and `IndexRail` draws them down the right edge.
 *
 * **A mark is a header, or a coarsening of several.** Never anything finer.
 * That rule is the whole design. Sorting by artist puts twelve hundred headers
 * in the list and no rail can hold twelve hundred marks, so the rail collapses
 * them to the letter each artist files under — and because a letter's run
 * begins at some artist, and that artist has a header, the jump still lands on
 * a division the list actually draws. A rail with marks *finer* than the
 * headers would name a place and then arrive somewhere unlabelled.
 *
 * **Marks are found by walking the rendered items, never by bucketing them.**
 * Same reason `groupSongs` does it: the items arrive in the order they are
 * drawn, so a mark goes in wherever consecutive songs stop agreeing, and a
 * descending sort produces a descending rail with no second rule to keep in
 * step with the first.
 *
 * Each mark carries two forms of itself, because the rail is 38px wide and most
 * of these names are not. `glyph` is what fits in a slot — a letter, `80s`, a
 * tier numeral, a source's icon. `label` is the whole thing, said by the
 * callout under the finger and by the button's accessible name. The pair is the
 * point: the glyph gets you there, the label teaches you what it meant.
 */

import type { Song } from '@shared/types'
import type { DifficultyLens } from '../../lib/difficulty'
import { LENS_LABELS, lensTier, unratedLabel } from '../../lib/difficulty'
import {
  LENGTH_BUCKETS,
  artistCredit,
  intensityName,
  intensityTier,
  lengthBucket,
} from '../../lib/format'
import { resolveSource } from '../../lib/sources'
import { NUMBER, SYMBOL, initialGroup } from './grouping'
import type { Group, ListItem } from './grouping'
import type { SortKey } from './filtering'

/**
 * What a slot draws.
 *
 * `numeric` picks the family, following the rule the rest of the app follows:
 * Red Hat Display shouts, Inter is numbers. A rail of decades or tiers set in
 * the uppercase display face read as lettering that happened to be digits;
 * tabular Inter reads as a scale, which is what it is.
 */
export type MarkGlyph =
  | { kind: 'text'; text: string; numeric: boolean }
  | { kind: 'icon'; src: string }

interface Mark {
  /** Canonical. Compared against the previous song's to find where a run starts. */
  id: string
  glyph: MarkGlyph
  /** The whole name, for the callout and the accessible name. */
  label: string
}

export interface IndexMark extends Mark {
  key: string
  /** Where in the rendered items this jump lands. */
  index: number
}

function display(text: string): MarkGlyph {
  return { kind: 'text', text, numeric: false }
}

function numeral(text: string): MarkGlyph {
  return { kind: 'text', text, numeric: true }
}

/** The slot for a value the CSV never carried. Every key spells it the same. */
const MISSING_GLYPH = display('—')

/** Passed to `initialGroup` purely so its "nothing to file under" case is detectable. */
const MISSING: Group = { id: 'index:missing', label: '—' }

/**
 * One mark per leading letter — the coarsening four of the eight keys use.
 *
 * Through `initialGroup`, so the rail agrees with the headers about where a
 * letter begins: `The Beatles` is filed under `Beatles` in both, and `É` and
 * `E` share a mark because the collator already sorts them together.
 *
 * The two non-letter classes get their glyph and their name from different
 * places on purpose. `#` and `0–9` are exactly right in a slot and are not
 * words — a screen reader announcing "number sign" as a destination is a worse
 * answer than "Symbols", and the callout under a finger has room for the word.
 */
function letterMark(raw: string, missing: string): Mark {
  const group = initialGroup(raw, MISSING)

  if (group.id === MISSING.id) return { id: group.id, glyph: MISSING_GLYPH, label: missing }
  if (group.id === SYMBOL.id) return { id: group.id, glyph: display(SYMBOL.label), label: 'Symbols' }
  if (group.id === NUMBER.id) return { id: group.id, glyph: numeral(NUMBER.label), label: 'Numbers' }

  return { id: group.id, glyph: display(group.label), label: group.label }
}

/**
 * `80s`, not `1980s`.
 *
 * Two digits is what the rail can spare, and it is how the decade is said out
 * loud anyway. It is also, strictly, ambiguous — a chart dated 1905 would mark
 * `00s` beside the 2000s. A rail is read as a sequence rather than a set of
 * independent labels, so a decade between `70s` and `90s` is not in doubt, and
 * the callout and the accessible name both give the century back.
 */
function yearMark(song: Song): Mark {
  if (song.yearNumber === null) {
    return { id: 'year:unknown', glyph: MISSING_GLYPH, label: 'Unknown year' }
  }

  const decade = Math.floor(song.yearNumber / 10) * 10
  return {
    id: `year:${decade}`,
    glyph: numeral(`${String(decade).slice(-2)}s`),
    label: `${decade}s`,
  }
}

/**
 * The one key whose marks are pictures.
 *
 * Source is not coarsened to a letter like the other long-labelled keys,
 * because it cannot be: the list sorts on the CSV's raw id (`rb3dlc`, `gh2`)
 * while the name a reader knows comes from the registry, and initials taken off
 * the names would not run in the order the rows do. A rail whose letters are
 * out of sequence is worse than no rail.
 *
 * So it keeps one mark per source and draws the badge instead — the same icon
 * the phone row already leads with, for the same reason it leads with it: this
 * is the one field on a song that is a picture rather than a word. Thirty icons
 * fit down an edge that thirty names could not fit at any size.
 *
 * Sources the registry has no art for fall back to their initial, which is a
 * worse mark and still a mark. `resolveSource` guarantees a name either way.
 */
function sourceMark(song: Song): Mark {
  const raw = song.source.trim()
  if (raw === '') return { id: 'source:missing', glyph: MISSING_GLYPH, label: 'Unknown source' }

  const resolved = resolveSource(raw)
  const initial = [...resolved.name][0]?.toLocaleUpperCase()

  return {
    id: `source:${raw.toLowerCase()}`,
    glyph:
      resolved.iconUrl !== null
        ? { kind: 'icon', src: resolved.iconUrl }
        : display(initial ?? '—'),
    label: resolved.name,
  }
}

/**
 * The tier in the slot, YARG's name for it in the callout.
 *
 * This is the pair working hardest. `Nightmare` is eleven characters and will
 * never fit a rail; `5` fits and is also what the ring on every row is
 * counting, so the mark matches what the reader is already scanning. Scrubbing
 * past it says the word, which is how anyone learns that the two are the same
 * fact.
 */
function intensityMark(song: Song, lens: DifficultyLens): Mark {
  const raw = lensTier(song, lens)
  const tier = intensityTier(raw)
  if (tier === null) return { id: 'diff:unrated', glyph: MISSING_GLYPH, label: unratedLabel(lens) }

  return { id: `diff:${tier}`, glyph: numeral(String(tier)), label: intensityName(raw) }
}

function lengthMark(song: Song): Mark {
  const bucket = lengthBucket(song.lengthSeconds)
  const found = bucket === null ? undefined : LENGTH_BUCKETS[bucket]
  if (found === undefined) {
    return { id: 'length:unknown', glyph: MISSING_GLYPH, label: 'Unknown length' }
  }

  return { id: `length:${bucket}`, glyph: numeral(found.short), label: found.label }
}

/**
 * How each ordering divides, at rail resolution.
 *
 * Four keys coarsen to a leading letter, which is the same answer the title
 * sort's own headers give. The other four are already few enough to show whole.
 *
 * `charter` is absent, as it is from `GROUPERS` and from every sort control the
 * app draws — it is a username rather than a category. Nothing indexes it, so
 * the rail does not appear, and the list takes the width back.
 */
const MARKERS: Partial<Record<SortKey, (song: Song, lens: DifficultyLens) => Mark>> = {
  name: (song) => letterMark(song.name, 'Untitled'),
  // The credited artist, not the raw field — the name the rows show, the name
  // the sort ordered by, and so the letter the run actually begins under.
  artist: (song) => letterMark(artistCredit(song).name, 'Unknown artist'),
  album: (song) => letterMark(song.album, 'No album'),
  // Safe to take initials from, unlike source: the genre sort compares the same
  // string the label comes from, so the letters run in the rows' own order.
  genre: (song) => letterMark(song.genre, 'No genre'),
  source: sourceMark,
  year: yearMark,
  difficulty: intensityMark,
  length: lengthMark,
}

/** What the rail is dividing, for its accessible name. */
const INDEX_LABELS: Partial<Record<SortKey, string>> = {
  name: 'title',
  artist: 'artist',
  album: 'album',
  genre: 'genre',
  source: 'source',
  year: 'year',
  difficulty: 'difficulty',
  length: 'length',
}

/**
 * The ordering in the app's own words, which for one key depends on the lens.
 *
 * "Jump through the list by difficulty" is true and unhelpful once the rail's
 * numerals are drum tiers — the whole reason the lens exists is that those are
 * different scales, and the one control that reads the scale out loud should
 * say which one it is reading.
 */
export function indexLabel(key: SortKey, lens: DifficultyLens): string {
  const base = INDEX_LABELS[key] ?? 'section'
  return key === 'difficulty' && lens !== 'band'
    ? `${LENS_LABELS[lens].toLowerCase()} ${base}`
    : base
}

/**
 * The marks for a rendered list, in the order it renders them.
 *
 * Takes the items `groupSongs` produced rather than the songs, for one reason
 * worth being explicit about: a mark has to point at the *header* that opens
 * its run, not at the first song under it. Landing on the song would put the
 * header one row off the top of the screen, so a jump to `M` would arrive
 * somewhere that no longer says `M` — the rail would be the only thing claiming
 * you had got there.
 *
 * Width is not a parameter. It changes which headers exist (see `groupSongs`),
 * and therefore which item index a mark points at, but never how the rail
 * divides: artist coarsens to a letter at both widths, and the walk finds
 * whatever headers are actually there.
 */
export function buildIndex(
  items: readonly ListItem[],
  key: SortKey,
  lens: DifficultyLens,
): IndexMark[] {
  const marker = MARKERS[key]
  if (marker === undefined) return []

  const marks: IndexMark[] = []
  let current: string | null = null

  items.forEach((item, index) => {
    if (item.kind !== 'song') return

    const mark = marker(item.song, lens)
    if (mark.id === current) return
    current = mark.id

    marks.push({
      ...mark,
      // The position is in the key for the same reason a header's is: an id is
      // only unique among *consecutive* songs, and a duplicate React key turns
      // a bug in the sort into a crash.
      key: `${mark.id}:${index}`,
      index: items[index - 1]?.kind === 'header' ? index - 1 : index,
    })
  })

  return marks
}
