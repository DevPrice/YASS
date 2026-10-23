/**
 * The rules for editing YARG's setlist from a phone, against a stand-in for
 * the connection: these are about who may do what, not about bytes.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SetlistEntry } from '@shared/types.js'
import { Setlist, type SetlistConnection } from './setlist.js'
import { SetlistConnectionLostError, type SetlistFeed } from './setlistClient.js'
import type { Command, Result } from './setlistProtocol.js'

const SONG_A = 'A'.repeat(40)
const SONG_B = 'B'.repeat(40)
const ALICE = 'alice-browser-token-0001'
const BOB = 'bob-browser-token-000002'

const entry = (id: number, hash: string): SetlistEntry => ({
  id,
  hash,
  name: 'Song',
  artist: 'Artist',
  album: 'Album',
  lengthSeconds: 200,
})

function feed(entries: SetlistEntry[], overrides: Partial<SetlistFeed> = {}): SetlistFeed {
  return {
    link: 'connected',
    version: 2,
    active: true,
    showInProgress: false,
    currentIndex: null,
    totalCount: entries.length,
    entries,
    complete: true,
    updatedAt: 0,
    ...overrides,
  }
}

/** A connection that answers every command with the next queued result. */
function stubConnection(initial: SetlistFeed) {
  const listeners = new Set<(feed: SetlistFeed) => void>()
  const sent: Command[] = []
  const answers: Array<Partial<Result> | Error> = []

  let current = initial

  const connection: SetlistConnection & {
    /** Replace the feed without telling anyone, as a stale read would see it. */
    set(next: SetlistFeed): void
    push(next: SetlistFeed): void
    answer(next: Partial<Result> | Error): void
    sent: Command[]
  } = {
    get current() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async send(command) {
      sent.push(command)
      const next = answers.shift() ?? {}
      if (next instanceof Error) throw next
      return { requestId: 1, status: 'ok', entryId: 0, revision: 1, ...next }
    },
    set(next) {
      current = next
    },
    push(next) {
      current = next
      for (const listener of listeners) listener(next)
    },
    answer(next) {
      answers.push(next)
    },
    sent,
  }

  return connection
}

function setup(entries: SetlistEntry[] = [], allowed = true) {
  const connection = stubConnection(feed(entries))
  let guestEdits = allowed
  const setlist = new Setlist(connection, () => guestEdits)
  return {
    connection,
    setlist,
    allow: (next: boolean) => (guestEdits = next),
  }
}

