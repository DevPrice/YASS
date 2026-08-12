/**
 * The list-view preference: defaults, the round trip through storage, and the
 * hostile inputs a stored string can actually be.
 *
 * Worth testing because every one of these failures is silent. A default that
 * drifts shows the wrong table to everybody who never opened the picker; a
 * parser that cannot tell "switched everything off" from "never asked" quietly
 * restores five columns somebody removed; and a `localStorage` that throws —
 * Safari in private browsing, a locked-down webview — must land on the same
 * table a fresh device gets rather than on a blank one.
 *
 * `window` is stubbed rather than mocked away, because the module reads it
 * directly by design. Restored after each case so the cases cannot leak into
 * each other.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  COLUMNS,
  DEFAULT_VIEW,
  OPTIONAL_COLUMNS,
  ROW_FIELDS,
  columnLabel,
  isCramped,
  isDefaultColumns,
  readView,
  rowFieldLabel,
  sameShape,
  showsColumn,
  toggleColumn,
  toggleRowField,
  writeView,
} from './columns'
import type { ColumnId, ListView } from './columns'

/** A `localStorage` that records, or one that throws the way Safari's can. */
function fakeStorage(seed?: Record<string, string>, broken = false) {
  const values = new Map(Object.entries(seed ?? {}))

  const storage = {
    getItem(key: string): string | null {
      if (broken) throw new Error('SecurityError')
      return values.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      if (broken) throw new Error('QuotaExceededError')
      values.set(key, value)
    },
  }

  const globals = globalThis as unknown as Record<string, unknown>
  globals.window = { localStorage: storage }

  return values
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).window
})

/** A column looked up by id, so the cases read as the table does. */
function column(id: ColumnId) {
  const found = COLUMNS.find((candidate) => candidate.id === id)
  assert.ok(found !== undefined, `no such column: ${id}`)

  return found
}

describe('the table', () => {
  it('leaves parts and diff off, and everything else on', () => {
    assert.equal(DEFAULT_VIEW.columns.has('parts'), false)
    assert.equal(DEFAULT_VIEW.columns.has('difficulty'), false)

    for (const id of ['album', 'genre', 'year', 'length', 'source'] as const) {
      assert.equal(DEFAULT_VIEW.columns.has(id), true, `${id} should be on by default`)
    }
  })

  it('gives a phone row the time and the source, and not the difficulty ring', () => {
    assert.deepEqual([...DEFAULT_VIEW.row], ['length', 'source'])
  })

  it('never offers the title or the artist to the picker', () => {
    const offered = OPTIONAL_COLUMNS.map((entry) => entry.id)

    assert.equal(offered.includes('name'), false)
    assert.equal(offered.includes('artist'), false)
    assert.equal(offered.length, 7)
  })

  it('draws the fixed columns whatever the preference says', () => {
    const nothing: ListView = { columns: new Set(), row: new Set() }

    assert.equal(showsColumn(nothing, column('name'), 1920), true)
    assert.equal(showsColumn(nothing, column('artist'), 1920), true)
    assert.equal(showsColumn(nothing, column('year'), 1920), false)
  })

  it('holds a column back until the list is wide enough for it', () => {
    // `album` needs 1152. On is not the same as shown.
    assert.equal(showsColumn(DEFAULT_VIEW, column('album'), 1151), false)
    assert.equal(showsColumn(DEFAULT_VIEW, column('album'), 1152), true)
  })

  it('calls a column cramped only when the width is the thing stopping it', () => {
    assert.equal(isCramped(DEFAULT_VIEW, column('album'), 900), true)
    assert.equal(isCramped(DEFAULT_VIEW, column('album'), 1200), false)
    // Off is not cramped — nobody asked for it.
    assert.equal(isCramped(DEFAULT_VIEW, column('parts'), 900), false)
  })
})

describe('what a column is called', () => {
  it('leaves every column but one alone under any lens', () => {
    assert.equal(columnLabel(column('album'), 'band'), 'album')
    assert.equal(columnLabel(column('album'), 'drums'), 'album')
    assert.equal(columnLabel(column('length'), 'vocals'), 'time')
  })

  it('says diff for the band and the part for anything else', () => {
    assert.equal(columnLabel(column('difficulty'), 'band'), 'diff')
    assert.equal(columnLabel(column('difficulty'), 'drums'), 'drums')
    assert.equal(columnLabel(column('difficulty'), 'vocals'), 'vocals')
  })
})

