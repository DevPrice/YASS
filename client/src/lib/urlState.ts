/**
 * The whole view, in the address bar.
 *
 * Everything a person builds up in this app — a search, six filter dimensions,
 * a sort, a difficulty lens, the song they are looking at — used to live only in
 * React state, which meant it survived nothing. A refresh lost it. A phone lock
 * that evicted the tab lost it. Handing your phone to the person next to you so
 * they could see what you had found lost it, which is the one that matters,
 * because handing your phone to somebody is the entire social mechanic of a
 * room picking a song.
 *
 * The query string fixes all four at once and adds the thing none of them asked
 * for: the view becomes a link. "Everything under five minutes we can all play"
 * is now something you can send to four phones instead of describing across a
 * room.
 *
 * **Written with `replaceState`, never `pushState`.** The URL is a description
 * of where you are, not a trail of how you got here. Pushing would put an entry
 * in the history for every chip tapped and every arrow-key step through the
 * list, and turn Back — the hardware button on every Android phone in the room —
 * into a control that undoes one letter of a search. Back therefore leaves the
 * app rather than unwinding a filter; Escape is the undo, and it already unwinds
 * one layer at a time.
 *
 * `popstate` is still handled, because a real navigation (opening a shared link
 * from within the same tab, or Back arriving from somewhere else) has to be read
 * back rather than ignored.
 *
 * Decoding is total and never throws. A hand-edited URL, a link from an older
 * build, a value the CSV no longer contains: each unknown piece is dropped and
 * the rest is kept. A shared link that half-works beats an error screen at a
 * party, and a filter naming a genre nobody has simply matches nothing, which is
 * a result the UI already renders.
 */

import type { InstrumentGroup } from '@shared/types'
import { INSTRUMENT_GROUPS } from '@shared/types'
import type { DifficultyLens } from './difficulty'
import { isDifficultyLens } from './difficulty'
import { EMPTY_FILTERS, UNKNOWN } from '../features/library/filtering'
import type { Filters, SortDirection, SortKey } from '../features/library/filtering'

/**
 * The state a URL carries. Deliberately not "the app's state" — `openPanel` and
 * the selection's scroll alignment are transient and belong to the session.
 */
export interface AppState {
  filters: Filters
  sortKey: SortKey
  sortDirection: SortDirection
  lens: DifficultyLens
  /** `Song.id` of the open song, or null. */
  selectedId: string | null
}

export const DEFAULT_SORT_KEY: SortKey = 'artist'
export const DEFAULT_SORT_DIRECTION: SortDirection = 'asc'
export const DEFAULT_LENS: DifficultyLens = 'band'

export const DEFAULT_STATE: AppState = {
  filters: EMPTY_FILTERS,
  sortKey: DEFAULT_SORT_KEY,
  sortDirection: DEFAULT_SORT_DIRECTION,
  lens: DEFAULT_LENS,
  selectedId: null,
}

/** Short names, because this string is read by humans on a phone. */
const PARAM = {
  search: 'q',
  sources: 'src',
  genres: 'gen',
  decades: 'dec',
  vocals: 'voc',
  lengths: 'len',
  intensities: 'diff',
  instruments: 'has',
  masterOnly: 'orig',
  lens: 'lens',
  sortKey: 'sort',
  sortDirection: 'dir',
  selectedId: 'song',
} as const

/** `-1` is legal in a URL and reads as an off-by-one typo. `x` reads as "unset". */
const UNKNOWN_PARAM = 'x'

/**
 * One key per dimension, values joined on a comma: `?dec=1980,1990`.
 *
 * **Which needs escaping, because a genre is whatever a charter typed.** The
 * library this was built against has no comma in any of its 26 sources or 56
 * genres — and 16 of its 50 *charters* read like `Harmonix, Rhythm Authors`.
 * Those are the same free-text CSV columns filled in by the same people, so a
 * comma in a genre is not a hypothetical, it is a library we haven't been
 * handed yet. A separator that can appear inside a value silently splits one
 * filter into two that match nothing.
 *
 * Backslash is the escape, and escapes itself. Nothing in a real value needs
 * it, so the readable URL the comma form was asked for stays readable — the
 * machinery only shows up on the values that would otherwise break.
 */
