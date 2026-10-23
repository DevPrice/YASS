import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SetlistEntry, SetlistState } from '@shared/types'
import { addGate, markLabel, queuedMarks } from './queued'

const hash = (n: number) => n.toString(16).toUpperCase().padStart(40, '0')

const entry = (n: number, id: number | null = n): SetlistEntry => ({
  id,
  hash: hash(n),
  name: `Song ${n}`,
  artist: 'Artist',
  album: 'Album',
  lengthSeconds: 200,
})

function state(overrides: Partial<SetlistState> = {}): SetlistState {
  const entries = overrides.entries ?? [entry(1), entry(2), entry(3)]
  return {
    link: 'connected',
    guestEdits: 'on',
    active: true,
    showInProgress: false,
    currentIndex: null,
    totalCount: entries.length,
    entries,
    seenAt: 1,
    updatedAt: 10,
    ...overrides,
  }
}

describe('queued marks', () => {
  it('numbers each queued song by its place in the setlist', () => {
    const marks = queuedMarks(state())
    assert.equal(marks.size, 3)
    assert.equal(marks.get(hash(2))?.position, 2)
    assert.equal(markLabel(marks.get(hash(2))!), '2nd in the setlist')
  })

  it('marks nothing while the setlist is out of view or unavailable', () => {
    assert.equal(queuedMarks(state({ active: false })).size, 0)
    assert.equal(queuedMarks(state({ link: 'unreachable' })).size, 0)
  })

  it('keeps the position mid-show and says the standing in the name', () => {
    const marks = queuedMarks(state({ showInProgress: true, currentIndex: 1 }))
    assert.equal(marks.get(hash(1))?.standing.kind, 'played')
    assert.equal(marks.get(hash(2))?.standing.kind, 'upNow')
    assert.equal(marks.get(hash(3))?.position, 3)
    assert.equal(markLabel(marks.get(hash(3))!), 'Up next in the setlist')
  })

  it('takes the first of a chart queued twice, as the action bar does', () => {
    const marks = queuedMarks(state({ entries: [entry(1), entry(2), entry(1, 9)] }))
    assert.equal(marks.get(hash(1))?.position, 1)
  })
})

describe('add gate', () => {
  const mine = new Set<number>()

  it('opens for a song that is not queued while the setlist is live', () => {
    assert.equal(addGate(state(), mine)(hash(7)), true)
    assert.equal(addGate(state({ showInProgress: true, currentIndex: 0 }), mine)(hash(7)), true)
  })

  it('stays shut for a queued song, a song with no hash, and a stale setlist', () => {
    const gate = addGate(state(), mine)
    assert.equal(gate(hash(2)), false)
    assert.equal(gate(null), false)
    assert.equal(addGate(state({ active: false }), mine)(hash(7)), false)
    assert.equal(addGate(state({ link: 'unreachable', seenAt: 1 }), mine)(hash(7)), false)
  })

  it('stays shut when guests may not edit, or the setlist is full', () => {
    assert.equal(addGate(state({ guestEdits: 'off' }), mine)(hash(7)), false)
    assert.equal(addGate(state({ totalCount: 500 }), mine)(hash(7)), false)
  })
})
