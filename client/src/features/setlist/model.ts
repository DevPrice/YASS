/**
 * What the setlist UI says, worked out apart from how it is drawn.
 *
 * Every surface — the banner chip, the panel, the song detail's badge and its
 * action bar — reads the same few derivations, and each of them has cases that
 * are easy to get subtly wrong: a stale setlist that must not claim positions,
 * an "up now" that must not claim to be playing, a "cleared" that must not be
 * said while the setlist is merely out of view. Pure functions over
 * `SetlistState`, so those rules are tested once rather than re-derived in four
 * components. The rules behind them are `DESIGN.md`'s Stale-Not-Gone, Say-When
 * and Up-Now rules.
 */

import type { SetlistEntry, SetlistRefusal, SetlistState } from '@shared/types'

/**
 * The one state every surface switches on.
 *
 * - `absent`: YASS has never seen a setlist and isn't connected. Nothing at all
 *   is drawn — a guest never sees a word about configuration.
 * - `live` / `show`: YARG is sharing it, outside or inside a show.
 * - `outOfView`: YARG is running but not sharing it right now — the host left
 *   the music library. What was last seen stays up, muted.
 * - `unavailable`: YASS lost YARG after having seen a setlist.
 */
export type SetlistMode = 'absent' | 'live' | 'show' | 'outOfView' | 'unavailable'

export function setlistMode(state: SetlistState): SetlistMode {
  if (state.link === 'connected') {
    if (!state.active) return 'outOfView'
    return state.showInProgress ? 'show' : 'live'
  }
  return state.seenAt === null ? 'absent' : 'unavailable'
}

export function isLive(mode: SetlistMode): mode is 'live' | 'show' {
  return mode === 'live' || mode === 'show'
}

// --- Words and numbers -------------------------------------------------------

const ORDINAL = new Intl.PluralRules('en', { type: 'ordinal' })
const SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' }

