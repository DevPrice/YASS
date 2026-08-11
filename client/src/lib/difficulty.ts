/**
 * Whose difficulty the app is talking about.
 *
 * A song carries twenty per-instrument tiers and one band tier, and until now
 * every surface quoted the band one — the ring on the row, the `diff` column,
 * the difficulty sort, the intensity headers, the jump rail. That is the right
 * default and the wrong ceiling: a drummer scrolling a library sorted by band
 * difficulty is reading a number that averages in four parts they are not
 * playing. `Nightmare` on a chart whose drums are a 2 is not a lie, it is an
 * answer to somebody else's question.
 *
 * The lens is that question, made switchable. Pick `drums` and the same five
 * things all switch together — filter, sort, ring, column, rail — because a
 * list sorted by one number and drawn with another is worse than either.
 *
 * `band` is not an instrument and is deliberately in the same enum anyway. It
 * is the sixth thing this control can be pointed at, YARG draws a mark for it in
 * the same style as the other five, and every consumer wants one value rather
 * than a value and a special case.
 */

import type { InstrumentGroup, InstrumentKey, Song } from '@shared/types'
import { INSTRUMENTS, INSTRUMENT_GROUPS } from '@shared/types'

export type DifficultyLens = 'band' | InstrumentGroup

/** Band first, then the five families in the order every other control uses. */
export const DIFFICULTY_LENSES: readonly DifficultyLens[] = ['band', ...INSTRUMENT_GROUPS]

export const LENS_LABELS: Record<DifficultyLens, string> = {
  band: 'Band',
  guitar: 'Guitar',
  bass: 'Bass',
  drums: 'Drums',
  keys: 'Keys',
  vocals: 'Vocals',
}

export function isDifficultyLens(value: string): value is DifficultyLens {
  return (DIFFICULTY_LENSES as readonly string[]).includes(value)
}

/**
 * The instrument a player is actually handed for each family.
 *
 * A group's difficulty is not one number — `guitar` spans 5-fret, 6-fret and
 * two Pro Guitar charts, and Pro Guitar routinely tiers three above the
 * standard one. Reporting the hardest would tell a guitarist a song is a 6 when
 * the chart they'll play is a 3; reporting the easiest would do the reverse. So
 * each family reports its standard chart, which is the one that gets picked
 * unless somebody has brought a special controller.
 *
 * This lived in `ui/library.tsx` as the parts grid's private rule. It is the
 * app's definition of "how hard is the guitar", and now that the filter, the
 * sort and the rail all ask that question too, it has to be one definition —
 * a second copy that disagreed would sort the list by a number the ring beside
 * it never shows.
 */
const PRIMARY_KEY: Record<InstrumentGroup, InstrumentKey> = {
  guitar: 'guitar5',
  bass: 'bass5',
  drums: 'drums4',
  keys: 'keys',
  vocals: 'vocals',
}

/** The standard chart's tier, or the first alternate charted, or null. */
function resolveGroupTier(song: Song, group: InstrumentGroup): number | null {
  const primary = song.difficulties[PRIMARY_KEY[group]]
  if (primary !== null) return primary

  // Pro-only charts exist. A song with Pro Drums and no 4-lane still has drums,
  // and saying "no drums" because the standard chart is missing would be worse
  // than quoting the chart that does exist.
  for (const instrument of INSTRUMENTS) {
    if (instrument.group !== group) continue

    const tier = song.difficulties[instrument.key]
    if (tier !== null) return tier
  }

  return null
}

/**
 * Resolved tiers, cached per song.
 *
 * Same reasoning as `searchTextCache` and `sortTextCache` in `filtering.ts`:
 * sorting by difficulty runs this O(n log n) times across four thousand songs,
 * and the miss path walks all twenty instrument keys looking for an alternate
 * chart — which is exactly the path an uncharted family takes, so the slowest
 * case is also the common one under a `keys` lens.
 *
 * `undefined` is the miss and `null` is a real answer, so the two are tested
 * apart rather than with `??`.
 */
const tierCache = new WeakMap<Song, Partial<Record<InstrumentGroup, number | null>>>()

export function groupTier(song: Song, group: InstrumentGroup): number | null {
  let cached = tierCache.get(song)
  if (cached === undefined) {
    cached = {}
    tierCache.set(song, cached)
  }

  const hit = cached[group]
  if (hit !== undefined) return hit

  const tier = resolveGroupTier(song, group)
  cached[group] = tier
  return tier
}

/** The tier the current lens is asking about. Null means the ring has nothing to report. */
export function lensTier(song: Song, lens: DifficultyLens): number | null {
  return lens === 'band' ? song.bandDifficulty : groupTier(song, lens)
}

/**
 * What a null tier means, which depends on what was asked.
 *
 * Under `band` it is a chart nobody assigned a band difficulty to. Under an
 * instrument it is a part that does not exist. Those are different facts and
 * the chip that selects them should say which one it is selecting — `Unrated`
 * on a drums lens would offer to find songs whose drums are unrated, when what
 * it actually finds is songs with no drums at all.
 */
export function unratedLabel(lens: DifficultyLens): string {
  return lens === 'band' ? 'Unrated' : 'Not charted'
}
