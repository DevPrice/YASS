/**
 * The YARG Setlist Socket Protocol, versions 1 and 2, as bytes.
 *
 * Pure encoding and decoding, kept apart from the socket so the layouts can be
 * pinned with hand-built buffers. The spec is the "YARG Setlist Socket
 * Protocol" document; where it and YARG disagree, YARG's `SetlistProtocol.cs`
 * wins, because that is what is on the other end of the connection.
 *
 * Little-endian throughout. Version 1 is read-only: YARG pushes whole
 * snapshots, and a client only ever acks them. Version 2 gives every entry a
 * stable ID and adds commands, each answered by a Result — and changes what an
 * ack means, from "I read revision N" to "I have read N bytes", because a
 * client now has results to acknowledge as well as snapshots.
 */

import { stripRichText } from './richtext.js'

export const MIN_PROTOCOL_VERSION = 1
export const MAX_PROTOCOL_VERSION = 2

const MAGIC = Buffer.from('YSET', 'ascii')

export const CLIENT_HELLO_BYTES = 8
export const SERVER_HELLO_BYTES = 17
export const FRAME_HEADER_BYTES = 5

/**
 * The largest frame we will buffer.
 *
 * YARG caps a snapshot at 64 KB, header included. This is sixteen times that,
 * which leaves room for a later version to grow without letting a length field
 * from anything that isn't YARG make us allocate whatever it claims.
 */
export const MAX_FRAME_BYTES = 1024 * 1024

const HASH_BYTES = 20
const SNAPSHOT_HEADER_BYTES_V1 = 18
const SNAPSHOT_HEADER_BYTES_V2 = 22
const RESULT_PAYLOAD_BYTES = 13

const FLAG_SHOW_IN_PROGRESS = 1 << 0

export const FrameType = {
  Snapshot: 0x01,
  Ack: 0x02,
  Result: 0x03,
  Command: 0x10,
  Error: 0x7f,
} as const

export const CommandOp = {
  Add: 1,
  Remove: 2,
  Move: 3,
  Clear: 4,
} as const

/** Where an add or a move puts its entry. `after` names an anchor entry by ID. */
export const Position = {
  End: 0,
  Start: 1,
  After: 2,
} as const

export type Position = (typeof Position)[keyof typeof Position]

/** A Result's status byte, by name. Index is the wire value. */
export const RESULT_STATUSES = [
  'ok',
  'inactive',
  'entryNotFound',
  'anchorNotFound',
  'songNotFound',
  'alreadyInSetlist',
  'locked',
  'full',
  'malformed',
  'incompatible',
] as const

export type ResultStatus = (typeof RESULT_STATUSES)[number]

export const HelloStatus = {
  Ok: 0,
  NoCommonVersion: 1,
  Busy: 2,
} as const

export type HelloStatus = (typeof HelloStatus)[keyof typeof HelloStatus]

export interface ServerHello {
  version: number
  status: HelloStatus | number
  /** A u64, kept as a bigint: it is compared, never added to. */
  sessionNonce: bigint
  maxClientFrame: number
}

export interface SnapshotEntry {
  /** Stable for a YARG run, and null before version 2. Restarts at 1 when YARG does. */
  id: number | null
  hash: string
  lengthMs: number
  title: string
  artist: string
  album: string
}

export interface Snapshot {
  active: boolean
  showInProgress: boolean
  revision: number
  /** -1 outside a show. */
  currentIndex: number
  totalCount: number
  entries: SnapshotEntry[]
}

export interface Result {
  requestId: number
  /** A status this build doesn't know arrives as its number. */
  status: ResultStatus | number
  /** The entry the command made or touched; for `alreadyInSetlist`, the one already there. 0 for none. */
  entryId: number
  /** The first snapshot revision that reflects the outcome. */
  revision: number
}

export class ProtocolError extends Error {}

export function encodeClientHello(minVersion: number, maxVersion: number): Buffer {
  const hello = Buffer.alloc(CLIENT_HELLO_BYTES)
  MAGIC.copy(hello, 0)
  hello.writeUInt16LE(minVersion, 4)
  hello.writeUInt16LE(maxVersion, 6)
  return hello
}

export function decodeServerHello(hello: Buffer): ServerHello {
  if (hello.length < SERVER_HELLO_BYTES || !hello.subarray(0, 4).equals(MAGIC)) {
    throw new ProtocolError('not a setlist socket hello')
  }

  return {
    version: hello.readUInt16LE(4),
    status: hello.readUInt8(6),
    sessionNonce: hello.readBigUInt64LE(7),
    maxClientFrame: hello.readUInt16LE(15),
  }
}

function frame(type: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(FRAME_HEADER_BYTES)
  header.writeUInt32LE(payload.length, 0)
  header.writeUInt8(type, 4)
  return Buffer.concat([header, payload])
}

/** Version 1: the revision of the snapshot just read. */
export function encodeAckV1(revision: number): Buffer {
  const payload = Buffer.alloc(4)
  payload.writeUInt32LE(revision)
  return frame(FrameType.Ack, payload)
}

