import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Setlist, Song } from '@shared/types'
import { summarizeSetlist } from './setlist'

const A = '52302429C0ACBCD1612B144FCCB3565BB2C20109'
const B = '33D3D0D05A9D7C1D2E9A2FE59C23EDCB370A6A29'
const C = 'B0A8886C85ABB42D4511F811C7D580CBEE161608'

const songs = new Map<string, Song>([
  ['a', { id: 'a', name: 'First', artist: 'Band' } as Song],
  ['b', { id: 'b', name: 'Second', artist: 'Band' } as Song],
])

const setlist = (patch: Partial<Setlist>): Setlist => ({
  available: true,
  mode: 'playing',
  index: 0,
  songs: [
    { hash: A, libraryId: 'a' },
    { hash: B, libraryId: 'b' },
    { hash: C, libraryId: null },
  ],
  updatedAt: 1,
  ...patch,
})

describe('summarizeSetlist', () => {
  it('says nothing without the plugin, or without a setlist', () => {
    assert.equal(summarizeSetlist(setlist({ available: false }), songs), null)
    assert.equal(summarizeSetlist(setlist({ mode: 'idle', index: null, songs: [] }), songs), null)
  })

  it('counts a setlist that has not started', () => {
    assert.deepEqual(summarizeSetlist(setlist({ mode: 'building', index: null }), songs), {
      mode: 'building',
      position: null,
      total: 3,
      next: null,
      isLast: false,
    })
  })

  it('names the next song from the library', () => {
    assert.deepEqual(summarizeSetlist(setlist({ index: 0 }), songs), {
      mode: 'playing',
      position: 1,
      total: 3,
      next: 'Second',
      isLast: false,
    })
  })

  it('tells an unknown next song apart from the end of the set', () => {
    const unknown = summarizeSetlist(setlist({ index: 1 }), songs)
    assert.equal(unknown?.next, null)
    assert.equal(unknown?.isLast, false)

    const last = summarizeSetlist(setlist({ index: 2 }), songs)
    assert.equal(last?.next, null)
    assert.equal(last?.isLast, true)
    assert.equal(last?.position, 3)
  })
})
