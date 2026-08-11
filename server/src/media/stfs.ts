/**
 * Reader for Xbox 360 STFS packages — YARG's `CON` format.
 *
 * **The file is `stfs.ts` and not `con.ts` for a Windows reason**, not a
 * stylistic one: `CON` is a reserved device name, and a file called `con.ts` is
 * unopenable by any tool going through the legacy path API — git among them,
 * which cannot add or check it out. The format's own name works better anyway.
 * The exported symbols keep `Con`, because that is what YARG calls these and
 * what the rest of this codebase joins against.
 *
 * A CON is a signed Xbox package holding a whole Rock Band song: the `.mid`,
 * a multitrack `.mogg`, and the album art as a DXT-compressed `.png_xbox`.
 * There are 618 of them in a library this size, averaging ~25 MB, and the point
 * of this file is to get a 250 KB texture out of one without reading the rest.
 *
 * That works because the layout is indexed rather than streamed: a header at a
 * fixed offset gives the file table's location, the table gives each file's
 * first block, and blocks are addressable arithmetic. Pulling one file's art
 * costs roughly six small reads plus the file table.
 *
 * ## Blocks, and the two ways a file occupies them
 *
 * Data starts at `0xC000` in 4 KB blocks, but the block *number* is not the
 * block *offset*: every 170 blocks the format interleaves one or two hash
 * tables, and how many depends on a bit pattern in the package's entry ID.
 * `calculateBlockLocation` is that translation, and it is the single piece of
 * arithmetic everything else here rests on — hence its own unit vectors.
 *
 * A file is then stored one of two ways, and **both are implemented on purpose**:
 *
 *  - **Contiguous** (the `0x40` flag): blocks run in order, so extraction is a
 *    handful of large sequential reads. Most packages, most of the time.
 *  - **Split**: each block's successor is recorded in the hash table that
 *    precedes its section, so extraction has to read a hash block per data
 *    block and follow the chain.
 *
 * Shipping only the contiguous path would have been tempting and wrong. A split
 * file read as though it were contiguous does not error — it returns the right
 * *number* of bytes, assembled in the wrong order. Silent corruption is a worse
 * failure than an unsupported one, and there is no way to notice it from here.
 *
 * Source: `YARG.Core/IO/ConHandler/{CONFile,CONFileListing,CONFileStream}.cs`.
 */

import { open, type FileHandle } from 'node:fs/promises'

const TAGS = ['CON ', 'LIVE', 'PIRS']

const METADATA_POSITION = 0x340
const FILETABLE_BLOCKCOUNT_POSITION = 0x37c
const FILETABLE_FIRSTBLOCK_POSITION = 0x37e

const FIRSTBLOCK_OFFSET = 0xc000
const BYTES_PER_BLOCK = 0x1000
const BLOCKS_PER_SECTION = 170
const BYTES_PER_SECTION = BLOCKS_PER_SECTION * BYTES_PER_BLOCK
const NUM_BLOCKS_SQUARED = BLOCKS_PER_SECTION * BLOCKS_PER_SECTION

const BYTES_PER_HASH_ENTRY = 0x18
const NEXT_BLOCK_HASH_OFFSET = 0x15

const SIZEOF_FILELISTING = 0x40

/** The `0x40` flag: this file's blocks run consecutively. */
const FLAG_CONSECUTIVE = 0x40
const FLAG_DIRECTORY = 0x80

export interface ConListing {
  /** Full path within the package, e.g. `songs/foo/foo.mid`. */
  name: string
  flags: number
  blockCount: number
  blockOffset: number
  pathIndex: number
  length: number
  shift: number
}

export const isContiguous = (listing: ConListing): boolean =>
  (listing.flags & FLAG_CONSECUTIVE) > 0

export const isDirectory = (listing: ConListing): boolean =>
  (listing.flags & FLAG_DIRECTORY) > 0