const ESCAPE = '\\'

function encodeList(values: readonly string[]): string {
  return values
    .map((value) => value.replaceAll(ESCAPE, ESCAPE + ESCAPE).replaceAll(',', ESCAPE + ','))
    .join(',')
}

/**
 * Split on unescaped commas. Total, like everything else here: a hand-edited
 * value ending in a lone backslash drops it rather than throwing.
 */
function splitList(raw: string | null): string[] {
  if (raw === null || raw === '') return []

  const out: string[] = []
  let current = ''
  let escaped = false

  for (const char of raw) {
    if (escaped) {
      current += char
      escaped = false
    } else if (char === ESCAPE) {
      escaped = true
    } else if (char === ',') {
      out.push(current)
      current = ''
    } else {
      current += char
    }
  }
  out.push(current)

  return out
}

const SORT_KEYS: readonly SortKey[] = [
  'name',
  'artist',
  'album',
  'year',
  'length',
  'difficulty',
  'charter',
  'source',
  'genre',
]

function encodeNumbers(values: readonly number[]): string {
  return encodeList(values.map((value) => (value === UNKNOWN ? UNKNOWN_PARAM : String(value))))
}

/**
 * Numbers cannot contain the separator or the escape, so they go through the
 * same splitter as the strings rather than a second one — one parser is one
 * thing to get right.
 */
function decodeNumbers(raw: string | null): number[] {
  const out: number[] = []

  for (const value of splitList(raw)) {
    if (value === UNKNOWN_PARAM) {
      out.push(UNKNOWN)
      continue
    }

    const parsed = Number(value)
    if (value !== '' && Number.isFinite(parsed) && Number.isInteger(parsed)) out.push(parsed)
  }

  // A URL can repeat a value; the filter model cannot, or the token row would
  // draw the same chip twice and removing one would leave the other.
  return [...new Set(out)]
}

function decodeStrings(raw: string | null): string[] {
  return [...new Set(splitList(raw).filter((value) => value !== ''))]
}

/**
 * State → query string, omitting everything that is already the default.
 *
 * A first visit has to leave a bare URL: appending `?sort=artist&dir=asc&lens=band`
 * to an untouched app would be twenty characters of noise in the one place a
 * phone shows five, and would make the address bar look like something had been
 * configured when nothing had.
 */
export function encodeAppState(state: AppState): string {
  const params = new URLSearchParams()
  const { filters } = state

  if (filters.search.trim() !== '') params.set(PARAM.search, filters.search)

  // Only when there is something to say, so an untouched dimension leaves no
  // `src=` sitting empty in the address bar.
  const list = (key: string, encoded: string) => {
    if (encoded !== '') params.set(key, encoded)
  }

  list(PARAM.sources, encodeList(filters.sources))
  list(PARAM.genres, encodeList(filters.genres))
  list(PARAM.instruments, encodeList(filters.instruments))
  list(PARAM.decades, encodeNumbers(filters.decades))
  list(PARAM.vocals, encodeNumbers(filters.vocals))
  list(PARAM.lengths, encodeNumbers(filters.lengths))
  list(PARAM.intensities, encodeNumbers(filters.intensities))

  if (filters.masterOnly) params.set(PARAM.masterOnly, '1')
  if (state.lens !== DEFAULT_LENS) params.set(PARAM.lens, state.lens)
  if (state.sortKey !== DEFAULT_SORT_KEY) params.set(PARAM.sortKey, state.sortKey)
  if (state.sortDirection !== DEFAULT_SORT_DIRECTION) params.set(PARAM.sortDirection, 'desc')
  if (state.selectedId !== null) params.set(PARAM.selectedId, state.selectedId)

  /*
   * `toString` percent-encodes the separator, and the separator is the point.
   *
   * `URLSearchParams` escapes every sub-delimiter it is allowed to, so a joined
   * list serialises as `src=rb2dlc%2Cfnfestival` — correct, and unreadable in
   * the one place this string is read by a person holding a phone. A comma is a
   * legal query character (RFC 3986 lists it as a sub-delim), so it is handed
   * back afterwards.
   *
   * Only the comma. `%5C` stays encoded: the backslash is the escape, it is not
   * a sub-delim, and the values that carry one are exactly the values where
   * being sloppy would split a filter in half.
   */
  const query = params.toString().replaceAll('%2C', ',')

  // `?` alone is a URL that says "there was a query and it is empty". A cleared
  // filter set should leave the address bar exactly as it was found.
  return query === '' ? '' : `?${query}`
}