describe('editing the setlist from a phone', () => {
  it('lets anyone add, at the end, and remembers who did', async () => {
    const { connection, setlist } = setup()
    connection.answer({ entryId: 7 })

    assert.deepEqual(await setlist.add(ALICE, SONG_A), { ok: true, entryId: 7 })
    assert.deepEqual(connection.sent[0], { op: 'add', hash: SONG_A, position: 0, anchorId: 0 })

    connection.push(feed([entry(7, SONG_A)]))
    assert.deepEqual(await setlist.remove(ALICE, 7), { ok: true, entryId: 0 })
  })

  it("refuses to remove or move another browser's song", async () => {
    const { connection, setlist } = setup()
    connection.answer({ entryId: 7 })
    await setlist.add(ALICE, SONG_A)
    connection.push(feed([entry(7, SONG_A)]))

    const sentBefore = connection.sent.length
    assert.deepEqual(await setlist.remove(BOB, 7), { ok: false, reason: 'notYours', entryId: null })
    assert.deepEqual(await setlist.move(BOB, 7, { position: 'start' }), {
      ok: false,
      reason: 'notYours',
      entryId: null,
    })
    assert.equal(connection.sent.length, sentBefore, 'YARG was asked anyway')
  })

  it('treats songs nobody here added — the host’s — as nobody’s', async () => {
    const { setlist } = setup([entry(3, SONG_A)])
    assert.equal((await setlist.remove(ALICE, 3)).ok, false)
  })

  it('stops every edit when the host switches guests off', async () => {
    const { connection, setlist, allow } = setup()
    allow(false)

    assert.deepEqual(await setlist.add(ALICE, SONG_A), {
      ok: false,
      reason: 'editsOff',
      entryId: null,
    })
    assert.equal(connection.sent.length, 0)
    assert.equal(setlist.current.guestEdits, 'off')
  })

  it('forgets an ID that a restarted YARG has given to another song', async () => {
    // IDs start again at 1 when YARG restarts; the hash is what tells an old
    // entry 7 from a new one.
    const { connection, setlist } = setup()
    connection.answer({ entryId: 7 })
    await setlist.add(ALICE, SONG_A)

    // Set rather than pushed, so no prune runs: this is the check at edit time.
    connection.set(feed([entry(7, SONG_B)]))

    assert.deepEqual(await setlist.remove(ALICE, 7), {
      ok: false,
      reason: 'notYours',
      entryId: null,
    })
  })

  it('keeps ownership through an inactive spell, and drops it once the song is gone', async () => {
    const { connection, setlist } = setup()
    connection.answer({ entryId: 7 })
    await setlist.add(ALICE, SONG_A)

    // Difficulty Select for a single song: inactive, and no songs on the wire.
    connection.push(feed([], { active: false }))
    connection.push(feed([entry(7, SONG_A)]))
    assert.equal((await setlist.remove(ALICE, 7)).ok, true)

    connection.answer({ entryId: 8 })
    await setlist.add(ALICE, SONG_B)
    // The setlist was wiped after a show, then rebuilt without it.
    connection.push(feed([entry(9, SONG_A)]))
    assert.equal((await setlist.remove(ALICE, 8)).ok, false)
  })

  it("doesn't prune on a setlist too long to have been sent whole", async () => {
    const { connection, setlist } = setup()
    connection.answer({ entryId: 900 })
    await setlist.add(ALICE, SONG_A)

    connection.push(feed([entry(1, SONG_B)], { complete: false, totalCount: 900 }))
    assert.equal((await setlist.remove(ALICE, 900)).ok, true)
  })

  it("passes YARG's refusals through by name", async () => {
    const { connection, setlist } = setup()

    connection.answer({ status: 'alreadyInSetlist', entryId: 4 })
    assert.deepEqual(await setlist.add(ALICE, SONG_A), {
      ok: false,
      reason: 'alreadyInSetlist',
      entryId: 4,
    })

    connection.answer({ status: 'incompatible', entryId: 0 })
    assert.deepEqual(await setlist.add(ALICE, SONG_B), {
      ok: false,
      reason: 'incompatible',
      entryId: null,
    })

    // A refused add belongs to nobody.
    assert.equal((await setlist.remove(ALICE, 4)).ok, false)

    // Malformed is our bug, not the guest's business, and a newer status is
    // one this build can't word.
    connection.answer({ status: 'malformed' })
    assert.deepEqual(await setlist.add(ALICE, SONG_A), {
      ok: false,
      reason: 'failed',
      entryId: null,
    })
    connection.answer({ status: 42 })
    assert.deepEqual(await setlist.add(ALICE, SONG_A), {
      ok: false,
      reason: 'failed',
      entryId: null,
    })
  })

  it('says the outcome is unknown when the connection drops mid-command', async () => {
    const { connection, setlist } = setup()
    connection.answer(new SetlistConnectionLostError('gone'))
    assert.deepEqual(await setlist.add(ALICE, SONG_A), {
      ok: false,
      reason: 'connectionLost',
      entryId: null,
    })
  })

  it('names a YARG that can only be followed', async () => {
    const { connection, setlist } = setup()
    connection.push(feed([], { version: 1 }))

    assert.equal(setlist.current.guestEdits, 'unsupported')
    assert.equal((await setlist.add(ALICE, SONG_A)).ok, false)
  })

  it('never puts a guest token on the wire state', () => {
    const { setlist } = setup([entry(1, SONG_A)])
    assert.ok(!JSON.stringify(setlist.current).includes('token'))
    assert.deepEqual(Object.keys(setlist.current).sort(), [
      'active',
      'currentIndex',
      'entries',
      'guestEdits',
      'link',
      'seenAt',
      'showInProgress',
      'totalCount',
      'updatedAt',
    ])
  })
})

describe('the setlist phones are shown', () => {
  it('keeps the last active setlist while YARG is not sharing, stamped with when', () => {
    const { connection, setlist } = setup()
    assert.equal(setlist.current.seenAt, null)

    connection.push(feed([entry(1, SONG_A), entry(2, SONG_B)], { updatedAt: 1_000 }))
    connection.push(feed([], { active: false, updatedAt: 2_000 }))

    const state = setlist.current
    assert.equal(state.active, false)
    assert.equal(state.seenAt, 1_000)
    assert.deepEqual(
      state.entries.map((e) => e.id),
      [1, 2],
    )

    // And through YARG closing, too.
    connection.push(feed([], { link: 'unreachable', version: 0, active: false }))
    assert.equal(setlist.current.entries.length, 2)
  })

  it('shows an active setlist that came back empty as empty', () => {
    // Which is the one moment a phone may say "cleared".
    const { connection, setlist } = setup()
    connection.push(feed([entry(1, SONG_A)], { updatedAt: 1_000 }))
    connection.push(feed([], { active: false }))
    connection.push(feed([], { updatedAt: 3_000 }))

    assert.deepEqual(setlist.current.entries, [])
    assert.equal(setlist.current.seenAt, 3_000)
  })
})
