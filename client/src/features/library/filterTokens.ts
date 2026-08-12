/**
 * What is narrowing the list, said out loud, one removable thing at a time.
 *
 * The collapsed panel used to leave a single digit behind it — `3` — as the
 * only trace of which three of nine dimensions had taken four thousand songs
 * down to twelve. A count is the right badge for a button and the wrong answer
 * to "why am I looking at this"; it tells you how much you have forgotten
 * without telling you what.
 *
 * So the state comes out of the panel and sits in the bar, as tokens: every
 * selected value, named in the app's own words, each one removable where it
 * stands. That is what makes multi-select affordable. Eight decades and six
 * sources is a reasonable thing to have set and an unreasonable thing to
 * reconstruct by reopening a sheet and reading six chip rows for the lit ones —
 * and undoing exactly one of them shouldn't cost a trip back into the panel at
 * all.
 *
 * **The lens is a token too, and deliberately not the same kind of token.** It
 * removes no songs, so counting it as a filter would be a lie; leaving it out
 * entirely would be a worse one, because "sorted by drums, showing drums tiers"
 * is the single piece of state most likely to explain a list that looks wrong.
 * It rides along wearing a quieter treatment — a lens, not a filter.
 */

import type { InstrumentGroup } from '@shared/types'
import type { DifficultyLens } from '../../lib/difficulty'
import { LENS_LABELS, unratedLabel } from '../../lib/difficulty'
import { LENGTH_BUCKETS, formatVocalParts, intensityName } from '../../lib/format'
import { resolveSource, sourceName } from '../../lib/sources'
import { UNKNOWN } from './filtering'
import type { Filters } from './filtering'

/** Which control a token came from, and what taking it off means. */
export type TokenRemoval =
  | { dimension: 'sources' | 'genres' | 'ratings'; value: string }
  | { dimension: 'decades' | 'vocals' | 'lengths' | 'intensities'; value: number }
  | { dimension: 'instruments'; value: InstrumentGroup }
  | { dimension: 'masterOnly' }
  | { dimension: 'lens' }

export interface FilterToken {
  /** Stable across renders so a removal animates out rather than re-keying the row. */
  id: string
  /**
   * `lens` says what the list is showing; `filter` says what it is hiding. The
   * two are drawn differently for that reason and for no other.
   */
  kind: 'lens' | 'filter'
  /** The control's name, spoken before the value: "source, Rock Band 3 DLC". */
  dimension: string
  label: string
  /**
   * Keeps the label out of the display face's uppercase.
   *
   * For the decades, which are the one value here that a shout mangles:
   * `1980S` reads as a typo, and the category headers already refuse the same
   * transform for the same reason — see the note on `CategoryHeader`.
   */
  preserveCase?: boolean
  /** Source tokens carry the same badge the rows lead with. */
  iconUrl?: string | null
}

interface Described extends FilterToken {
  removal: TokenRemoval
}

const INSTRUMENT_LABELS: Record<InstrumentGroup, string> = {
  guitar: 'Guitar',
  bass: 'Bass',
  drums: 'Drums',
  keys: 'Keys',
  vocals: 'Vocals',
}

function decadeLabel(decade: number): string {
  return decade === UNKNOWN ? 'No year' : `${decade}s`
}

function lengthLabel(bucket: number): string {
  return LENGTH_BUCKETS[bucket]?.label ?? 'Unknown length'
}

/**
 * Every active value, in the order the panel presents them.
 *
 * Panel order rather than most-recently-added, so the row is a stable map of
 * the same sections rather than a history of taps. Somebody who has learned
 * that parts come before difficulty can find a token the same way twice.
 */
