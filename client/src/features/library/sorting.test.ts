/**
 * The date-added ordering: which way it starts, where undated charts go, and
 * how it is divided for headers and for the rail.
 *
 * Worth testing because a header is the only place this value is drawn. A sort
 * that ordered by the instant and grouped by some other day would print
 * headers that contradict the rows under them, and nothing else on screen
 * would say so.
 *
 * `grouping.ts` and `indexing.ts` themselves stay out of reach: both load
 * `lib/sources.ts`, which only Vite can. See `added.ts`.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Song } from '@shared/types'
import { addedDay, addedPeriod } from './added'
import { initialDirection, sortSongs } from './filtering'

function song(id: string, addedAt: number | null): Song {
  return {
    id,
    hash: null,
    name: id,
    artist: 'Artist',
    album: '',
    genre: '',
    subgenre: '',
    charter: '',
    playlist: '',
    source: '',
    year: '',
    yearNumber: null,
    lengthSeconds: null,
    albumTrack: null,
    addedAt,
    isMaster: true,
    ageRating: 'No Rating',
    vocalParts: 0,
    difficulties: {} as Song['difficulties'],
    bandDifficulty: null,
    format: 'Ini',
    hasArt: false,
    hasPreview: false,
  }
}

/** Local noon, so no case sits on a day boundary in any time zone the tests run in. */
const at = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month, day, hour).getTime()

const NOW = at(2026, 8, 24)

describe('sorting by date added', () => {
  const library = [
    song('old', at(2024, 1, 3)),
    song('unknown', null),
    song('today', at(2026, 8, 24)),
    song('yesterday', at(2026, 8, 23)),
    song('august', at(2026, 7, 15)),
  ]

  it('starts newest first, where every other ordering starts ascending', () => {
    assert.equal(initialDirection('added'), 'desc')
    assert.equal(initialDirection('charter'), 'asc')
    assert.equal(initialDirection('name'), 'asc')
  })

  it('keeps undated charts last whichever way it runs', () => {
    const ids = (direction: 'asc' | 'desc') =>
      sortSongs(library, 'added', direction, 'band').map((entry) => entry.id)

    assert.deepEqual(ids('desc'), ['today', 'yesterday', 'august', 'old', 'unknown'])
    assert.deepEqual(ids('asc'), ['old', 'august', 'yesterday', 'today', 'unknown'])
  })
})

describe('the day headers', () => {
  it('names the two most recent days and dates the rest', () => {
    assert.equal(addedDay(at(2026, 8, 24, 1), NOW).label, 'Today')
    assert.equal(addedDay(at(2026, 8, 23, 23), NOW).label, 'Yesterday')
    assert.notEqual(addedDay(at(2026, 8, 22), NOW).label, 'Yesterday')
    assert.equal(addedDay(null, NOW).label, 'Date unknown')
  })

  it('puts two times on one day under one header, and midnight between two', () => {
    assert.equal(addedDay(at(2026, 1, 3, 8), NOW).id, addedDay(at(2026, 1, 3, 22), NOW).id)
    assert.notEqual(addedDay(at(2026, 1, 3, 23), NOW).id, addedDay(at(2026, 1, 4, 0), NOW).id)
  })
})

describe('the rail', () => {
  it('marks a month this year and a whole year before it', () => {
    const september = addedPeriod(at(2026, 8, 2), NOW)
    const earlier = addedPeriod(at(2026, 8, 20), NOW)
    const lastYear = addedPeriod(at(2025, 1, 3), NOW)

    assert.equal(september.id, earlier.id)
    assert.equal(september.numeric, false)

    assert.equal(lastYear.label, '2025')
    assert.equal(lastYear.short, "'25")
    assert.equal(lastYear.numeric, true)
    assert.equal(lastYear.id, addedPeriod(at(2025, 11, 30), NOW).id)
  })

  it('covers every day of a month with one mark', () => {
    // A mark coarser than the headers always lands on a header the list
    // draws; one that split a day would name a place and arrive unlabelled.
    for (let day = 1; day <= 30; day++) {
      assert.equal(addedPeriod(at(2026, 5, day), NOW).id, addedPeriod(at(2026, 5, 1), NOW).id)
    }
  })

  it('draws the undated run with the shared dash', () => {
    assert.equal(addedPeriod(null, NOW).short, null)
  })
})