/**
 * Where block number `blockNum` actually sits in the file.
 *
 * The adjustment accounts for the hash tables the format interleaves: one every
 * 170 blocks, and another every 170² blocks. `shift` is 0 when the package
 * carries one hash table per section and 1 when it carries two — derived from
 * the entry ID at `0x340`, per the STFS documentation quoted in YARG's source.
 *
 * Exported because it is pure, total, and the thing most worth pinning: every
 * byte this module reads is placed by it.
 */
export function calculateBlockLocation(blockNum: number, shift: number): number {
  let blockAdjust = 0

  if (blockNum >= BLOCKS_PER_SECTION) {
    blockAdjust += (Math.floor(blockNum / BLOCKS_PER_SECTION) + 1) << shift
    if (blockNum >= NUM_BLOCKS_SQUARED) {
      blockAdjust += (Math.floor(blockNum / NUM_BLOCKS_SQUARED) + 1) << shift
    }
  }

  return FIRSTBLOCK_OFFSET + (blockAdjust + blockNum) * BYTES_PER_BLOCK
}

export interface ConPackage {
  listings: ConListing[]
  /** Extract one file whole. */
  read(listing: ConListing): Promise<Buffer>
  close(): Promise<void>
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  const { bytesRead } = await handle.read(buffer, 0, length, position)
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead)
}

/**
 * Parse the file table.
 *
 * Records are 64 bytes with **mixed endianness**, which is not a typo in this
 * file but a property of the format: the block count and offset are 24-bit
 * *little*-endian, while the path index and length are big-endian. The table
 * ends at the first record whose name begins with a zero byte.
 *
 * Names are relative to a parent named by `pathIndex`, which always refers to
 * an earlier record — so a single forward pass can resolve full paths.
 */
function parseListings(table: Buffer, shift: number): ConListing[] | null {
  const listings: ConListing[] = []

  for (let at = 0; at + SIZEOF_FILELISTING <= table.length; at += SIZEOF_FILELISTING) {
    if (table[at] === 0) break

    // Signed: -1 means "no parent", i.e. a root-level entry.
    const pathIndex = table.readInt16BE(at + 0x32)

    let root = ''
    if (pathIndex >= 0) {
      if (pathIndex >= listings.length) {
        // A forward or self reference. The table is built out of spec and every
        // path after this point would be a guess.
        return null
      }
      root = `${listings[pathIndex]!.name}/`
    }

    // The low 6 bits of 0x28 are the name length; the top two are the flags.
    const nameLength = table[at + 0x28]! & 0x3f
    const name = root + table.toString('utf8', at, at + nameLength)

    listings.push({
      name,
      flags: table[at + 0x28]! & 0xc0,
      blockCount: (table[at + 0x2b]! << 16) | (table[at + 0x2a]! << 8) | table[at + 0x29]!,
      blockOffset: (table[at + 0x31]! << 16) | (table[at + 0x30]! << 8) | table[at + 0x2f]!,
      pathIndex,
      length: table.readInt32BE(at + 0x34),
      shift,
    })
  }

  return listings
}

/** Read a file whose blocks run consecutively — a few large sequential reads. */
async function readContiguous(handle: FileHandle, listing: ConListing): Promise<Buffer> {
  const data = Buffer.allocUnsafe(listing.length)

  let currentBlock = listing.blockOffset
  let numBlocks = BLOCKS_PER_SECTION - (currentBlock % BLOCKS_PER_SECTION)
  let readSize = BYTES_PER_BLOCK * numBlocks
  let remaining = listing.length

  while (remaining > 0) {
    if (readSize > remaining) readSize = remaining

    const at = listing.length - remaining
    const { bytesRead } = await handle.read(
      data,
      at,
      readSize,
      calculateBlockLocation(currentBlock, listing.shift),
    )
    if (bytesRead !== readSize) throw new Error('CON contiguous block read came up short')

    remaining -= readSize
    currentBlock += numBlocks
    numBlocks = BLOCKS_PER_SECTION
    readSize = BYTES_PER_SECTION
  }

  return data
}

/**
 * Read a file whose blocks are scattered, following the hash chain.
 *
 * Each section is preceded by a hash block holding one 0x18-byte entry per data
 * block; three bytes at `+0x15` of the entry give the next block's number. So
 * every data block costs a second read of the hash block that indexes it.
 */
