import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { canOfferGuestEdits, setlistLine, type SetlistSummary } from './setlistLine.js'

const setlist = (fields: Partial<SetlistSummary> = {}): SetlistSummary => ({
  link: 'connected',
  guestEdits: 'on',
  active: true,
  showInProgress: false,
  currentIndex: null,
  totalCount: 12,
  seenAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...fields,
})

const text = (summary: SetlistSummary) =>
  setlistLine(summary)
    .map((segment) => segment.text)
    .join('')

describe('the setlist line', () => {
  it('counts the songs while the host is in the library', () => {
    assert.equal(text(setlist()), "Following YARG's setlist · 12 songs")
    assert.equal(text(setlist({ totalCount: 1 })), "Following YARG's setlist · 1 song")
    assert.equal(text(setlist({ totalCount: 0 })), "Following YARG's setlist · empty")
  })

  it('counts the show position from one, out of the whole setlist', () => {
    const line = setlistLine(setlist({ showInProgress: true, currentIndex: 2 }))

    assert.equal(
      line.map((segment) => segment.text).join(''),
      "Following YARG's setlist · show, 3 of 12",
    )
    assert.deepEqual(
      line.filter((segment) => segment.tone === 'number').map((segment) => segment.text),
      ['3', '12'],
    )
  })

  it('says out of view rather than describing a setlist YARG is not showing', () => {
    // The fields still hold the last show; reading them would claim it is on.
    assert.equal(
      text(setlist({ active: false, showInProgress: true, currentIndex: 4 })),
      "Following YARG's setlist · out of view until you open the music library or start a show",
    )
  })

  it('names the YARG setting to turn on when sharing is off', () => {
    const line = setlistLine(setlist({ link: 'off' }))

    assert.equal(
      line.map((segment) => segment.text).join(''),
      'Setlist sharing is off. To show guests the setlist, turn on Enable setlist socket in YARG → Settings → Experimental.',
    )
    assert.deepEqual(
      line.filter((segment) => segment.tone === 'value').map((segment) => segment.text),
      ['Enable setlist socket'],
    )
  })

  it('offers no remedy for a YARG that is too old or not running', () => {
    assert.equal(
      text(setlist({ link: 'unsupported' })),
      'This build of YARG is too old to share its setlist.',
    )
    assert.equal(
      text(setlist({ link: 'unreachable' })),
      "Waiting for YARG's setlist · it connects while YARG is running",
    )
  })
})

describe('offering the guest-edits switch', () => {
  it('offers it while connected to a YARG that takes edits, whichever way it is set', () => {
    assert.equal(canOfferGuestEdits(setlist({ guestEdits: 'on' })), true)
    // Off is the switch's own state; hiding it then would leave no way back.
    assert.equal(canOfferGuestEdits(setlist({ guestEdits: 'off' })), true)
  })

  it('hides it from a YARG that can only be followed', () => {
    assert.equal(canOfferGuestEdits(setlist({ guestEdits: 'unsupported' })), false)
  })

  it('hides it whenever YARG is not connected', () => {
    for (const link of ['off', 'unreachable', 'unsupported'] as const) {
      assert.equal(canOfferGuestEdits(setlist({ link, guestEdits: 'on' })), false, link)
    }
  })
})
