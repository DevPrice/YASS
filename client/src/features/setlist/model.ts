/**
 * What the setlist UI says, worked out apart from how it is drawn.
 *
 * Every surface — the banner chip, the panel, the song detail's badge and its
 * action bar — reads the same few derivations, and each of them has cases that
 * are easy to get subtly wrong: a stale setlist that must not claim positions,
 * an "up now" that must not claim to be playing, a "cleared" that must not be
 * said while the setlist is merely out of view, a wait that must not count the
 * song already on stage as one still to come. Pure functions over
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

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/** `51 min`, `14 h 52 min`. */
export function formatRunTime(seconds: number): string {
  return formatMinutes(Math.round(seconds / 60))
}

/**
 * `about 14 min`, for a wait.
 *
 * Rounded up, never to the nearest: `waitSeconds` leaves out the gaps between
 * songs — the score screen, the next chart loading, parts being picked — so it
 * already runs short of the real wait, and rounding down would shorten it
 * again. A guest told fourteen minutes should not be called at twelve.
 *
 * No-break spaces throughout, so a wrapping line never strands `about` from
 * its number or the number from its unit.
 */
export function formatWait(seconds: number): string {
  return `about ${formatMinutes(Math.max(1, Math.ceil(seconds / 60)))}`.replaceAll(' ', ' ')
}

