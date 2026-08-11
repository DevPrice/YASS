/**
 * Reader for SNG packages — `*.sng` and, through `yargsong.ts`, `*.yargsong`.
 *
 * An SNG is a chart folder in a single file: the same `song.ini` keys, the same
 * `album.png` and `notes.mid` and stem audio, packed behind one header. YARG
 * treats the two as one entry type (`Sng`) and so does this.
 *
 * ## Layout
 *
 * ```
 *   "SNGPKG"                6 bytes
 *   uint32  version
 *   byte[16] keys           → the 256-byte mask
 *   int64   metadataLength  ─┐ length counts the uint64 that follows it
 *   uint64  pairCount        ├─ then `metadataLength - 8` bytes of key/value
 *   …pairs                  ─┘
 *   int64   listingLength   ─┐ same shape
 *   uint64  listingCount     ├─ then `listingLength - 8` bytes of file records
 *   …records                ─┘
 *   …file payloads, at the absolute offsets the records give
 * ```
 *
 * The header, the metadata block and the listing table are **plaintext**. Only
 * the file payloads are masked, and each one restarts the mask at its own first
 * byte: `plain[p] = cipher[p] ^ mask[p & 0xff]`, `p` counted from the start of
 * that listing rather than from the start of the file.
 *
 * That last point is the one worth stating twice, because YARG's implementation
 * hides it behind a vectorised loop that walks the mask in `Vector<byte>` strides
 * and then finishes the tail bytewise. The two halves are the same function of
 * `p % 256`; the vectorisation is a speed trick, not a different cipher.
 *
 * Metadata keys arrive with the same names `song.ini` uses, lowercased — so
 * `preview_start_time` here means what it means there, and `art.ts` and
 * `preview.ts` can ask both formats the same question.
 *
 * Source: `YARG.Core/IO/SngHandler/{SngFile,SngMask,SngFileStream}.cs`.
 */

import { openContainer, type ContainerSource } from './yargsong.js'

const SNGPKG = Buffer.from('SNGPKG', 'ascii')

const MASK_SIZE = 256
const NUM_KEYS = 16

/**
 * A guard on the two length-prefixed tables.
 *
 * They are read into memory whole, and the prefix is an `int64` out of a file
 * we are parsing rather than trusting. Real packages run to a few hundred KB of
 * listings; 64 MB is far past anything legitimate and far short of a problem.
 */
const MAX_TABLE_BYTES = 64 * 1024 * 1024

export interface SngListing {
  /** Absolute offset of the payload within the (decrypted) container. */
  position: number
  length: number
}

export interface SngPackage {
  version: number
  /** `song.ini`-style keys, lowercased, in the container's own order. */
  metadata: Map<string, string>
  /** Filenames lowercased, matching YARG's own listing dictionary. */
  listings: Map<string, SngListing>
  /** Decrypt and return one file's bytes. */
  readFile(listing: SngListing): Promise<Buffer>
  close(): Promise<void>
}

/** `mask[i] = keys[i % 16] ^ i`. */
function buildMask(keys: Buffer): Buffer {
  const mask = Buffer.allocUnsafe(MASK_SIZE)
  for (let i = 0; i < MASK_SIZE; i++) mask[i] = keys[i % NUM_KEYS]! ^ i
  return mask
}

/**
 * A forward-only cursor over a table already in memory.
 *
 * Deliberately separate from `cache.ts`'s cursor: that one reads .NET's
 * `BinaryWriter` conventions (LEB128 strings), this one reads fixed-width
 * lengths, and conflating them would mean one class with two personalities.
 */
class TableReader {
  #buf: Buffer
  #pos = 0

  constructor(buf: Buffer) {
    this.#buf = buf
  }

  get done(): boolean {
    return this.#pos >= this.#buf.length
  }

  #need(count: number): number {
    const at = this.#pos
    if (at + count > this.#buf.length) throw new Error('SNG table ended mid-record')
    this.#pos = at + count
    return at
  }

  u8(): number {
    return this.#buf.readUInt8(this.#need(1))
  }

  i32(): number {
    return this.#buf.readInt32LE(this.#need(4))
  }