export function describeFilters(filters: Filters, lens: DifficultyLens): Described[] {
  const tokens: Described[] = []

  for (const group of filters.instruments) {
    tokens.push({
      id: `instruments:${group}`,
      kind: 'filter',
      dimension: 'part',
      /*
       * `Has drums`, not `Drums`.
       *
       * The lens token beside it reads `Drums difficulty`, and two tokens both
       * beginning with the same instrument said nothing about which one was
       * hiding songs and which one was choosing a scale. The verb is the whole
       * distinction, and it is the panel's own word for this row.
       */
      label: `Has ${INSTRUMENT_LABELS[group].toLowerCase()}`,
      removal: { dimension: 'instruments', value: group },
    })
  }

  if (filters.masterOnly) {
    tokens.push({
      id: 'masterOnly',
      kind: 'filter',
      dimension: 'recording',
      label: 'Originals only',
      removal: { dimension: 'masterOnly' },
    })
  }

  // Ahead of the tiers it qualifies, because it is the sentence's subject:
  // "drums difficulty — Solid, Moderate" reads in the order it is written.
  if (lens !== 'band') {
    tokens.push({
      id: 'lens',
      kind: 'lens',
      dimension: 'difficulty shown for',
      label: `${LENS_LABELS[lens]} difficulty`,
      removal: { dimension: 'lens' },
    })
  }

  for (const tier of filters.intensities) {
    tokens.push({
      id: `intensities:${tier}`,
      kind: 'filter',
      dimension: 'difficulty',
      label: tier === UNKNOWN ? unratedLabel(lens) : intensityName(tier),
      removal: { dimension: 'intensities', value: tier },
    })
  }

  for (const count of filters.vocals) {
    tokens.push({
      id: `vocals:${count}`,
      kind: 'filter',
      dimension: 'vocals',
      label: formatVocalParts(count),
      removal: { dimension: 'vocals', value: count },
    })
  }

  for (const bucket of filters.lengths) {
    tokens.push({
      id: `lengths:${bucket}`,
      kind: 'filter',
      dimension: 'length',
      label: lengthLabel(bucket),
      removal: { dimension: 'lengths', value: bucket },
    })
  }

  for (const decade of filters.decades) {
    tokens.push({
      id: `decades:${decade}`,
      kind: 'filter',
      dimension: 'decade',
      label: decadeLabel(decade),
      preserveCase: decade !== UNKNOWN,
      removal: { dimension: 'decades', value: decade },
    })
  }

  for (const rating of filters.ratings) {
    tokens.push({
      id: `ratings:${rating}`,
      kind: 'filter',
      dimension: 'age rating',
      /*
       * The game's own spelling, uppercased by the label face like every other
       * token. `Family Friendly` is two words and stays two words — there is no
       * shorter form of these that is still the thing YARG's setting screen and
       * this app's own detail sheet call it.
       */
      label: rating,
      removal: { dimension: 'ratings', value: rating },
    })
  }

  for (const source of filters.sources) {
    tokens.push({
      id: `sources:${source}`,
      kind: 'filter',
      dimension: 'source',
      label: sourceName(source),
      iconUrl: resolveSource(source).iconUrl,
      removal: { dimension: 'sources', value: source },
    })
  }

  for (const genre of filters.genres) {
    tokens.push({
      id: `genres:${genre}`,
      kind: 'filter',
      dimension: 'genre',
      label: genre,
      removal: { dimension: 'genres', value: genre },
    })
  }

  return tokens
}

/**
 * The same filters with one value taken back off.
 *
 * `lens` is not one of them and returns the filters untouched — the caller owns
 * that piece of state and resets it separately. Returning unchanged rather than
 * throwing keeps the removal handler a single expression at the call site.
 */
export function withoutToken(filters: Filters, removal: TokenRemoval): Filters {
  switch (removal.dimension) {
    case 'masterOnly':
      return { ...filters, masterOnly: false }
    case 'lens':
      return filters
    case 'sources':
    case 'genres':
    case 'ratings':
      return {
        ...filters,
        [removal.dimension]: filters[removal.dimension].filter((v) => v !== removal.value),
      }
    case 'instruments':
      return { ...filters, instruments: filters.instruments.filter((v) => v !== removal.value) }
    default:
      return {
        ...filters,
        [removal.dimension]: filters[removal.dimension].filter((v) => v !== removal.value),
      }
  }
}