function songs(count: number, more = false): string {
  return `${count.toLocaleString()}${more ? ' more' : ''} ${count === 1 ? 'song' : 'songs'}`
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

/**
 * Roughly how long until the entry at `index` comes up, or null when that
 * can't be said: the same honesty rule as `runTime`, over only the songs ahead
 * of it. `index` may be `entries.length`, the end of the list, where an add
 * goes. Outside a show it is everything before the entry — a wait measured
 * from the show's start, whenever the host starts it.
 *
 * **In a show the up-now song counts as half its length.** It may not have
 * started — players still picking parts, the score screen of the song before —
 * or be nearly over, and nothing on the wire says which: half is the expected
 * remainder when the position is unknown. Counting it whole would overstate
 * every answer by up to half a song to cover a moment that passes quickly;
 * counting none of it would promise a song before it can come.
 */
export function waitSeconds(state: SetlistState, index: number): number | null {
  if (index > state.entries.length) return null
  const current = state.showInProgress ? state.currentIndex : null
  if (current !== null && index <= current) return null

  let total = 0
  for (let at = current ?? 0; at < index; at += 1) {
    const length = state.entries[at]!.lengthSeconds
    if (length === null) return null
    total += at === current ? length / 2 : length
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

/**
 * Where the entry at `index` is, in words that follow a label or a dot:
 * `7th, about 24 min into the show`, `up now`, `up next`,
 * `after 3 more songs, about 14 min`, `2nd in this show`. `inSetlist` names
 * the setlist after an ordinal, for a sentence with no label to say it.
 *
 * **A wait counts the songs still to come before yours**, not including the
 * up-now one: "up in 4 songs" counted the song already playing, and read as
 * four more when three stood in the way. Up next has no time: the only song
 * ahead is the up-now one, so the estimate would be all guess.
 *
 * A comma before the time rather than a dot: beside a remove button on a
 * phone the line wraps there, and a line opening on `·` read as a fragment.
 */
export function whereWords(state: SetlistState, index: number, inSetlist = false): string {
  const standing = standingAt(state, index)
  const wait = waitSeconds(state, index)
  const about = wait === null || wait === 0 ? null : formatWait(wait)

  switch (standing.kind) {
    case 'queued': {
      const where = `${ordinal(standing.position)}${inSetlist ? ' in the setlist' : ''}`
      return about === null ? where : `${where}, ${about} into the show`
    }
    case 'upNow':
      return 'up now'
    case 'upNext':
      return 'up next'
    case 'later': {
      const ahead = `after ${songs(standing.songs - 1, true)}`
      return about === null ? ahead : `${ahead}, ${about}`
    }
    case 'played':
      return `${ordinal(standing.position)} in this show`
  }
}

/**
 * The setlist panel's line about this browser's songs: where the next of them
 * is, and how many are still to come. Null when there are none, or the setlist
 * is stale. `index` is the entry the line is about.
 */
export function yourLine(
  state: SetlistState,
  mine: ReadonlySet<number>,
): { text: string; index: number } | null {
  if (!isLive(setlistMode(state))) return null

  const upcoming: number[] = []
  state.entries.forEach((entry, index) => {
    if (entry.id === null || !mine.has(entry.id)) return
    if (standingAt(state, index).kind !== 'played') upcoming.push(index)
  })

  const next = upcoming[0]
  if (next === undefined) return null

  const verb = standingAt(state, next).kind === 'later' ? 'comes' : 'is'
  const where = whereWords(state, next)
  if (upcoming.length === 1) return { text: `Yours ${verb} ${where}.`, index: next }

  const count = `${upcoming.length.toLocaleString()} of yours${state.showInProgress ? ' to come' : ''}`
  return { text: `${count}. The next ${verb} ${where}.`, index: next }
}

/**
 * The position badge in the detail's identity block, or null.
 *
 * The action bar says where the song is whenever it is drawn, so the badge
 * stands in only where the bar isn't — a YARG that can only be followed. Said
 * in both places it was the same fact twice, and a badge that appeared on add
 * pushed the whole detail down under the guest's thumb. Up now gives way to
 * `Now playing` when the banner names the same song: one true thing, said once.
 */
export function badgeStanding(state: SetlistState, hash: string | null, playing: boolean): Standing | null {
  if (actionBarDrawn(state, hash)) return null
  const standing = standingOf(state, hash)
  return standing?.kind === 'upNow' && playing ? null : standing
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
 * `currentIndex` is the show's position when the answer came, so an answer
 * that was only true of the song then playing can expire when the show moves.
 */
export interface LastTry {
  reason: 'ok' | SetlistRefusal | 'offline'
  entryId: number | null
  currentIndex: number | null
}

/**
 * The bar's states, each one a guest can tell from the others.
 *
 * There used to be seventeen. A 5-second hold after `locked`, a `checking…`
 * state for a dropped connection that settled itself on the next setlist, and
 * separate lines for losing a race to another guest or to YARG closing the
 * library: each was true, and at a party none of them was distinguishable from
 * its neighbour. Those now fall through to the state a guest would act on
 * anyway — the song's standing, the closed line, or the button with a lead
 * saying the last tap didn't settle it.
 */
export type ActionBar =
  | { kind: 'hidden' }
  /**
   * The accent button. `lead` says why the last tap didn't settle it —
   * `Couldn't confirm.`, `Not added:` — and pressing it again is the retry.
   */
  | { kind: 'add'; lead: string | null; caption: string }
  | { kind: 'busy'; label: 'adding…' | 'removing…' }
  /** Just added, with undo. `where` is a whole sentence: `13th in the setlist.` */
  | { kind: 'added'; entryId: number; where: string }
  /** Yours, with remove. `where` follows the lead: `· 7th`. */
  | { kind: 'yours'; entryId: number; where: string }
  /** In the setlist and not changeable from here. `where` follows the lead. */
  | { kind: 'status'; lead: string; where: string | null }
  /** Refused — this song after a tap, or a full setlist: the button drawn and inert, the caption saying why. */
  | { kind: 'refused'; lead: string; caption: string }
  /**
   * Nobody can add anything right now: one muted line saying when they can,
   * and no button. See `actionBar` for why not a disabled one.
   */
  | { kind: 'closed'; text: string }

export interface ActionBarInput {
  state: SetlistState
  hash: string | null
  mine: ReadonlySet<number>
  pending: 'add' | 'remove' | null
  last: LastTry | null
  /** The now-playing banner names this song. */
  playing: boolean
}

/**
 * Whether the action bar is drawn at all: not before a setlist has been seen,
 * nor against a YARG that can only be followed.
 */
export function actionBarDrawn(state: SetlistState, hash: string | null): boolean {
  return setlistMode(state) !== 'absent' && state.guestEdits !== 'unsupported' && hash !== null
}

/**
 * Which of the action bar's states applies, with its copy.
 *
 * **Closed is a line, not a dead button.** Every song played from the library
 * takes the setlist out of view, so for much of a night every detail would
 * carry a grey full-width pill and two lines of caption: height spent on a
 * short screen, and a control that reads as broken. The Say-When rule survives
 * in the line itself — it names what the host has to do before adding opens —
 * and the button comes back lit the moment it can act. A refusal of *this*
 * song keeps its inert button, because there the guest tapped and the button
 * is where they are looking for the answer.
 */
export function actionBar({ state, hash, mine, pending, last, playing }: ActionBarInput): ActionBar {
  if (!actionBarDrawn(state, hash)) return { kind: 'hidden' }

  if (pending !== null) return { kind: 'busy', label: pending === 'add' ? 'adding…' : 'removing…' }

  // Outlives the moment it came back in: nothing about the show changes it.
  if (last?.reason === 'songNotFound') {
    // No guess at the cause. It is usually the host's Max Song Rating, but
    // naming that to a guest is speculation about somebody else's settings.
    return { kind: 'refused', lead: 'Not added:', caption: "the host's game won't play this one." }
  }

  const mode = setlistMode(state)
  if (mode === 'unavailable') return { kind: 'closed', text: "The setlist isn't available right now." }
  if (mode === 'outOfView') {
    // The only way back is through YARG's music library — a show starts from
    // there too — so naming it is the whole of when.
    return { kind: 'closed', text: 'Adding opens when the host is back at the song list.' }
  }

  const index = state.entries.findIndex((entry) => entry.hash === hash)
  if (index !== -1) {
    const standing = standingAt(state, index)
    const id = state.entries[index]!.id
    const yours = id !== null && mine.has(id)

    if (standing.kind === 'played') {
      return { kind: 'status', lead: 'Played', where: `· ${whereWords(state, index)}` }
    }
    if (standing.kind === 'upNow') {
      // No remove: YARG holds the song it is on. And no "up now" when the
      // banner already says this song is playing — the Up-Now rule's "both"
      // is for a row, not for three badges and a bar in one card.
      return { kind: 'status', lead: yours ? 'Yours' : 'In the setlist', where: playing ? null : '· up now' }
    }
    if (yours) {
      return last?.reason === 'ok' && last.entryId === id
        ? { kind: 'added', entryId: id, where: `${capitalise(whereWords(state, index, true))}.` }
        : { kind: 'yours', entryId: id, where: `· ${whereWords(state, index)}` }
    }
    return { kind: 'status', lead: 'In the setlist', where: `· ${whereWords(state, index)}` }
  }

  if (state.guestEdits === 'off') {
    return { kind: 'closed', text: 'The host has turned off setlist changes for guests.' }
  }

  // The phone lost the server, or the server lost YARG, with the add
  // unanswered. Either way it may have gone in, and a song that did would be
  // in the setlist and drawn above; still here, the button is the retry.
  if (last?.reason === 'offline' || last?.reason === 'connectionLost') {
    return { kind: 'add', lead: "Couldn't confirm.", caption: 'Check the setlist.' }
  }

  if (last?.reason === 'incompatible' && state.currentIndex === last.currentIndex) {
    return {
      kind: 'refused',
      lead: 'Not added:',
      caption: "it's missing an instrument someone in this show is playing.",
    }
  }

  // YARG holds every edit while players pick parts for a show's first song,
  // and that moment looks like any other on the wire: `currentIndex` is
  // already 0 and doesn't move when the song starts. So no state can say when
  // the hold lifts — a timer was a guess at it. The button stays live instead,
  // and the caption only reports the tap; pressing again is the retry, and
  // the show moving on retires the words.
  if (last?.reason === 'locked' && state.currentIndex === last.currentIndex) {
    return { kind: 'add', lead: 'Not added:', caption: 'wait for the first song to start, then add.' }
  }

  if (state.totalCount >= SETLIST_LIMIT || last?.reason === 'full') {
    return { kind: 'refused', lead: 'The setlist is full.', caption: `It takes up to ${SETLIST_LIMIT} songs.` }
  }

  // Placement is the end today; when fair ordering arrives the server will
  // decide it, and this caption is where its sentence goes.
  return { kind: 'add', lead: null, caption: addCaption(state) }
}

/** `Goes at the end, after 3 more songs, about 14 min.` */
function addCaption(state: SetlistState): string {
  const count = state.totalCount
  const current = state.showInProgress ? state.currentIndex : null
  const wait = waitSeconds(state, count)
  const about = wait === null || wait === 0 ? null : formatWait(wait)

  if (current === null) {
    if (count === 0) return 'Goes first in the setlist.'
    const after = `Goes at the end, after ${songs(count)}`
    return about === null ? `${after}.` : `${after}, ${about} into the show.`
  }

  const ahead = count - current - 1
  if (ahead <= 0) return 'Goes at the end, up next.'
  const after = `Goes at the end, after ${songs(ahead, true)}`
  return about === null ? `${after}.` : `${after}, ${about}.`
}

// --- Undoing a removal ------------------------------------------------------------

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
