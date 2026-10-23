/**
 * The setlist UI's rules, without the UI.
 *
 * The cases worth pinning are the ones where the obvious reading is wrong: a
 * stale list claiming positions, "up now" claiming to be playing, "cleared"
 * said of a setlist that was only out of view, and an action bar that lets a
 * guest discover after the tap what it could have said before it.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SetlistEntry, SetlistState } from '@shared/types'
import {
  actionBar,
  dropPlacement,
  droppedIndex,
  earlier,
  firstOpenGap,
  later,
  lostToClearing,
  ordinal,
  runTime,
  setlistMode,
  standingOf,
  wasCleared,
  type ActionBarInput,
} from './model'

const hash = (n: number) => n.toString(16).toUpperCase().padStart(40, '0')

const entry = (n: number, lengthSeconds: number | null = 200): SetlistEntry => ({
  id: n,
  hash: hash(n),
  name: `Song ${n}`,
  artist: 'Artist',
  album: 'Album',
  lengthSeconds,
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

const show = (currentIndex: number, overrides: Partial<SetlistState> = {}) =>
  state({ showInProgress: true, currentIndex, ...overrides })

describe('setlist mode', () => {
  it('draws nothing at all until a setlist has been seen', () => {
    assert.equal(setlistMode(state({ link: 'off', active: false, seenAt: null })), 'absent')
    assert.equal(setlistMode(state({ link: 'unreachable', active: false, seenAt: 5 })), 'unavailable')
  })

  it('tells live, show and out of view apart', () => {
    assert.equal(setlistMode(state()), 'live')
    assert.equal(setlistMode(show(0)), 'show')
    assert.equal(setlistMode(state({ active: false })), 'outOfView')
    // Connected but never active is still out of view, not absent: YARG is
    // there, and the panel can say when it will share.
    assert.equal(setlistMode(state({ active: false, seenAt: null })), 'outOfView')
  })
})

describe('where a song stands', () => {
  it('numbers it outside a show, and places it against the show inside one', () => {
    assert.deepEqual(standingOf(state(), hash(2)), { kind: 'queued', position: 2 })
    const during = show(1, { entries: [entry(1), entry(2), entry(3), entry(4)] })
    assert.deepEqual(standingOf(during, hash(1)), { kind: 'played', position: 1 })
    assert.deepEqual(standingOf(during, hash(2)), { kind: 'upNow' })
    assert.deepEqual(standingOf(during, hash(3)), { kind: 'upNext' })
    assert.deepEqual(standingOf(during, hash(4)), { kind: 'later', songs: 2 })
  })

  it('claims no position from a stale setlist', () => {
    assert.equal(standingOf(state({ active: false }), hash(2)), null)
    assert.equal(standingOf(state({ link: 'unreachable', active: false }), hash(2)), null)
  })

  it('says English ordinals', () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), [
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st',
    ])
  })

  it('totals a run time only when it can be honest about it', () => {
    assert.equal(runTime(state()), 600)
    assert.equal(runTime(state(), 1), 400)
    assert.equal(runTime(state({ entries: [entry(1), entry(2, null)] })), null)
    assert.equal(runTime(state({ totalCount: 900 })), null)
  })
})

describe('cleared', () => {
  const stale = state({ active: false })

  it('is said only when a setlist that had songs comes back empty', () => {
    assert.ok(wasCleared(stale, state({ entries: [] })))
  })

  it('is never said of a setlist that is only out of view', () => {
    assert.ok(!wasCleared(state(), stale))
    assert.ok(!wasCleared(stale, state({ active: false, entries: [] })))
  })

  it('is not said when the same songs come back', () => {
    // Backing out of Difficulty Select.
    assert.ok(!wasCleared(stale, state()))
  })

  it("remembers this browser's unplayed songs it took", () => {
    const wiped = show(1, { active: false, entries: [entry(1), entry(2), entry(3), entry(4)] })
    assert.deepEqual(
      lostToClearing(wiped, new Set([1, 3, 4])).map((e) => e.id),
      [3, 4],
    )
  })
})

describe('moving your own song a step', () => {
  const list = state({ entries: [entry(1), entry(2), entry(3), entry(4)] })

  it('moves earlier by anchoring after the entry two above, or to the start', () => {
    assert.deepEqual(earlier(list, 3), { position: 'after', anchorId: 2 })
    assert.deepEqual(earlier(list, 1), { position: 'start' })
    assert.equal(earlier(list, 0), null)
  })

  it('never lands at or before the song the show is on', () => {
    const during = show(1, { entries: list.entries })
    assert.equal(earlier(during, 2), null)
    assert.deepEqual(earlier(during, 3), { position: 'after', anchorId: 2 })
  })

  it('moves later by anchoring after the entry below', () => {
    assert.deepEqual(later(list, 1), { position: 'after', anchorId: 3 })
    assert.equal(later(list, 3), null)
  })
})

describe('dropping a dragged song', () => {
  const list = state({ entries: [entry(1), entry(2), entry(3), entry(4)] })

  it('anchors after the entry above the gap, or goes to the start', () => {
    assert.deepEqual(dropPlacement(list, 3, 0), { position: 'start' })
    assert.deepEqual(dropPlacement(list, 0, 3), { position: 'after', anchorId: 3 })
    assert.deepEqual(dropPlacement(list, 0, 4), { position: 'after', anchorId: 4 })
  })

  it('is no move at all when dropped back where it came from', () => {
    assert.equal(dropPlacement(list, 2, 2), null)
    assert.equal(dropPlacement(list, 2, 3), null)
  })

  it('refuses gaps at or before the song the show is on, but allows next', () => {
    const during = show(1, { entries: list.entries })
    assert.equal(firstOpenGap(during), 2)
    assert.equal(dropPlacement(during, 3, 1), null)
    assert.deepEqual(dropPlacement(during, 3, 2), { position: 'after', anchorId: 2 })
  })

  it('knows where the song lands', () => {
    assert.equal(droppedIndex(3, 0), 0)
    assert.equal(droppedIndex(0, 3), 2)
  })
})

describe('the action bar', () => {
  const input = (overrides: Partial<ActionBarInput> = {}): ActionBarInput => ({
    state: state(),
    hash: hash(9),
    mine: new Set(),
    pending: false,
    last: null,
    now: 100,
    ...overrides,
  })

  it('offers the add, and says where it will go', () => {
    assert.deepEqual(actionBar(input()), {
      kind: 'add',
      lead: null,
      caption: 'Goes at the end, after 3 songs.',
    })
  })

  it('says when adding will work before anyone taps, while YARG is not sharing', () => {
    // The requirement this bar exists for.
    const bar = actionBar(input({ state: state({ active: false }) }))
    assert.equal(bar.kind, 'disabled')
    assert.match(bar.kind === 'disabled' ? bar.caption : '', /picking songs in YARG, or during a show/)
  })

  it('draws nothing against a YARG that can only be followed', () => {
    assert.deepEqual(actionBar(input({ state: state({ guestEdits: 'unsupported' }) })), {
      kind: 'hidden',
    })
  })

  it('says the host turned it off, before the tap', () => {
    const bar = actionBar(input({ state: state({ guestEdits: 'off' }) }))
    assert.equal(bar.kind === 'disabled' && bar.caption, 'The host has turned off setlist changes for guests.')
  })

  it("offers remove on yours, and only status on someone else's", () => {
    assert.deepEqual(actionBar(input({ hash: hash(2), mine: new Set([2]) })), {
      kind: 'yours',
      entryId: 2,
      where: '· 2nd',
    })
    assert.deepEqual(actionBar(input({ hash: hash(2) })), {
      kind: 'status',
      lead: 'In the setlist',
      where: '· 2nd',
    })
  })

  it('offers undo right after an add, and says where it went', () => {
    const last = { reason: 'ok' as const, entryId: 2, currentIndex: null, at: 5 }
    assert.deepEqual(actionBar(input({ hash: hash(2), mine: new Set([2]), last })), {
      kind: 'added',
      entryId: 2,
      where: '2nd in the setlist.',
    })
  })

  it('points at the copy when someone else added it first', () => {
    const last = { reason: 'alreadyInSetlist' as const, entryId: 3, currentIndex: null, at: 5 }
    assert.deepEqual(actionBar(input({ hash: hash(3), last })), {
      kind: 'status',
      lead: 'Someone added it first.',
      where: "It's 3rd in the setlist.",
    })
  })

  it('holds "hold on a moment" until the show moves or five seconds pass', () => {
    const last = { reason: 'locked' as const, entryId: null, currentIndex: null, at: 100 }
    assert.equal(actionBar(input({ last, now: 1_000 })).kind, 'disabled')
    assert.equal(actionBar(input({ last, now: 6_000 })).kind, 'add')
    assert.equal(actionBar(input({ last, state: show(0, { entries: [entry(1)] }) })).kind, 'add')
  })

  it('keeps an incompatible song refused until the show moves on', () => {
    const last = { reason: 'incompatible' as const, entryId: null, currentIndex: 0, at: 1 }
    assert.equal(actionBar(input({ last, state: show(0) })).kind, 'disabled')
    assert.equal(actionBar(input({ last, state: show(1) })).kind, 'add')
  })

  it('checks after a dropped connection, and settles on the next setlist', () => {
    const last = { reason: 'connectionLost' as const, entryId: null, currentIndex: null, at: 10 }
    assert.equal(actionBar(input({ last })).kind, 'checking')

    const notIn = actionBar(input({ last, state: state({ updatedAt: 11 }) }))
    assert.equal(notIn.kind === 'add' && notIn.lead, 'Not added.')

    const wentIn = actionBar(
      input({ last, state: state({ updatedAt: 11, entries: [entry(1), entry(9)] }) }),
    )
    assert.equal(wentIn.kind, 'status')
  })

  it('keeps the button live when the phone lost the server, so pressing it retries', () => {
    const last = { reason: 'offline' as const, entryId: null, currentIndex: null, at: 1 }
    assert.equal(actionBar(input({ last })).kind, 'retry')
  })

  it('refuses before the tap at YARG’s 500-song cap', () => {
    const full = state({ totalCount: 500 })
    assert.equal(actionBar(input({ state: full })).kind, 'disabled')
  })
})

// Imported here rather than above so this block merges apart from edits to the rest.
import { restorePlacement, upcomingOfYours } from './model'

describe('your songs in the panel', () => {
  const four = [entry(1), entry(2), entry(3), entry(4)]

  it('finds yours still to come, up now included and played left out', () => {
    const mine = new Set([1, 3, 4])
    assert.deepEqual(upcomingOfYours(state({ entries: four }), mine), [0, 2, 3])
    assert.deepEqual(upcomingOfYours(show(2, { entries: four }), mine), [2, 3])
    assert.deepEqual(upcomingOfYours(show(3, { entries: four }), new Set([1, 2])), [])
  })

  it('puts an undone removal back after its old neighbour, or at the start', () => {
    assert.deepEqual(restorePlacement(state({ entries: four }), 0), { position: 'start' })
    assert.deepEqual(restorePlacement(state({ entries: four }), 2), { position: 'after', anchorId: 2 })
    // Mid-show the neighbour can be the up-now song, which is still a place a move may land.
    assert.deepEqual(restorePlacement(show(1, { entries: four }), 2), { position: 'after', anchorId: 2 })
  })

  it('gives up on a neighbour YARG sent without an ID', () => {
    const anonymous = { ...entry(1), id: null }
    assert.equal(restorePlacement(state({ entries: [anonymous, entry(2)] }), 1), null)
  })
})
