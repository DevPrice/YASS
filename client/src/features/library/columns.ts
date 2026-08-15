/**
 * Which columns the table draws, and what the phone row puts beside the time.
 *
 * The list used to show everything it had room for, and "room" was the only
 * question ever asked. That is the right rule for a table of four columns and
 * the wrong one for a table of nine: `parts` and `diff` are two of the loudest
 * things on a row — five glyphs and a drawn ring against text — and they were
 * answering a question ("can the four of us play this, and how hard is it")
 * that most of the time nobody had asked yet. They are what the detail pane is
 * for, and the pane is one click away at every width the table exists at.
 *
 * So the defaults below are a considered edit rather than a capacity limit, and
 * because they are a choice rather than a fact they are also reversible: the
 * picker in the header's corner cell turns any of the seven optional columns
 * back on, and the phone's `row shows` control in the sort panel decides which
 * single mark a 60px row can afford.
 *
 * ## Two authorities, and only one of them is the person reading
 *
 * A column is drawn when it is switched on **and** the list is wide enough for
 * it. The preference is a ceiling; `minList` is the floor, and it exists so
 * turning a column on can never push another one out. Each threshold is the
 * width that column needs *with the whole table present*, which is why they do
 * not move when six of nine columns are off — a rule that changed with the
 * enabled set would mean every toggle silently re-laid-out the columns around
 * it.
 *
 * The floor used to be a container query per column (`hidden @6xl/list:flex`)
 * and is now a number this module owns, for three reasons. The header and the
 * row had to repeat the same query in two different display modes and could
 * drift. A CSS-hidden column still builds its DOM, and `parts` alone is five
 * `<img>` elements on every row of a virtualized list. And the picker has to be
 * able to say *why* a column that is switched on is not on screen, which it
 * cannot do if the answer only exists in the stylesheet.
 *
 * ## Persistence
 *
 * `localStorage`, never the URL. The address bar carries the *view* — the
 * search, the filters, the sort, the song — because that is the thing worth
 * handing to somebody else's phone (see `lib/urlState.ts`). Which columns fit
 * is a fact about the screen it is being read on, and sending a desktop's
 * seven-column table to a phone would be sharing the one part of the view that
 * cannot survive the trip.
 */

import type { DifficultyLens } from '../../lib/difficulty'
import { LENS_LABELS } from '../../lib/difficulty'
import type { SortKey } from './filtering'

export type ColumnId =
  | 'name'
  | 'artist'
  | 'album'
  | 'genre'
  | 'year'
  | 'length'
  | 'parts'
  | 'difficulty'
  | 'source'

/**
 * What a phone row carries out to the right of the title.
 *
 * The same idea as the table's columns, at the scale a 60px row can hold: a
 * set, with a default that is an edit rather than a limit. The floors do not
 * come with it — `source` waits for 1024px as a *column* because a column shows
 * its name, and out here it is a 26px icon that costs nothing.
 *
 * The default is the time and the source. Between the two pictures, the source
 * is the one a row can only get here: the difficulty is a tap away on the
 * detail sheet, carries a number that wants reading rather than glancing, and
 * reads the same for a whole run of the list the moment anybody sorts by it.
 * Both at once is a legal answer and not the recommended one — it is the second
 * picture on the device with room for about one, and the title pays for it.
 */
export type RowField = 'length' | 'source' | 'difficulty'

/** In the order they sit on the row, so the chips read left to right as it does. */
export const ROW_FIELDS: readonly RowField[] = ['length', 'source', 'difficulty']

/**
 * What a row field is called in the sheet that switches it.
 *
 * `time` rather than `length`, matching the column header, and `difficulty`
 * rather than the header's `diff` — that abbreviation is an 80px column's
 * problem and this panel has the width for the word. Under a lens it becomes
 * the part, exactly as the sort chip beside it does.
 */
export function rowFieldLabel(field: RowField, lens: DifficultyLens): string {
  if (field === 'length') return 'time'
  if (field === 'source') return 'source'

  return lens === 'band' ? 'difficulty' : LENS_LABELS[lens]
}

export interface Column {
  id: ColumnId
  /** The header's word for it, and the picker's. Authored lowercase. */
  label: string
  /** Null for a column there is nothing sensible to order by. */
  key: SortKey | null
  /**
   * Geometry, and nothing else — shared verbatim by the header cell and the
   * row cell so the two cannot disagree about where a column starts. Colour,
   * size and weight stay at each call site, because a label and a value are
   * not set the same way.
   */
  box: string
  /** Numbers and the difficulty ring are read from the right edge. */
  align?: 'end'
  /** The list width this column needs before it is drawn at all. See above. */
  minList: number
  /**
   * Not offered to the picker.
   *
   * A row with no title and no artist is not a row — it is four thousand
   * blanks with a year on them. Everything else is a matter of taste.
   */
  fixed?: true
}