/**
 * Version 2: every byte of every frame read since the server hello.
 *
 * YARG drops a client that claims more than it was sent, so this must only
 * ever count frames that were read whole.
 */
export function encodeAckV2(bytesRead: number): Buffer {
  const payload = Buffer.alloc(8)
  payload.writeBigUInt64LE(BigInt(bytesRead))
  return frame(FrameType.Ack, payload)
}

export type Command =
  | { op: 'add'; hash: string; position: Position; anchorId: number }
  | { op: 'remove'; entryId: number }
  | { op: 'move'; entryId: number; position: Position; anchorId: number }
  | { op: 'clear' }

export function encodeCommand(requestId: number, command: Command): Buffer {
  const head = Buffer.alloc(5)
  head.writeUInt32LE(requestId, 0)

  const u32 = (value: number) => {
    const bytes = Buffer.alloc(4)
    bytes.writeUInt32LE(value)
    return bytes
  }
  const place = (position: Position, anchorId: number) =>
    Buffer.concat([Buffer.from([position]), u32(anchorId)])

  let args: Buffer
  switch (command.op) {
    case 'add':
      head.writeUInt8(CommandOp.Add, 4)
      args = Buffer.concat([
        Buffer.from(command.hash, 'hex'),
        place(command.position, command.anchorId),
      ])
      break
    case 'remove':
      head.writeUInt8(CommandOp.Remove, 4)
      args = u32(command.entryId)
      break
    case 'move':
      head.writeUInt8(CommandOp.Move, 4)
      args = Buffer.concat([u32(command.entryId), place(command.position, command.anchorId)])
      break
    case 'clear':
      head.writeUInt8(CommandOp.Clear, 4)
      args = Buffer.alloc(0)
      break
  }

  return frame(FrameType.Command, Buffer.concat([head, args]))
}

export function decodeResult(payload: Buffer): Result {
  if (payload.length < RESULT_PAYLOAD_BYTES) {
    throw new ProtocolError('result shorter than its layout')
  }

  const status = payload.readUInt8(4)
  return {
    requestId: payload.readUInt32LE(0),
    status: RESULT_STATUSES[status] ?? status,
    entryId: payload.readUInt32LE(5),
    revision: payload.readUInt32LE(9),
  }
}

export interface Frame {
  type: number
  payload: Buffer
  /** Header and payload together: how far to advance past this frame. */
  size: number
}

/**
 * The frame at the front of `received`, or null when it hasn't all arrived.
 *
 * The length field counts the payload only — not itself, and not the type byte
 * that follows it.
 */
export function readFrame(received: Buffer): Frame | null {
  if (received.length < FRAME_HEADER_BYTES) return null

  const length = received.readUInt32LE(0)
  if (length > MAX_FRAME_BYTES) {
    throw new ProtocolError(`frame of ${length} bytes is larger than any YARG sends`)
  }

  const size = FRAME_HEADER_BYTES + length
  if (received.length < size) return null

  return {
    type: received.readUInt8(4),
    payload: received.subarray(FRAME_HEADER_BYTES, size),
    size,
  }
}

/**
 * A Snapshot frame's payload, in the layout of the negotiated `version`.
 * Throws `ProtocolError` on anything that doesn't add up.
 */
export function decodeSnapshot(payload: Buffer, version: number): Snapshot {
  const headerBytes = version >= 2 ? SNAPSHOT_HEADER_BYTES_V2 : SNAPSHOT_HEADER_BYTES_V1
  if (payload.length < headerBytes) {
    throw new ProtocolError('snapshot shorter than its header')
  }

  const flags = payload.readUInt8(1)
  const entryCount = payload.readUInt32LE(14)
  let offset = headerBytes

  const take = (bytes: number): number => {
    if (offset + bytes > payload.length) {
      throw new ProtocolError('snapshot ends inside an entry')
    }
    const at = offset
    offset += bytes
    return at
  }

  const readString = (): string => {
    const length = payload.readUInt16LE(take(2))
    const at = take(length)
    return stripRichText(payload.toString('utf8', at, at + length))
  }

  const entries: SnapshotEntry[] = []
  for (let i = 0; i < entryCount; i++) {
    const id = version >= 2 ? payload.readUInt32LE(take(4)) : null
    const hashAt = take(HASH_BYTES)
    const hash = payload.toString('hex', hashAt, hashAt + HASH_BYTES).toUpperCase()
    const lengthMs = payload.readUInt32LE(take(4))
    const title = readString()
    const artist = readString()
    const album = readString()
    entries.push({ id, hash, lengthMs, title, artist, album })
  }

  return {
    active: payload.readUInt8(0) === 1,
    showInProgress: (flags & FLAG_SHOW_IN_PROGRESS) !== 0,
    revision: payload.readUInt32LE(2),
    currentIndex: payload.readInt32LE(6),
    totalCount: payload.readUInt32LE(10),
    entries,
  }
}
