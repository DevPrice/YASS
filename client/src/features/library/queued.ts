/**
 * Which library rows are in the setlist, and which of them a swipe may add.
 *
 * Guests used to open a song just to learn it was already queued, and a
 * library with nothing marked is a library that answers that question one sheet
 * at a time. The setlist holds a handful of songs, so marking those rows costs
 * a handful of glyphs rather than four thousand.
 *
 * Both answers are derived from `model.ts` rather than restated here, because
 * each has a rule that is easy to get subtly wrong and is already tested there:
 * a stale setlist must not claim positions (`isLive`), and whether a song can be
 * added right now is the action bar's call (`actionBar`), not this file's.
 */

import type { SetlistState } from '@shared/types'
import {
  actionBar,
  isLive,
  ordinal,
  setlistMode,
  standingAt,
  type Standing,
} from '../setlist/model'

/**
 * A row's mark: where the song sits, numbered the way the setlist panel numbers
 * its own rows.
 *
 * The number is the position in the list in every mode, including mid-show.
 * "Up in 4 songs" would be the more useful sentence during a show, but a bare
 * `4` in a row cannot say which of the two it means, and the panel beside it
 * prints the position. One number with one meaning, and the accessible name
 * carries the sentence.
 */
export interface QueuedMark {
  position: number
  standing: Standing
}

const NONE: ReadonlyMap<string, QueuedMark> = new Map()

/**
 * Hash to mark, for a live setlist; empty for any other.
 *
 * Empty while the setlist is out of view or unavailable, on the Stale-Not-Gone
 * rule: what was last seen may already have been wiped, and the panel is where
 * a stale list is shown, labelled as one. A row is no place for that caveat.
 *
 * The first entry wins when a chart is queued twice, as `actionBar` reads it.
 */
export function queuedMarks(state: SetlistState): ReadonlyMap<string, QueuedMark> {
  if (!isLive(setlistMode(state)) || state.entries.length === 0) return NONE

  const marks = new Map<string, QueuedMark>()
  state.entries.forEach((entry, index) => {
    if (!marks.has(entry.hash)) {
      marks.set(entry.hash, { position: index + 1, standing: standingAt(state, index) })
    }
  })
  return marks
}

/** The mark's accessible name: `7th in the setlist`, `up next in the setlist`. */
export function markLabel(mark: QueuedMark): string {
  switch (mark.standing.kind) {
    case 'queued':
      return `${ordinal(mark.position)} in the setlist`
    case 'upNow':
      return 'Up now in the setlist'
    case 'upNext':
      return 'Up next in the setlist'
    case 'later':
      return `In the setlist, up in ${mark.standing.songs} songs`
    case 'played':
      return 'Played in this show'
  }
}

/**
 * Whether a swipe on the row with this hash would add it, right now.
 *
 * Exactly the action bar's `add` state with nothing tried yet — so a song that
 * is already queued, a setlist out of view, guest edits switched off or a full
 * setlist all refuse the swipe on the same terms the button would. A refusal
 * only YARG can give (`incompatible`, `songNotFound`) is still learned after the
 * swipe, as it is after the tap.
 *
 * Returns a function rather than taking the hash, so one setlist's answers are
 * worked out once per song however many scroll frames ask again.
 */
export function addGate(
  state: SetlistState,
  mine: ReadonlySet<number>,
): (hash: string | null) => boolean {
  const answers = new Map<string | null, boolean>()

  return (hash) => {
    let answer = answers.get(hash)
    if (answer === undefined) {
      // `playing` only changes how a song already in the setlist is worded,
      // and such a song never answers `add`.
      answer =
        actionBar({ state, hash, mine, pending: null, last: null, playing: false }).kind === 'add'
      answers.set(hash, answer)
    }
    return answer
  }
}