/**
 * The list width below which the table gives way to the phone row entirely.
 *
 * Tailwind's `@2xl` — 42rem — kept as a number because JavaScript decides this
 * one: the virtualizer needs a row's height before anything is laid out, and a
 * container query has no answer to give it.
 *
 * **It is necessary and no longer sufficient.** `SongList` also takes the table
 * away on any screen too short to spend 80px a row and 68px on a header, which
 * is a landscape phone at 844px of list — see the note there. So the mirror on
 * the other side is the `has-table` variant in `index.css` rather than a bare
 * `@2xl/list:` class: it carries both halves of the same test, which is what
 * keeps exactly one sort control on screen at any size. Change the number here
 * and the 42rem in that variant has to move with it.
 */
export const WIDE_AT = 672

/**
 * The table, in render order.
 *
 * The thresholds are Tailwind's container sizes in pixels — `@4xl` 896, `@5xl`
 * 1024, `@6xl` 1152, `@7xl` 1280 — because that is what they were authored as
 * and the rest of the file still speaks that language.
 *
 * `source` drops out below 1024 rather than shrinking to a bare icon, because
 * that is a width where the detail pane exists and the pane names the source in
 * full. The phone row keeps its source icon for the mirror-image reason: there
 * is no pane there to fall back to.
 */
export const COLUMNS: readonly Column[] = [
  { id: 'name', label: 'title', key: 'name', box: 'flex-[3] min-w-0', minList: 0, fixed: true },
  {
    id: 'artist',
    label: 'artist',
    key: 'artist',
    box: 'flex-[2] min-w-0',
    minList: 0,
    fixed: true,
  },
  { id: 'album', label: 'album', key: 'album', box: 'flex-[2] min-w-0', minList: 1152 },
  { id: 'genre', label: 'genre', key: 'genre', box: 'w-32 shrink-0', minList: 1280 },
  {
    id: 'year',
    label: 'year',
    key: 'year',
    box: 'w-16 shrink-0 text-right',
    align: 'end',
    minList: 0,
  },
  {
    id: 'length',
    label: 'time',
    key: 'length',
    box: 'w-16 shrink-0 text-right',
    align: 'end',
    minList: 0,
  },
  // Five fixed slots, so the column reads as a matrix down the page rather than
  // a ragged list. Sorting by it would mean inventing an order over a set.
  { id: 'parts', label: 'parts', key: null, box: 'w-28 shrink-0', minList: 896 },
  {
    id: 'difficulty',
    label: 'diff',
    key: 'difficulty',
    box: 'w-20 shrink-0 text-right',
    align: 'end',
    minList: 0,
  },
  { id: 'source', label: 'source', key: 'source', box: 'w-40 shrink-0', minList: 1024 },
]

/** The seven the picker offers. Order follows the table, so the two agree. */
export const OPTIONAL_COLUMNS: readonly Column[] = COLUMNS.filter((column) => column.fixed !== true)

/**
 * What a column is called right now, which for one of them is a moving target.
 *
 * `diff` under the band lens, because the ring below it wears YARG's BAND mark
 * and the word would be naming what the picture already says. Under an
 * instrument it becomes `drums` — the column is quoting a different scale from
 * the one it quoted a moment ago, and 80px is enough for the word that says so.
 * Not `drums diff`: the ring is the only thing in the column, so what it is
 * measuring is not in question. Which part is.
 *
 * Here rather than in the header, because the header is no longer the only
 * thing that has to say it. The sort chips, the jump rail, the filter section
 * and now the column picker all rename together, and a picker offering `diff`
 * while the column beside it reads `drums` would be the one surface out of step.
 */
export function columnLabel(column: Column, lens: DifficultyLens): string {
  if (column.id !== 'difficulty') return column.label

  return lens === 'band' ? column.label : LENS_LABELS[lens].toLowerCase()
}

/**
 * What the list shows, on this device — one set per layout.
 *
 * Two sets rather than one, because the two layouts are not the same table at
 * different sizes: they hold different fields, and the widths a column waits
 * for are meaningless out on a phone row. `length` is the one name in both, and
 * it means the same thing in both.
 */
export interface ListView {
  /** Optional columns switched on. The two fixed ones are never in here. */
  columns: ReadonlySet<ColumnId>
  /** What the phone row carries beside the title. */
  row: ReadonlySet<RowField>
}

