/**
 * Setlist socket frames built by hand, for the tests.
 *
 * Laid out as YARG's `SetlistProtocol.cs` writes them (`WriteSnapshot`,
 * `WriteServerHello`), so the tests pin the offsets: if YARG moves a field,
 * what these build and what the decoder reads stop agreeing. A capture from a
 * running YARG would be a better fixture, and should join these once there is
 * one.
 *
 * Its own module rather than exports of a test file, because importing a test
 * file runs its tests a second time.
 */

import { FrameType } from './setlistProtocol.js'

export const FIXTURE_HASH = '0123456789ABCDEF0123456789ABCDEF01234567'

export interface EntryFields {
  /** Written in version 2 only. Defaults to the entry's position, from 1. */
  id?: number
  hash?: string
  lengthMs?: number
  title?: string
  artist?: string
  album?: string
}

export interface SnapshotFields {
  active?: boolean
  showInProgress?: boolean
  truncated?: boolean
  revision?: number
  currentIndex?: number
  totalCount?: number
  entries?: EntryFields[]
}

function string(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(2)
  length.writeUInt16LE(bytes.length)
  return Buffer.concat([length, bytes])
}

/** A whole Snapshot frame, header included, in the layout of `version`. */
export function snapshotFrame(fields: SnapshotFields = {}, version = 1): Buffer {
  const entries = (fields.entries ?? []).map((entry, index) => {
    const fixed = Buffer.alloc(24)
    Buffer.from(entry.hash ?? FIXTURE_HASH, 'hex').copy(fixed, 0)
    fixed.writeUInt32LE(entry.lengthMs ?? 180_000, 20)

    const id = Buffer.alloc(4)
    id.writeUInt32LE(entry.id ?? index + 1)

    return Buffer.concat([
      ...(version >= 2 ? [id] : []),
      fixed,
      string(entry.title ?? 'Song'),
      string(entry.artist ?? 'Artist'),
      string(entry.album ?? 'Album'),
    ])
  })

  const headerBytes = version >= 2 ? 22 : 18
  const header = Buffer.alloc(5 + headerBytes)
  const payloadLength = headerBytes + entries.reduce((sum, entry) => sum + entry.length, 0)
  header.writeUInt32LE(payloadLength, 0)
  header.writeUInt8(FrameType.Snapshot, 4)
  header.writeUInt8(fields.active === false ? 0 : 1, 5)
  header.writeUInt8((fields.showInProgress ? 1 : 0) | (fields.truncated ? 2 : 0), 6)
  header.writeUInt32LE(fields.revision ?? 1, 7)
  header.writeInt32LE(fields.currentIndex ?? -1, 11)
  header.writeUInt32LE(fields.totalCount ?? entries.length, 15)
  header.writeUInt32LE(entries.length, 19)
  // `currentEntryId`, which YASS doesn't read: `currentIndex` says the same.
  if (version >= 2) header.writeUInt32LE(0, 23)

  return Buffer.concat([header, ...entries])
}

/** A version 2 Result frame. Statuses by wire number — see `RESULT_STATUSES`. */
export function resultFrame(requestId: number, status: number, entryId: number, revision: number): Buffer {
  const frame = Buffer.alloc(5 + 13)
  frame.writeUInt32LE(13, 0)
  frame.writeUInt8(FrameType.Result, 4)
  frame.writeUInt32LE(requestId, 5)
  frame.writeUInt8(status, 9)
  frame.writeUInt32LE(entryId, 10)
  frame.writeUInt32LE(revision, 14)
  return frame
}

/** YARG's 17-byte hello. A refusal carries version 0, as YARG's does. */
export function serverHello(status = 0, version = status === 0 ? 1 : 0, nonce = 42n): Buffer {
  const hello = Buffer.alloc(17)
  hello.write('YSET', 0, 'ascii')
  hello.writeUInt16LE(version, 4)
  hello.writeUInt8(status, 6)
  hello.writeBigUInt64LE(nonce, 7)
  hello.writeUInt16LE(64, 15)
  return hello
}