/** `7th`. The app is English throughout, and so are its ordinals. */
export function ordinal(n: number): string {
  return `${n.toLocaleString()}${SUFFIX[ORDINAL.select(n)] ?? 'th'}`
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `51 min`, `14 h 52 min`. */
export function formatRunTime(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * How long `entries` from `from` onwards run, or null when that can't be said
 * honestly — one song of unknown length, or a tail cut off the wire, and any
 * total would be a guess presented as a sum.
 */
export function runTime(state: SetlistState, from = 0): number | null {
  if (state.entries.length < state.totalCount) return null

  let total = 0
  for (const entry of state.entries.slice(from)) {
    if (entry.lengthSeconds === null) return null
    total += entry.lengthSeconds
  }
  return total
}

// --- Where a song stands ----------------------------------------------------

export type Standing =
  | { kind: 'queued'; position: number }
  | { kind: 'upNow' }
  | { kind: 'upNext' }
  | { kind: 'later'; songs: number }
  | { kind: 'played'; position: number }

/** How an entry at `index` stands against the show, or against nothing outside one. */
export function standingAt(state: SetlistState, index: number): Standing {
  const current = state.showInProgress ? state.currentIndex : null
  if (current === null) return { kind: 'queued', position: index + 1 }
  if (index < current) return { kind: 'played', position: index + 1 }
  if (index === current) return { kind: 'upNow' }
  if (index === current + 1) return { kind: 'upNext' }
  return { kind: 'later', songs: index - current }
}

/**
 * Where a song is in a live setlist, or null.
 *
 * Null for a stale one too, on purpose: "7th in the setlist" from a list that
 * may already have been wiped is worse than saying nothing. The panel is where
 * stale data is shown, labelled as stale.
 */
export function standingOf(state: SetlistState, hash: string | null): Standing | null {
  if (hash === null || !isLive(setlistMode(state))) return null
  const index = state.entries.findIndex((entry) => entry.hash === hash)
  return index === -1 ? null : standingAt(state, index)
}

/** The badge's words: `7`, `up now`, `up next`, `in 4 songs`, `played`. */
export function standingWhere(standing: Standing): string {
  switch (standing.kind) {
    case 'queued':
      return ordinal(standing.position)
    case 'upNow':
      return 'up now'
    case 'upNext':
      return 'up next'
    case 'later':
      return `up in ${standing.songs} songs`
    case 'played':
      return `${ordinal(standing.position)} in this show`
  }
}

// --- Cleared ----------------------------------------------------------------

/**
 * Whether a new setlist means the old one was wiped.
 *
 * Only the moment the source *shows* it empty: YARG was not sharing a setlist
 * that had songs, and now shares one that has none. Inactive alone never says
 * cleared — backing out of Difficulty Select brings the same songs back.
 */
export function wasCleared(previous: SetlistState, next: SetlistState): boolean {
  return (
    !isLive(setlistMode(previous)) &&
    previous.totalCount > 0 &&
    isLive(setlistMode(next)) &&
    next.totalCount === 0
  )
}

/**
 * This browser's songs a wipe took before they were played, in setlist order.
 *
 * The stale list a phone holds while YARG isn't sharing is exactly the one
 * that was wiped, so it is the record of what was lost.
 */
export function lostToClearing(
  previous: SetlistState,
  mine: ReadonlySet<number>,
): SetlistEntry[] {
  const current = previous.showInProgress ? previous.currentIndex : null
  return previous.entries.filter(
    (entry, index) =>
      entry.id !== null && mine.has(entry.id) && (current === null || index > current),
  )
}

// --- Moving your own ---------------------------------------------------------

export type MovePlan = { position: 'start' } | { position: 'after'; anchorId: number } | null

/**
 * The first gap a song may be dropped into. Gaps are numbered by the entry they
 * sit before, so gap 0 is the start and gap `entries.length` the end. During a
 * show it is the gap after the song the show is on: nothing may land at or
 * before the current song, though right after it — next — is allowed.
 */
export function firstOpenGap(state: SetlistState): number {
  const current = state.showInProgress ? state.currentIndex : null
  return current === null ? 0 : current + 1
}

/**
 * Moving the entry at `from` into `gap`, as YARG takes a move: to the start, or
 * after the entry above the gap. Null when that is no move at all — the gaps
 * either side of the entry itself — or a gap it may not go to.
 */
export function dropPlacement(state: SetlistState, from: number, gap: number): MovePlan {
  if (gap < firstOpenGap(state) || gap > state.entries.length) return null
  if (gap === from || gap === from + 1) return null
  if (gap === 0) return { position: 'start' }

  const anchor = state.entries[gap - 1]
  return anchor?.id == null ? null : { position: 'after', anchorId: anchor.id }
}

/** Where an entry dropped from `from` into `gap` ends up. */
export function droppedIndex(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap
}

/** One step earlier: the keyboard's half of the drag. */
export function earlier(state: SetlistState, index: number): MovePlan {
  return dropPlacement(state, index, index - 1)
}

/** One step later. */
export function later(state: SetlistState, index: number): MovePlan {
  return dropPlacement(state, index, index + 2)
}

// --- The action bar ---------------------------------------------------------

/** YARG's cap on remote adds. */
export const SETLIST_LIMIT = 500

/**
 * What this browser last tried for one song, and what came of it.
 *
 * `currentIndex` and `at` are the setlist as it stood when the answer came, so
 * an answer that was only true of that moment can expire with it.
 */
export interface LastTry {
  reason: 'ok' | SetlistRefusal | 'offline'
  entryId: number | null
  currentIndex: number | null
  at: number
}

/** How long "hold on a moment" holds, if the show doesn't move first. */
export const LOCKED_HOLD_MS = 5_000

const WHEN =
  'You can add songs while the host is picking songs in YARG, or during a show.'

export type ActionBar =
  | { kind: 'hidden' }
  /** 1: can add. `lead` carries "Not added." after a dropped connection that didn't go in. */
  | { kind: 'add'; lead: string | null; caption: string }
  /** 2 */
  | { kind: 'adding' }
  /** 3: just added, with undo. `where` is a whole sentence: `13th in the setlist.` */
  | { kind: 'added'; entryId: number; where: string }
  /** 4: yours, with remove. `where` follows the lead: `· 7th`. */
  | { kind: 'yours'; entryId: number; where: string }
  /** 5, 6 and 7: in the setlist and not yours to change. `where` follows the lead. */
  | { kind: 'status'; lead: string; where: string | null }
  /** 8–15: drawn, can't act, and says when it will. */
  | { kind: 'disabled'; lead: string | null; caption: string }
  /** 16: YASS lost YARG mid-add; the next setlist will say. */
  | { kind: 'checking' }
  /** 17: the phone lost YASS. The button stays live: pressing it again is the retry. */
  | { kind: 'retry'; caption: string }

export interface ActionBarInput {
  state: SetlistState
  hash: string | null
  mine: ReadonlySet<number>
  pending: boolean
  last: LastTry | null
  now: number
}

/** Which of the action bar's states applies, with its copy. */
export function actionBar({ state, hash, mine, pending, last, now }: ActionBarInput): ActionBar {
  const mode = setlistMode(state)
  if (mode === 'absent' || state.guestEdits === 'unsupported' || hash === null) {
    return { kind: 'hidden' }
  }

  if (pending) return { kind: 'adding' }

  // Answers that outlive the moment they came back in, checked first.
  if (last?.reason === 'songNotFound') {
    return {
      kind: 'disabled',
      lead: 'Not added.',
      caption: "YARG couldn't find this song. The host's game may be hiding it, for example by age rating.",
    }
  }
  if (last?.reason === 'offline') {
    return {
      kind: 'retry',
      caption: "Couldn't reach the server. Check you're on the Wi-Fi, then try again.",
    }
  }

  if (mode === 'unavailable') {
    return { kind: 'disabled', lead: null, caption: "The setlist isn't available right now." }
  }
  if (mode === 'outOfView') {
    return last?.reason === 'inactive'
      ? { kind: 'disabled', lead: 'Not added.', caption: `YARG stopped taking songs just then. ${WHEN}` }
      : { kind: 'disabled', lead: null, caption: WHEN }
  }

  const index = state.entries.findIndex((entry) => entry.hash === hash)

  if (last?.reason === 'connectionLost') {
    // Settled by the first setlist to arrive after the answer did.
    if (state.updatedAt <= last.at) return { kind: 'checking' }
    if (index === -1) {
      return {
        kind: 'add',
        lead: 'Not added.',
        caption: 'The connection dropped before it went in. Try again.',
      }
    }
  }

  if (index !== -1) {
    const standing = standingAt(state, index)
    const entry = state.entries[index]!
    const id = entry.id

    if (standing.kind === 'played') {
      return { kind: 'status', lead: 'Played', where: `· ${standingWhere(standing)}` }
    }
    if (standing.kind === 'upNow') return { kind: 'status', lead: 'Up now', where: null }

    // `7th` after a label that already says setlist; `7th in the setlist` in a
    // sentence that doesn't. In a show the standing says enough either way.
    const where = standingWhere(standing)
    const sentence = standing.kind === 'queued' ? `${where} in the setlist` : where

    if (id !== null && mine.has(id)) {
      return last?.reason === 'ok' && last.entryId === id
        ? { kind: 'added', entryId: id, where: `${capitalise(sentence)}.` }
        : { kind: 'yours', entryId: id, where: `· ${where}` }
    }
    if (last?.reason === 'alreadyInSetlist') {
      return { kind: 'status', lead: 'Someone added it first.', where: `It's ${sentence}.` }
    }
    return { kind: 'status', lead: 'In the setlist', where: `· ${where}` }
  }

  if (state.guestEdits === 'off') {
    return {
      kind: 'disabled',
      lead: null,
      caption: 'The host has turned off setlist changes for guests.',
    }
  }

  if (last?.reason === 'locked') {
    const stillHolding = state.currentIndex === last.currentIndex && now - last.at < LOCKED_HOLD_MS
    if (stillHolding) {
      return {
        kind: 'disabled',
        lead: 'Hold on a moment.',
        caption: "Everyone's picking their parts. Songs can be added once the show starts.",
      }
    }
  }
  if (last?.reason === 'incompatible' && state.currentIndex === last.currentIndex) {
    return {
      kind: 'disabled',
      lead: 'Not added.',
      caption: "This song has no part for someone who's playing right now.",
    }
  }

  if (state.totalCount >= SETLIST_LIMIT || last?.reason === 'full') {
    return { kind: 'disabled', lead: 'The setlist is full.', caption: `It takes up to ${SETLIST_LIMIT} songs.` }
  }

  const count = state.totalCount
  return {
    kind: 'add',
    // Placement is the end today; when fair ordering arrives the server will
    // decide it, and this caption is where its sentence goes.
    lead: null,
    caption:
      count === 0
        ? 'Goes first in the setlist.'
        : `Goes at the end, after ${count.toLocaleString()} ${count === 1 ? 'song' : 'songs'}.`,
  }
}

// --- Your songs in the panel --------------------------------------------------

/**
 * Where this browser's songs still to come are, in setlist order: everything
 * not yet played, the up-now one included. The first is where the panel's
 * "yours" line jumps to.
 */
export function upcomingOfYours(state: SetlistState, mine: ReadonlySet<number>): number[] {
  const indexes: number[] = []
  state.entries.forEach((entry, index) => {
    if (entry.id !== null && mine.has(entry.id) && standingAt(state, index).kind !== 'played') {
      indexes.push(index)
    }
  })
  return indexes
}

/**
 * Where the entry at `index` goes back to if its removal is undone: after the
 * entry that was above it, or the start if it was first.
 *
 * YARG has no insert-at. An add always appends, so undo is an add and then a
 * move to this placement, taken from the setlist as it stood when the entry
 * was removed. Anchoring on the neighbour rather than a position number is
 * what keeps it right when other songs were added at the end in between.
 */
export function restorePlacement(state: SetlistState, index: number): MovePlan {
  if (index <= 0) return { position: 'start' }
  const above = state.entries[index - 1]
  return above?.id == null ? null : { position: 'after', anchorId: above.id }
}
