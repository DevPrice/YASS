/**
 * How the date-added ordering is divided: by day for headers, coarser for the
 * rail.
 *
 * Its own module, rather than in `grouping.ts` and `indexing.ts` beside the
 * other keys, because those two reach `lib/sources.ts` and its Vite-only
 * `import.meta.glob`, which `node --test` cannot load. These are the two
 * divisions with arithmetic in them worth testing.
 *
 * Both take `now` as a parameter so a list left open over midnight is only
 * wrong until it is next grouped, and so a test can pin it.
 */

/** A division of the list: canonical identity, and what it is called. */
export interface AddedDivision {
  id: string
  label: string
}

/** Local midnight at the start of the day `time` falls in. */
function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const LONG_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })

/**
 * One header per day, as YARG heads its Date Added sort.
 *
 * Days rather than anything coarser because a library grows in imports, not in
 * a trickle: a real one has 4,231 songs across 26 days, and each day is a pack
 * somebody copied in. The two most recent are named relatively, since "today"
 * is the answer to "what's new" and a date has to be worked out.
 */
export function addedDay(addedAt: number | null, now: number): AddedDivision {
  if (addedAt === null) return { id: 'added:unknown', label: 'Date unknown' }

  const day = startOfDay(addedAt)
  const today = startOfDay(now)
  const yesterday = startOfDay(today - 1)

  const label =
    day === today ? 'Today' : day === yesterday ? 'Yesterday' : LONG_DATE.format(day)
  return { id: `added:${day}`, label }
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' })
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

/**
 * The day headers, coarsened to months this year and to years before it.
 *
 * Months alone would be twelve marks a year forever; years alone would put a
 * whole summer of imports behind one mark. The split follows how far back
 * anybody means when they say "recently". `'23` rather than `2023` for the
 * reason the decades are `80s`: a rail slot has room for three characters, and
 * the callout says the rest.
 *
 * `short` is null for the undated run, which the rail draws with the same dash
 * every key uses for a missing value.
 */
export function addedPeriod(
  addedAt: number | null,
  now: number,
): AddedDivision & { short: string | null; numeric: boolean } {
  if (addedAt === null) {
    return { id: 'added:unknown', label: 'Date unknown', short: null, numeric: false }
  }

  const date = new Date(addedAt)
  const year = date.getFullYear()

  if (year !== new Date(now).getFullYear()) {
    return {
      id: `added:${year}`,
      label: String(year),
      short: `'${String(year).slice(-2)}`,
      numeric: true,
    }
  }

  return {
    id: `added:${year}-${date.getMonth()}`,
    label: MONTH_YEAR.format(date),
    short: MONTH.format(date),
    numeric: false,
  }
}