/** Query string → state, dropping anything unrecognised. */
export function decodeAppState(search: string): AppState {
  const params = new URLSearchParams(search)

  const instruments = decodeStrings(params.get(PARAM.instruments)).filter(
    (value): value is InstrumentGroup => (INSTRUMENT_GROUPS as readonly string[]).includes(value),
  )

  const filters: Filters = {
    search: params.get(PARAM.search) ?? '',
    sources: decodeStrings(params.get(PARAM.sources)),
    genres: decodeStrings(params.get(PARAM.genres)),
    decades: decodeNumbers(params.get(PARAM.decades)),
    vocals: decodeNumbers(params.get(PARAM.vocals)),
    lengths: decodeNumbers(params.get(PARAM.lengths)),
    intensities: decodeNumbers(params.get(PARAM.intensities)),
    instruments,
    masterOnly: params.get(PARAM.masterOnly) === '1',
  }

  const rawLens = params.get(PARAM.lens)
  const rawSort = params.get(PARAM.sortKey)

  return {
    filters,
    sortKey:
      rawSort !== null && (SORT_KEYS as readonly string[]).includes(rawSort)
        ? (rawSort as SortKey)
        : DEFAULT_SORT_KEY,
    sortDirection: params.get(PARAM.sortDirection) === 'desc' ? 'desc' : DEFAULT_SORT_DIRECTION,
    lens: rawLens !== null && isDifficultyLens(rawLens) ? rawLens : DEFAULT_LENS,
    selectedId: params.get(PARAM.selectedId),
  }
}

/**
 * Long enough that a typing burst is one write, short enough that the URL is
 * already correct by the time anybody could copy it.
 */
const SYNC_DELAY_MS = 300

/**
 * Put the state in the address bar without touching the history stack.
 *
 * **Debounced, because Safari counts these.** WebKit throws a `SecurityError`
 * past roughly a hundred `replaceState` calls in thirty seconds, and this runs
 * from an effect that fires on every keystroke — a sustained search is exactly
 * the shape of input that trips it. On iOS, which is most of the phones in the
 * room, that exception would surface from inside a React effect and take the
 * app down mid-word. Collapsing a burst into one write also happens to be the
 * honest behaviour: nobody reads the address bar between two keystrokes.
 *
 * Guarded on the string already matching as well, so a re-render that changed
 * nothing costs nothing.
 *
 * And wrapped, because the rate limit is a *browser* policy with no specified
 * ceiling — the fallback for "we could not update the address bar" is a URL
 * that lags the view, never a blank screen.
 */
let syncTimer: number | undefined

export function syncUrl(state: AppState): void {
  window.clearTimeout(syncTimer)

  syncTimer = window.setTimeout(() => {
    const next = `${window.location.pathname}${encodeAppState(state)}`
    const current = `${window.location.pathname}${window.location.search}`
    if (next === current) return

    try {
      window.history.replaceState(null, '', next)
    } catch {
      // Rate-limited. The next change will try again.
    }
  }, SYNC_DELAY_MS)
}
