/**
 * Setlist socket framing, against frames built from YARG's own layout — see
 * `setlistFrames.fixture.ts`.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  FIXTURE_HASH as HASH,
  resultFrame,
  serverHello,
  snapshotFrame,
} from './setlistFrames.fixture.js'
import {
  decodeResult,
  decodeServerHello,
  decodeSnapshot,
  encodeAck,
  encodeClientHello,
  encodeCommand,
  FrameType,
  MAX_FRAME_BYTES,
  Position,
  ProtocolError,
  readFrame,
} from './setlistProtocol.js'

const payloadOf = (frame: Buffer): Buffer => frame.subarray(5)

describe('setlist socket framing', () => {
  it('writes the 8-byte client hello', () => {
    assert.deepEqual([...encodeClientHello(1, 2)], [0x59, 0x53, 0x45, 0x54, 1, 0, 2, 0])
  })

  it('reads the 17-byte server hello', () => {
    assert.deepEqual(decodeServerHello(serverHello(0, 1, 0x0102030405060708n)), {
      version: 1,
      status: 0,
      sessionNonce: 0x0102030405060708n,
      maxClientFrame: 64,
    })
  })

  it('refuses a hello from something that is not YARG', () => {
    const http = Buffer.from('HTTP/1.1 400 Bad Request\r\n\r\n')
    assert.throws(() => decodeServerHello(http), ProtocolError)
  })

  it('writes an ack as the token it echoes', () => {
    // The length counts the payload, not the type byte.
    assert.deepEqual([...encodeAck(0x01020304)], [4, 0, 0, 0, 0x02, 4, 3, 2, 1])
  })

  it('decodes a version 1 snapshot in setlist order', () => {
    const snapshot = decodeSnapshot(
      payloadOf(
        snapshotFrame({
          revision: 7,
          token: 0xdeadbeef,
          showInProgress: true,
          currentIndex: 1,
          entries: [
            { title: 'First', artist: 'A', album: 'X', lengthMs: 200_500 },
            { hash: 'FFEEDDCCBBAA99887766554433221100FFEEDDCC', title: 'Second' },
          ],
        }),
      ),
      1,
    )

    assert.equal(snapshot.revision, 7)
    assert.equal(snapshot.token, 0xdeadbeef)
    assert.equal(snapshot.active, true)
    assert.equal(snapshot.showInProgress, true)
    assert.equal(snapshot.currentIndex, 1)
    assert.equal(snapshot.totalCount, 2)
    assert.deepEqual(snapshot.entries, [
      { id: null, hash: HASH, lengthMs: 200_500, title: 'First', artist: 'A', album: 'X' },
      {
        id: null,
        hash: 'FFEEDDCCBBAA99887766554433221100FFEEDDCC',
        lengthMs: 180_000,
        title: 'Second',
        artist: 'Artist',
        album: 'Album',
      },
    ])
  })

  it('reads the entry IDs and the longer header of version 2', () => {
    const snapshot = decodeSnapshot(
      payloadOf(
        snapshotFrame({ revision: 4, token: 0x0badf00d, entries: [{ id: 17 }, { id: 3, title: 'B' }] }, 2),
      ),
      2,
    )

    assert.equal(snapshot.revision, 4)
    assert.equal(snapshot.token, 0x0badf00d)
    assert.deepEqual(
      snapshot.entries.map((entry) => [entry.id, entry.hash, entry.title]),
      [
        [17, HASH, 'Song'],
        [3, HASH, 'B'],
      ],
    )
  })

  it('reads the hash in the canonical form the library is keyed on', () => {
    // YARG writes the raw `HashWrapper` bytes, the same twenty `songcache.bin`
    // stores, so hex of them is `Song.hash` with no reordering.
    const [entry] = decodeSnapshot(payloadOf(snapshotFrame({ entries: [{}] })), 1).entries
    assert.equal(entry?.hash, HASH)
  })

  it('reads an inactive snapshot as empty', () => {
    const snapshot = decodeSnapshot(payloadOf(snapshotFrame({ active: false })), 1)
    assert.equal(snapshot.active, false)
    assert.deepEqual(snapshot.entries, [])
    assert.equal(snapshot.currentIndex, -1)
  })

  it('keeps the full count when the setlist was cut short', () => {
    const snapshot = decodeSnapshot(
      payloadOf(snapshotFrame({ truncated: true, totalCount: 900, entries: [{}, {}] })),
      1,
    )
    assert.equal(snapshot.totalCount, 900)
    assert.equal(snapshot.entries.length, 2)
  })

  it('strips rich text and survives multi-byte titles', () => {
    // `Name.Original` is the string as authored, tags and all.
    const [entry] = decodeSnapshot(
      payloadOf(snapshotFrame({ entries: [{ title: '<color=#f00>Björk</color> 🎸' }] })),
      1,
    ).entries
    assert.equal(entry?.title, 'Björk 🎸')
  })

  it('refuses a snapshot that claims more entries than it carries', () => {
    const frame = snapshotFrame({ entries: [{}] })
    frame.writeUInt32LE(2, 19)
    assert.throws(() => decodeSnapshot(payloadOf(frame), 1), ProtocolError)
  })

  it('refuses a version 1 snapshot read as version 2', () => {
    // The layouts differ by four bytes a field, so mixing them up has to fail
    // loudly rather than produce titles out of hash bytes.
    const frame = snapshotFrame({ entries: [{}] }, 1)
    assert.throws(() => decodeSnapshot(payloadOf(frame), 2), ProtocolError)
  })

  it('waits for a frame that has not all arrived, then reads it whole', () => {
    const frame = snapshotFrame({ entries: [{}] })
    assert.equal(readFrame(frame.subarray(0, 3)), null)
    assert.equal(readFrame(frame.subarray(0, frame.length - 1)), null)

    const whole = readFrame(Buffer.concat([frame, Buffer.from([1, 2])]))
    assert.equal(whole?.type, FrameType.Snapshot)
    assert.equal(whole?.size, frame.length)
  })

  it('refuses a length no YARG would send rather than buffering it', () => {
    const header = Buffer.alloc(5)
    header.writeUInt32LE(MAX_FRAME_BYTES + 1, 0)
    assert.throws(() => readFrame(header), ProtocolError)
  })

  it('writes each command in the layout YARG reads', () => {
    // `TryReadCommand` checks every op's length exactly, so a byte out is a
    // `malformed` answer rather than a misread.
    const add = encodeCommand(9, { op: 'add', hash: HASH, position: Position.After, anchorId: 5 })
    assert.equal(add.readUInt32LE(0), 4 + 1 + 20 + 1 + 4)
    assert.equal(add.readUInt8(4), FrameType.Command)
    assert.equal(add.readUInt32LE(5), 9)
    assert.equal(add.readUInt8(9), 1)
    assert.equal(add.toString('hex', 10, 30).toUpperCase(), HASH)
    assert.equal(add.readUInt8(30), 2)
    assert.equal(add.readUInt32LE(31), 5)

    const remove = encodeCommand(10, { op: 'remove', entryId: 7 })
    assert.deepEqual([...remove.subarray(4)], [0x10, 10, 0, 0, 0, 2, 7, 0, 0, 0])

    const move = encodeCommand(11, { op: 'move', entryId: 7, position: Position.Start, anchorId: 0 })
    assert.equal(move.readUInt32LE(0), 4 + 1 + 4 + 1 + 4)
    assert.equal(move.readUInt8(9), 3)

    const clear = encodeCommand(12, { op: 'clear' })
    assert.equal(clear.readUInt32LE(0), 5)
    assert.equal(clear.readUInt8(9), 4)
  })

  it('reads a result, naming the statuses it knows', () => {
    assert.deepEqual(decodeResult(payloadOf(resultFrame(9, 5, 31, 12, 0xfeedface))), {
      requestId: 9,
      status: 'alreadyInSetlist',
      entryId: 31,
      revision: 12,
      token: 0xfeedface,
    })
    // A status from a newer YARG stays a number rather than being misnamed.
    assert.equal(decodeResult(payloadOf(resultFrame(1, 42, 0, 1))).status, 42)
  })
})