async function readSplit(handle: FileHandle, listing: ConListing): Promise<Buffer> {
  const data = Buffer.allocUnsafe(listing.length)
  let currentBlock = listing.blockOffset
  let written = 0

  for (let i = 0; i < listing.blockCount; i++) {
    const blockLocation = calculateBlockLocation(currentBlock, listing.shift)

    const isLast = i + 1 >= listing.blockCount
    const readCount = isLast ? listing.length - i * BYTES_PER_BLOCK : BYTES_PER_BLOCK
    if (readCount <= 0) break

    const { bytesRead } = await handle.read(data, written, readCount, blockLocation)
    if (bytesRead !== readCount) throw new Error('CON split block read came up short')
    written += readCount

    if (isLast) break

    const blockOffset = currentBlock % BLOCKS_PER_SECTION
    const hashLocation = blockLocation - (blockOffset + 1) * BYTES_PER_BLOCK
    if (hashLocation < 0) throw new Error('CON hash block would sit before the file')

    const hashBlock = await readAt(handle, hashLocation, BYTES_PER_BLOCK)
    if (hashBlock.length !== BYTES_PER_BLOCK) throw new Error('CON hash block read came up short')

    const next = blockOffset * BYTES_PER_HASH_ENTRY + NEXT_BLOCK_HASH_OFFSET
    currentBlock = (hashBlock[next]! << 16) | (hashBlock[next + 1]! << 8) | hashBlock[next + 2]!
  }

  return data
}

/**
 * Open a CON package and read its file table.
 *
 * Returns null for anything that isn't one — the fallback scanner uses exactly
 * this to decide whether an extension-less file in a song folder is a package
 * or a stray, so "not a CON" has to be an answer rather than an error.
 */
export async function openConPackage(path: string): Promise<ConPackage | null> {
  const handle = await open(path, 'r')

  try {
    const tag = await readAt(handle, 0, 4)
    if (tag.length < 4 || !TAGS.includes(tag.toString('latin1'))) {
      await handle.close()
      return null
    }

    // "If bit 12, 13 and 15 of the entry ID are on, there are 2 hash tables
    // every 0xAA blocks" — the STFS docs, via YARG.
    const entryIdBytes = await readAt(handle, METADATA_POSITION, 4)
    if (entryIdBytes.length < 4) {
      await handle.close()
      return null
    }
    const entryId = entryIdBytes.readInt32BE(0)
    const shift = (((entryId + 0xfff) & 0xf000) >> 0xc) !== 0xb ? 1 : 0

    const blockCountBytes = await readAt(handle, FILETABLE_BLOCKCOUNT_POSITION, 2)
    const firstBlockBytes = await readAt(handle, FILETABLE_FIRSTBLOCK_POSITION, 3)
    if (blockCountBytes.length < 2 || firstBlockBytes.length < 3) {
      await handle.close()
      return null
    }

    // Little-endian here, big-endian for the first block. As above: the format
    // genuinely mixes them.
    const tableLength = BYTES_PER_BLOCK * (blockCountBytes[0]! | (blockCountBytes[1]! << 8))
    const firstBlock =
      (firstBlockBytes[0]! << 16) | (firstBlockBytes[1]! << 8) | firstBlockBytes[2]!

    const table = await readAt(handle, calculateBlockLocation(firstBlock, shift), tableLength)
    const listings = parseListings(table, shift)
    if (listings === null) {
      await handle.close()
      return null
    }

    return {
      listings,
      read(listing: ConListing): Promise<Buffer> {
        if (listing.length <= 0) return Promise.resolve(Buffer.alloc(0))
        return isContiguous(listing) ? readContiguous(handle, listing) : readSplit(handle, listing)
      },
      close: () => handle.close(),
    }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** Find a listing by exact path, case-insensitively. */
export function findConListing(pkg: ConPackage, name: string): ConListing | null {
  const wanted = name.toLowerCase()
  return (
    pkg.listings.find((listing) => !isDirectory(listing) && listing.name.toLowerCase() === wanted) ??
    null
  )
}