  /**
   * A 64-bit little-endian value, as a JavaScript number.
   *
   * Offsets and sizes inside a container are comfortably inside 2^53, and a
   * `bigint` here would infect every arithmetic site downstream for no gain.
   * Anything that doesn't fit is corruption, and says so.
   */
  i64(): number {
    const at = this.#need(8)
    const value = this.#buf.readBigInt64LE(at)
    if (value > Number.MAX_SAFE_INTEGER || value < 0) {
      throw new Error(`SNG offset ${value} is out of range`)
    }
    return Number(value)
  }

  bytes(count: number): Buffer {
    const at = this.#need(count)
    return this.#buf.subarray(at, at + count)
  }
}

/**
 * Read an SNG's header and tables.
 *
 * Payloads are *not* read — the listing table is what callers want, and a
 * package is tens of megabytes of audio nobody has asked for yet.
 */
export async function openSngPackage(path: string): Promise<SngPackage | null> {
  const source = await openContainer(path)

  try {
    const header = await source.read(0, SNGPKG.length + 4 + NUM_KEYS)
    if (header.length < SNGPKG.length + 4 + NUM_KEYS) return closing(source)

    // The tag is only meaningful on a plain `.sng`. Behind the `.yargsong`
    // cipher these six bytes read `RB3CON`, and YARG deliberately doesn't look
    // at them — see `ContainerSource.wrapped`.
    if (!source.wrapped && !header.subarray(0, SNGPKG.length).equals(SNGPKG)) {
      return closing(source)
    }

    const version = header.readUInt32LE(SNGPKG.length)
    const mask = buildMask(header.subarray(SNGPKG.length + 4))

    let at = SNGPKG.length + 4 + NUM_KEYS

    const metadata = new Map<string, string>()
    at = await readBlock(source, at, (table, count) => {
      for (let i = 0; i < count; i++) {
        const key = table.bytes(table.i32()).toString('utf8')
        const value = table.bytes(table.i32()).toString('utf8')
        // Lowercased to match `song.ini` handling, where keys are
        // case-insensitive and charts are authored by many different tools.
        metadata.set(key.toLowerCase(), value)
      }
    })

    const listings = new Map<string, SngListing>()
    await readBlock(source, at, (table, count) => {
      for (let i = 0; i < count; i++) {
        const name = table.bytes(table.u8()).toString('utf8')
        // Length first, then position — the order YARG writes them in.
        const length = table.i64()
        const position = table.i64()
        listings.set(name.toLowerCase(), { position, length })
      }
    })

    return {
      version,
      metadata,
      listings,
      async readFile(listing: SngListing): Promise<Buffer> {
        const data = await source.read(listing.position, listing.length)
        for (let i = 0; i < data.length; i++) data[i] = data[i]! ^ mask[i & 0xff]!
        return data
      },
      close: () => source.close(),
    }
  } catch {
    // A container we cannot parse is a song without art or a preview, not a
    // reason to fail whatever asked. The caller falls back to the plate.
    return closing(source)
  }
}

async function closing(source: ContainerSource): Promise<null> {
  await source.close()
  return null
}

/**
 * Read one `int64 length` + `uint64 count` + payload block and hand the payload
 * to `consume`. Returns the offset just past the block.
 *
 * The stored length *includes* the 8-byte count that follows it, which is why
 * the payload is `length - 8` and not `length`.
 */
async function readBlock(
  source: ContainerSource,
  at: number,
  consume: (table: TableReader, count: number) => void,
): Promise<number> {
  const prefix = await source.read(at, 16)
  if (prefix.length < 16) throw new Error('SNG ended before a table header')

  const length = Number(prefix.readBigInt64LE(0))
  const count = Number(prefix.readBigUInt64LE(8))

  if (length < 8 || length > MAX_TABLE_BYTES) {
    throw new Error(`implausible SNG table length ${length}`)
  }

  const payload = await source.read(at + 16, length - 8)
  consume(new TableReader(payload), count)

  return at + 8 + length
}

/**
 * Find the first listing matching one of `names`, in the order given.
 *
 * Preference order is the caller's business — YARG's album-art order, its
 * chart-file order, its stem order — and it is always "first of this list that
 * exists", so it lives here once.
 */
export function findListing(
  pkg: SngPackage,
  names: readonly string[],
): { name: string; listing: SngListing } | null {
  for (const name of names) {
    const listing = pkg.listings.get(name.toLowerCase())
    if (listing !== undefined) return { name, listing }
  }

  return null
}
