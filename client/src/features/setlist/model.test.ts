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
  badgeStanding,
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
  waitSeconds,
  wasCleared,
  whereWords,
  yourLine,
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

describe("when's mine", () => {
  // Five four-minute songs, the show on the second.
  const five = [entry(1, 240), entry(2, 240), entry(3, 240), entry(4, 240), entry(5, 240)]
  const during = show(1, { entries: five })

  it('counts the songs still to come, not the one already up', () => {
    // Up now is 2; 3 and 4 stand between it and 5.
    assert.equal(whereWords(during, 4), 'after 2 more songs, about 10 min')
    assert.equal(whereWords(during, 3), 'after 1 more song, about 6 min')
  })

  it('counts the up-now song as half, with no way to know how far in it is', () => {
    assert.equal(waitSeconds(during, 4), 120 + 240 + 240)
  })

  it('rounds a wait up rather than promise it sooner', () => {
    const odd = show(0, { entries: [entry(1, 200), entry(2, 200), entry(3, 200)] })
    // 100 + 200 = 300 s is exactly 5 min; one second more is 6.
    assert.equal(whereWords(odd, 2), 'after 1 more song, about 5 min')
    const over = show(0, { entries: [entry(1, 202), entry(2, 200), entry(3, 200)] })
    assert.equal(whereWords(over, 2), 'after 1 more song, about 6 min')
  })

  it('gives up next no time: the only song ahead is the one of unknown progress', () => {
    assert.equal(whereWords(during, 2), 'up next')
    assert.equal(whereWords(during, 1), 'up now')
    assert.equal(whereWords(during, 0), '1st in this show')
  })

  it('outside a show, counts everything before the song, from the start of the show', () => {
    const queued = state({ entries: five })
    assert.equal(waitSeconds(queued, 3), 720)
    assert.equal(whereWords(queued, 3), '4th, about 12 min into the show')
    assert.equal(whereWords(queued, 3, true), '4th in the setlist, about 12 min into the show')
    assert.equal(whereWords(queued, 0), '1st')
  })

  it('drops the time when any song ahead has no length, as the run time does', () => {
    const unknown = show(0, { entries: [entry(1), entry(2, null), entry(3), entry(4)] })
    assert.equal(whereWords(unknown, 3), 'after 2 more songs')
    assert.equal(waitSeconds(unknown, 3), null)
    // A song after yours doesn't matter.
    assert.equal(waitSeconds(show(0, { entries: [entry(1), entry(2), entry(3, null)] }), 2), 300)
  })

  describe('your line', () => {
    it('says where your next song is, with the wait', () => {
      assert.deepEqual(yourLine(during, new Set([5])), {
        text: 'Yours comes after 2 more songs, about 10 min.',
        index: 4,
      })
      assert.deepEqual(yourLine(during, new Set([3])), { text: 'Yours is up next.', index: 2 })
    })

    it('counts the ones still to come, and skips the played', () => {
      assert.deepEqual(yourLine(during, new Set([1, 4, 5])), {
        text: '2 of yours to come. The next comes after 1 more song, about 6 min.',
        index: 3,
      })
      assert.equal(yourLine(during, new Set([1])), null)
    })

    it('outside a show, numbers it', () => {
      assert.deepEqual(yourLine(state({ entries: five }), new Set([2, 4])), {
        text: '2 of yours. The next is 2nd, about 4 min into the show.',
        index: 1,
      })
    })

    it('says nothing from a stale setlist', () => {
      assert.equal(yourLine(state({ entries: five, active: false }), new Set([2])), null)
    })
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
    pending: null,
    last: null,
    playing: false,
    ...overrides,
  })

  it('offers the add, and says where it will go and roughly when', () => {
    assert.deepEqual(actionBar(input()), {
      kind: 'add',
      lead: null,
      caption: 'Goes at the end, after 3 songs, about 10 min into the show.',
    })
    const empty = actionBar(input({ state: state({ entries: [] }) }))
    assert.equal(empty.kind === 'add' && empty.caption, 'Goes first in the setlist.')
  })

  it('in a show, counts only the songs after the one up now', () => {
    const bar = actionBar(input({ state: show(0, { entries: [entry(1, 240), entry(2, 240), entry(3, 240)] }) }))
    assert.equal(bar.kind === 'add' && bar.caption, 'Goes at the end, after 2 more songs, about 10 min.')

    const last = actionBar(input({ state: show(2) }))
    assert.equal(last.kind === 'add' && last.caption, 'Goes at the end, up next.')

    const unknown = actionBar(input({ state: show(0, { entries: [entry(1), entry(2, null)] }) }))
    assert.equal(unknown.kind === 'add' && unknown.caption, 'Goes at the end, after 1 more song.')
  })

  it('says when adding will work before anyone taps, while YARG is not sharing', () => {
    // The requirement this bar exists for — as one line, not a dead button.
    assert.deepEqual(actionBar(input({ state: state({ active: false }) })), {
      kind: 'closed',
      text: 'Adding opens when the host is back at the song list.',
    })
    assert.equal(actionBar(input({ state: state({ link: 'unreachable', active: false }) })).kind, 'closed')
  })

  it('says the same after a tap YARG refused for being out of view', () => {
    const last = { reason: 'inactive' as const, entryId: null, currentIndex: null }
    assert.equal(actionBar(input({ last, state: state({ active: false }) })).kind, 'closed')
  })

  it('draws nothing against a YARG that can only be followed', () => {
    assert.deepEqual(actionBar(input({ state: state({ guestEdits: 'unsupported' }) })), {
      kind: 'hidden',
    })
  })

  it('says the host turned it off, before the tap', () => {
    const bar = actionBar(input({ state: state({ guestEdits: 'off' }) }))
    assert.equal(bar.kind === 'closed' && bar.text, 'The host has turned off setlist changes for guests.')
  })

  it("offers remove on yours, and only status on someone else's", () => {
    assert.deepEqual(actionBar(input({ hash: hash(2), mine: new Set([2]) })), {
      kind: 'yours',
      entryId: 2,
      where: '· 2nd, about 4 min into the show',
    })
    assert.deepEqual(actionBar(input({ hash: hash(2) })), {
      kind: 'status',
      lead: 'In the setlist',
      where: '· 2nd, about 4 min into the show',
    })
  })

  it('says yours later in a show as songs still to come, with the wait', () => {
    const during = show(0, { entries: [entry(1, 240), entry(2, 240), entry(3, 240), entry(9, 240)] })
    assert.deepEqual(actionBar(input({ state: during, mine: new Set([9]) })), {
      kind: 'yours',
      entryId: 9,
      where: '· after 2 more songs, about 10 min',
    })
  })

  it('offers undo right after an add, and says where it went', () => {
    const last = { reason: 'ok' as const, entryId: 2, currentIndex: null }
    assert.deepEqual(actionBar(input({ hash: hash(2), mine: new Set([2]), last })), {
      kind: 'added',
      entryId: 2,
      where: '2nd in the setlist, about 4 min into the show.',
    })
  })

  it('says only where it is when someone else added it first', () => {
    const last = { reason: 'alreadyInSetlist' as const, entryId: 3, currentIndex: null }
    assert.deepEqual(actionBar(input({ hash: hash(3), last })), actionBar(input({ hash: hash(3) })))
  })

  it("says up now only when the banner isn't already saying it's playing", () => {
    const during = show(1)
    assert.deepEqual(actionBar(input({ state: during, hash: hash(2) })), {
      kind: 'status',
      lead: 'In the setlist',
      where: '· up now',
    })
    assert.deepEqual(actionBar(input({ state: during, hash: hash(2), playing: true })), {
      kind: 'status',
      lead: 'In the setlist',
      where: null,
    })
    assert.equal(actionBar(input({ state: during, hash: hash(2), mine: new Set([2]) })).kind, 'status')
  })

  it('reports a tap made while parts are picked, and leaves the button live with no timer', () => {
    const last = { reason: 'locked' as const, entryId: null, currentIndex: 0 }
    assert.deepEqual(actionBar(input({ last, state: show(0) })), {
      kind: 'add',
      lead: 'Not added:',
      caption: 'wait for the first song to start, then add.',
    })
    const moved = actionBar(input({ last, state: show(1) }))
    assert.equal(moved.kind === 'add' && moved.lead, null)
  })

  it('keeps an incompatible song refused until the show moves on', () => {
    const last = { reason: 'incompatible' as const, entryId: null, currentIndex: 0 }
    assert.deepEqual(actionBar(input({ last, state: show(0) })), {
      kind: 'refused',
      lead: 'Not added:',
      caption: "it's missing an instrument someone in this show is playing.",
    })
    assert.equal(actionBar(input({ last, state: show(1) })).kind, 'add')
  })

  it('names no cause for a song YARG cannot find', () => {
    const last = { reason: 'songNotFound' as const, entryId: null, currentIndex: null }
    assert.deepEqual(actionBar(input({ last })), {
      kind: 'refused',
      lead: 'Not added:',
      caption: "the host's game won't play this one.",
    })
  })

  it("says it couldn't confirm when either connection dropped, and keeps the button live", () => {
    const expected = { kind: 'add', lead: "Couldn't confirm.", caption: 'Check the setlist.' }
    for (const reason of ['offline', 'connectionLost'] as const) {
      const last = { reason, entryId: null, currentIndex: null }
      assert.deepEqual(actionBar(input({ last })), expected)
      // It went in after all: the setlist says so, and the bar follows it.
      const wentIn = actionBar(input({ last, state: state({ entries: [entry(1), entry(9)] }) }))
      assert.equal(wentIn.kind, 'status')
    }
  })

  it('says which action is in flight', () => {
    assert.deepEqual(actionBar(input({ pending: 'add' })), { kind: 'busy', label: 'adding…' })
    assert.deepEqual(actionBar(input({ pending: 'remove' })), { kind: 'busy', label: 'removing…' })
  })

  it('refuses before the tap at YARG’s 500-song cap', () => {
    const full = state({ totalCount: 500 })
    assert.equal(actionBar(input({ state: full })).kind, 'refused')
  })
})

describe('the position badge', () => {
  const during = show(1, { guestEdits: 'unsupported' })

  it('stays out of the way wherever the action bar says it instead', () => {
    assert.equal(badgeStanding(show(1), hash(3), false), null)
  })

  it('stands in for the bar against a YARG that can only be followed', () => {
    assert.deepEqual(badgeStanding(during, hash(3), false), { kind: 'upNext' })
    assert.deepEqual(badgeStanding(during, hash(2), false), { kind: 'upNow' })
  })

  it('gives way to Now playing when the banner names the up-now song', () => {
    assert.equal(badgeStanding(during, hash(2), true), null)
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