const DEFAULT_COLUMNS: readonly ColumnId[] = ['album', 'genre', 'year', 'length', 'source']
const DEFAULT_ROW: readonly RowField[] = ['length', 'source']

export const DEFAULT_VIEW: ListView = {
  columns: new Set(DEFAULT_COLUMNS),
  row: new Set(DEFAULT_ROW),
}

/** Whether this column is both wanted and affordable at the list's current width. */
export function showsColumn(view: ListView, column: Column, listWidth: number): boolean {
  if (listWidth < column.minList) return false

  return column.fixed === true || view.columns.has(column.id)
}

/** Switched on, but the list is too narrow to draw it. What the picker explains. */
export function isCramped(view: ListView, column: Column, listWidth: number): boolean {
  return column.fixed !== true && view.columns.has(column.id) && listWidth < column.minList
}

export function toggleColumn(view: ListView, id: ColumnId): ListView {
  const columns = new Set(view.columns)
  // `delete` reports whether it removed anything, which is the same question
  // `has` would ask a line earlier.
  if (!columns.delete(id)) columns.add(id)

  return { ...view, columns }
}

export function toggleRowField(view: ListView, id: RowField): ListView {
  const row = new Set(view.row)
  if (!row.delete(id)) row.add(id)

  return { ...view, row }
}

export function isDefaultColumns(view: ListView): boolean {
  return (
    view.columns.size === DEFAULT_COLUMNS.length &&
    DEFAULT_COLUMNS.every((id) => view.columns.has(id))
  )
}

/**
 * Every width at which the table changes shape.
 *
 * The list is measured continuously and re-rendered discretely: dragging a
 * window edge across 300px of nothing-happening should cost one render at each
 * end and none in between. `sameShape` is what turns the measurement back into
 * the handful of answers it actually has.
 */
const REVEAL_WIDTHS: readonly number[] = [
  ...new Set([WIDE_AT, ...COLUMNS.map((column) => column.minList)]),
]
  .filter((width) => width > 0)
  .sort((a, b) => a - b)

/** True when two measured widths would draw the same table. */
export function sameShape(a: number, b: number): boolean {
  return REVEAL_WIDTHS.every((width) => a >= width === (b >= width))
}

// --- Stored on the device ------------------------------------------------------

const COLUMNS_KEY = 'yass.list.columns'
const ROW_KEY = 'yass.list.row'

const OPTIONAL_IDS: ReadonlySet<string> = new Set(OPTIONAL_COLUMNS.map((column) => column.id))
const ROW_IDS: ReadonlySet<string> = new Set(ROW_FIELDS)

/**
 * A stored list of ids, or the default when there is nothing stored.
 *
 * The empty string and a missing key are deliberately different answers: `''`
 * is somebody who switched everything off, which is a legal table of title and
 * artist and a legal row of title and artist, and `null` is a device that has
 * never been asked. Unknown ids are dropped rather than kept — a build that
 * renames a field should not leave a ghost in the set that nothing can ever
 * turn off again.
 */
function parseSet<T extends string>(
  raw: string | null,
  known: ReadonlySet<string>,
  fallback: ReadonlySet<T>,
): ReadonlySet<T> {
  if (raw === null) return fallback

  return new Set(raw.split(',').filter((id): id is T => known.has(id)))
}

/**
 * The stored preference, or the designed default.
 *
 * `localStorage` itself can throw — Safari in private browsing, a locked-down
 * embedded webview — and that failure lands on the same answer a fresh device
 * gets, which is the only answer that is always safe to draw. Same contract as
 * the preview's mute preference in `lib/usePreview.ts`.
 */
export function readView(): ListView {
  try {
    return {
      columns: parseSet(
        window.localStorage.getItem(COLUMNS_KEY),
        OPTIONAL_IDS,
        DEFAULT_VIEW.columns,
      ),
      row: parseSet(window.localStorage.getItem(ROW_KEY), ROW_IDS, DEFAULT_VIEW.row),
    }
  } catch {
    return DEFAULT_VIEW
  }
}

/** A device that cannot remember the choice still honours it for this session. */
export function writeView(view: ListView): void {
  try {
    // Written in layout order rather than insertion order, so each stored
    // string is stable and reads like the thing it describes.
    const columns = OPTIONAL_COLUMNS.filter((column) => view.columns.has(column.id))
    const row = ROW_FIELDS.filter((field) => view.row.has(field))

    window.localStorage.setItem(COLUMNS_KEY, columns.map((column) => column.id).join(','))
    window.localStorage.setItem(ROW_KEY, row.join(','))
  } catch {
    // Nothing here is worth failing a click over.
  }
}
