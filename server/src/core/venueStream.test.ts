/**
 * Venue packet parsing.
 *
 * Unlike the other core tests there is no captured fixture here: the source is
 * a UDP broadcast, not a file, and YARG only emits it when an experimental
 * setting is on. So these build datagrams by hand from the layout in
 * `venueStream.ts`.
 *
 * That makes this a test of the *offsets*, which is exactly what needs pinning.
 * Every field we read sits below byte 36, in the run of the packet that has not
 * moved since datagram version 3 — if a future YARG inserts a field up there,
 * this is what should fail.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseVenuePacket, stableBpm } from './venueStream.js'

const PACKET_BYTES = 51
const SCENE_GAMEPLAY = 2
const SCENE_MENU = 1

interface PacketFields {
  version?: number
  scene?: number
  paused?: number
  bpm?: number
  section?: number
  cue?: number
  grade?: number
}

/** A well-formed v5 datagram carrying the fields we care about. */
function packet(fields: PacketFields = {}): Buffer {
  const buffer = Buffer.alloc(PACKET_BYTES)
  buffer.writeUInt32LE(0x59415247, 0)
  buffer.writeUInt8(fields.version ?? 5, 4)
  buffer.writeUInt8(1, 5) // platform: Windows
  buffer.writeUInt8(fields.scene ?? SCENE_GAMEPLAY, 6)
  buffer.writeUInt8(fields.paused ?? 1, 7) // 1 = unpaused
  buffer.writeFloatLE(fields.bpm ?? 120, 9)
  buffer.writeUInt8(fields.section ?? 0, 13)
  buffer.writeUInt8(fields.cue ?? 0, 34)
  buffer.writeUInt8(fields.grade ?? 0, 35)
  return buffer
}

describe('venue packet parsing', () => {
  it('reads the cue, grade and section at their documented offsets', () => {
    // 26 = WarmAutomatic, 16 = Contrast_Red, 2 = Chorus.
    const state = parseVenuePacket(packet({ cue: 26, grade: 16, section: 2 }))

    assert.deepEqual(state, {
      streaming: true,
      cue: 'warmAutomatic',
      grade: 'contrastRed',
      section: 'chorus',
      bpm: 120,
    })
  })

  it('rounds the tempo so float noise cannot masquerade as a change', () => {
    // The wire value is a float sent 88 times a second; the client uses it to
    // pace a drift measured in seconds.
    assert.equal(parseVenuePacket(packet({ bpm: 139.99998 }))?.bpm, 140)
    assert.equal(parseVenuePacket(packet({ bpm: 0 }))?.bpm, null)
    assert.equal(parseVenuePacket(packet({ bpm: -1 }))?.bpm, null)
  })

  it('holds the tempo steady through the wobble a real chart produces', () => {
    // Captured from a live chart: YARG derives tempo from note timing, so the
    // reported value wanders a couple of BPM from packet to packet. Every one
    // of those is a state change unless it is absorbed, and a tempo that never
    // settles restarts the client's colour drift instead of pacing it.
    const wobble = [176, 177, 176, 178, 176, 181, 175, 177]
    const settled = wobble.reduce<number | null>((previous, next) => stableBpm(next, previous), 176)
    assert.equal(settled, 176)

    // The changes worth catching — a half-time drop, a section change — are
    // far larger than the wobble and still get through.
    assert.equal(stableBpm(88, 176), 88)
    assert.equal(stableBpm(140, 120), 140)
    // Nothing to compare against yet.
    assert.equal(stableBpm(140, null), 140)
    assert.equal(stableBpm(null, 140), null)
  })

  it("maps the section byte through YARG's two diverted cue values", () => {
    assert.equal(parseVenuePacket(packet({ section: 5 }))?.section, 'verse')
    assert.equal(parseVenuePacket(packet({ section: 2 }))?.section, 'chorus')
    // Anything else means the chart isn't telling us.
    assert.equal(parseVenuePacket(packet({ section: 0 }))?.section, null)
    assert.equal(parseVenuePacket(packet({ section: 19 }))?.section, null)
  })

  it('reports streaming but no lighting outside gameplay', () => {
    // The menu has cues of its own, and they describe a room nobody is in.
    const menu = parseVenuePacket(packet({ scene: SCENE_MENU, cue: 30 }))
    assert.deepEqual(menu, { streaming: true, cue: null, grade: null, section: null, bpm: null })

    const paused = parseVenuePacket(packet({ paused: 2, cue: 26 }))
    assert.deepEqual(paused, { streaming: true, cue: null, grade: null, section: null, bpm: null })
  })

  it('ignores traffic that is not a YARG datagram', () => {
    const foreign = Buffer.alloc(PACKET_BYTES)
    foreign.writeUInt32LE(0xdeadbeef, 0)
    assert.equal(parseVenuePacket(foreign), null)

    // The port is a broadcast; anything on the LAN can land on it.
    assert.equal(parseVenuePacket(Buffer.alloc(0)), null)
    assert.equal(parseVenuePacket(Buffer.alloc(46)), null)
  })

  it('refuses a datagram version whose offsets we have not checked', () => {
    // Reading byte 34 of an unknown layout would paint the banner a colour
    // derived from whatever happens to live there.
    assert.equal(parseVenuePacket(packet({ version: 6 })), null)
    assert.notEqual(parseVenuePacket(packet({ version: 3 })), null)
  })

  it('treats an unknown cue or grade value as no lighting rather than throwing', () => {
    // Still in gameplay, so the tempo is still real — only the lighting is
    // unreadable.
    const state = parseVenuePacket(packet({ cue: 200, grade: 200 }))
    assert.deepEqual(state, { streaming: true, cue: null, grade: null, section: null, bpm: 120 })
  })
})