describe('toggling', () => {
  it('adds what is missing and removes what is there', () => {
    const on = toggleColumn(DEFAULT_VIEW, 'parts')
    assert.equal(on.columns.has('parts'), true)

    const off = toggleColumn(on, 'parts')
    assert.equal(off.columns.has('parts'), false)
  })

  it('leaves the original alone', () => {
    toggleColumn(DEFAULT_VIEW, 'parts')
    assert.equal(DEFAULT_VIEW.columns.has('parts'), false)
  })

  it('leaves the phone row alone', () => {
    const view: ListView = { columns: new Set(), row: new Set(['difficulty' as const]) }
    assert.deepEqual([...toggleColumn(view, 'year').row], ['difficulty'])
  })

  it('knows when it is back where it started', () => {
    assert.equal(isDefaultColumns(DEFAULT_VIEW), true)
    assert.equal(isDefaultColumns(toggleColumn(DEFAULT_VIEW, 'parts')), false)
    // Same size, different members — a count is not an answer.
    const swapped = toggleColumn(toggleColumn(DEFAULT_VIEW, 'year'), 'parts')
    assert.equal(isDefaultColumns(swapped), false)
  })
})

describe('the phone row', () => {
  it('offers the three fields in the order they sit on the row', () => {
    assert.deepEqual([...ROW_FIELDS], ['length', 'source', 'difficulty'])
  })

  it('names the time after the column header, and the ring after the lens', () => {
    assert.equal(rowFieldLabel('length', 'band'), 'time')
    assert.equal(rowFieldLabel('source', 'drums'), 'source')
    // The word, not the header's `diff` abbreviation — this panel has the room.
    assert.equal(rowFieldLabel('difficulty', 'band'), 'difficulty')
    assert.equal(rowFieldLabel('difficulty', 'drums'), 'Drums')
  })

  it('toggles a field without touching the columns', () => {
    const off = toggleRowField(DEFAULT_VIEW, 'length')
    assert.equal(off.row.has('length'), false)
    assert.equal(off.row.has('source'), true)
    assert.equal(isDefaultColumns(off), true)

    assert.equal(toggleRowField(off, 'length').row.has('length'), true)
  })

  it('leaves the original alone', () => {
    toggleRowField(DEFAULT_VIEW, 'length')
    assert.equal(DEFAULT_VIEW.row.has('length'), true)
  })

  it('lets every field go, which leaves a title and an artist', () => {
    const bare = [...DEFAULT_VIEW.row].reduce(toggleRowField, DEFAULT_VIEW)
    assert.equal(bare.row.size, 0)
  })
})

describe('the measured width', () => {
  it('calls two widths the same when no column changes between them', () => {
    assert.equal(sameShape(700, 890), true)
    assert.equal(sameShape(1300, 1920), true)
  })

  it('separates them the moment one does', () => {
    // 896 is where `parts` becomes affordable.
    assert.equal(sameShape(890, 900), false)
    // 672 is where the table gives way to the phone row entirely.
    assert.equal(sameShape(660, 680), false)
  })
})

describe('storage', () => {
  it('gives a device that has never been asked the designed default', () => {
    fakeStorage()
    const view = readView()

    assert.equal(isDefaultColumns(view), true)
    assert.deepEqual([...view.row], ['length', 'source'])
  })

  it('round-trips a choice', () => {
    fakeStorage()
    writeView({ columns: new Set(['parts', 'difficulty']), row: new Set(['difficulty']) })

    const view = readView()
    assert.deepEqual([...view.columns].sort(), ['difficulty', 'parts'])
    assert.deepEqual([...view.row], ['difficulty'])
  })

  it('writes the columns in table order, whatever order they were chosen in', () => {
    const values = fakeStorage()
    writeView({ columns: new Set(['source', 'album', 'year']), row: new Set(['source']) })

    assert.equal(values.get('yass.list.columns'), 'album,year,source')
  })

  it('tells "everything off" apart from "never asked"', () => {
    fakeStorage({ 'yass.list.columns': '' })
    assert.equal(readView().columns.size, 0)
  })

  it('drops ids nothing draws any more', () => {
    fakeStorage({ 'yass.list.columns': 'album,charter,,name' })
    const view = readView()

    // `charter` was never a column and `name` is not optional; neither can be
    // left in a set the picker has no switch for.
    assert.deepEqual([...view.columns], ['album'])
  })

  it('drops row fields it does not recognise, keeping the ones it does', () => {
    fakeStorage({ 'yass.list.row': 'sideways,difficulty' })
    assert.deepEqual([...readView().row], ['difficulty'])
  })

  it('lets a phone row be emptied, and tells that from never asked', () => {
    fakeStorage({ 'yass.list.row': '' })
    assert.equal(readView().row.size, 0)
  })

  it('draws the default table when storage itself throws', () => {
    fakeStorage(undefined, true)
    const view = readView()

    assert.equal(isDefaultColumns(view), true)
    assert.deepEqual([...view.row], ['length', 'source'])
  })

  it('does not fail a click when storage refuses the write', () => {
    fakeStorage(undefined, true)
    assert.doesNotThrow(() => writeView(DEFAULT_VIEW))
  })
})
