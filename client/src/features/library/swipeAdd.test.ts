import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  COMMIT_AT,
  RESIST_MAX,
  SLOP,
  handOffRefusal,
  swipeAxis,
  swipeCommits,
  swipeOffset,
  takeRefusal,
} from './swipeAdd'

describe('swipe axis', () => {
  it('waits until the finger has gone somewhere', () => {
    assert.equal(swipeAxis(SLOP - 1, 2), 'undecided')
  })

  it('leaves a flick with sideways drift to the scroller', () => {
    assert.equal(swipeAxis(12, 30), 'vertical')
    assert.equal(swipeAxis(15, 12), 'vertical')
  })

  it('takes a clearly rightward drag, and never a leftward one', () => {
    assert.equal(swipeAxis(30, 6), 'horizontal')
    assert.equal(swipeAxis(-30, 0), 'vertical')
  })
})

describe('swipe offset', () => {
  it('follows the finger one-to-one up to the commit point, then damps', () => {
    assert.equal(swipeOffset(COMMIT_AT, true), COMMIT_AT)
    const beyond = swipeOffset(COMMIT_AT + 100, true)
    assert.ok(beyond > COMMIT_AT && beyond < COMMIT_AT + 100)
  })

  it('only gives a little where adding would not work', () => {
    assert.equal(swipeOffset(1000, false), RESIST_MAX)
    assert.equal(swipeCommits(1000, false), false)
  })

  it('commits from the threshold on', () => {
    assert.equal(swipeCommits(COMMIT_AT - 1, true), false)
    assert.equal(swipeCommits(COMMIT_AT, true), true)
  })
})

describe('refusal hand-off', () => {
  const last = { reason: 'incompatible' as const, entryId: null, currentIndex: 2, at: 1_000 }

  it('is read once', () => {
    handOffRefusal('A', last)
    assert.deepEqual(takeRefusal('A', 2_000), last)
    assert.equal(takeRefusal('A', 2_000), null)
  })

  it('expires if nobody opened the song for it', () => {
    handOffRefusal('B', last)
    assert.equal(takeRefusal('B', 60_000), null)
  })
})
