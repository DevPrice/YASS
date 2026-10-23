/**
 * Swipe right to add: the gesture's arithmetic, and the hand-off of a refusal
 * to the song's detail.
 *
 * Adding from the library used to cost four actions a song — open the row, tap
 * add, swipe the sheet away, find your place — and a guest building a list does
 * that a dozen times. Music and karaoke apps settled on a swipe for it. It is
 * invisible chrome, so a row still shows exactly one thing you can do to it; the
 * button in the detail stays the path that is seen, spoken and clicked.
 *
 * **The list scrolls under the same thumb, and scrolling always wins.** Rows set
 * `touch-action: pan-y`, so the browser keeps every vertical drag and cancels
 * the pointer the moment it starts one; this only ever sees what the browser
 * declined. Even then nothing moves until the finger is clearly travelling
 * right — `SLOP` pixels, and steeper than `STEEPNESS` — so the slight sideways
 * drift of an ordinary flick never slides a row.
 */

import type { LastTry } from '../setlist/model'

/** How far a finger travels before the gesture is read as one axis or the other. */
export const SLOP = 10

/** How much more horizontal than vertical a drag must be to slide the row. */
export const STEEPNESS = 1.5

/**
 * How far the row must travel to add when let go.
 *
 * About a quarter of a phone row, and the row follows the finger one-to-one up
 * to here, so arming is something you watch happen rather than guess at.
 */
export const COMMIT_AT = 96

/** How far a row that can't be added gives under the finger before stopping. */
export const RESIST_MAX = 20

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical'

/**
 * What a drag of `dx`, `dy` from where it started is.
 *
 * Leftward counts as `vertical` — not ours to handle — rather than as a second
 * gesture: a swipe left has no meaning on a row, and claiming it would only
 * fight the browser's own back gesture.
 */
export function swipeAxis(dx: number, dy: number): SwipeAxis {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return 'undecided'
  return dx > 0 && dx > Math.abs(dy) * STEEPNESS ? 'horizontal' : 'vertical'
}

/**
 * Where the row sits for a drag of `dx`.
 *
 * One-to-one up to the commit point, then damped, so it is plain when going
 * further does nothing more. A row that can't be added gives a little and then
 * stops: enough to say the gesture was felt, not enough to look like it worked.
 */
export function swipeOffset(dx: number, canAdd: boolean): number {
  if (dx <= 0) return 0
  if (!canAdd) return Math.min(dx * 0.2, RESIST_MAX)
  return dx <= COMMIT_AT ? dx : COMMIT_AT + (dx - COMMIT_AT) * 0.35
}

/** Whether letting go at `dx` adds the song. */
export function swipeCommits(dx: number, canAdd: boolean): boolean {
  return canAdd && dx >= COMMIT_AT
}

// --- A refusal, carried into the detail ------------------------------------

/**
 * How long a refusal waits for the detail to open and read it.
 *
 * The detail opens on the same tick the answer arrives; anything older than
 * this was never collected and would only be a surprise the next time somebody
 * opened that song on purpose.
 */
const HAND_OFF_MS = 10_000

const handed = new Map<string, LastTry>()

/**
 * Leave a swipe's refusal for the song's action bar.
 *
 * A swipe has no caption, so a refused one opens the song and lets the action
 * bar say why. But the bar is keyed by song and starts with no answer, and the
 * refusals only YARG can give — `incompatible` mid-show, `songNotFound` — are
 * exactly the ones it cannot work out before a tap. Without the answer it would
 * offer `add to setlist` for a song that was just refused.
 */
export function handOffRefusal(hash: string, last: LastTry): void {
  handed.set(hash, last)
}

/** The refusal left for this song, once, if it is still fresh. */
export function takeRefusal(hash: string | null, now = Date.now()): LastTry | null {
  if (hash === null) return null

  const last = handed.get(hash)
  handed.delete(hash)
  return last !== undefined && now - last.at < HAND_OFF_MS ? last : null
}
