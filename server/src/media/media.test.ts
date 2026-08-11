/**
 * Unit vectors for the binary formats.
 *
 * Every one of these is synthetic bytes checked against arithmetic taken from
 * YARG's source, and that is deliberate: the real inputs are `songcache.bin`,
 * which bakes in absolute paths carrying the user's Windows account name, and
 * a library of copyrighted charts. Neither can be committed.
 *
 * What can be committed is the *shape* — a LEB128 length, a mask, a block
 * address — and those are exactly the places where a wrong answer is silent.
 * A DXT decoder given the wrong header offsets does not crash; it returns
 * plausible garbage. A `.yargsong` key derived with 64-bit arithmetic instead
 * of 32-bit decrypts to noise that still has the right length.
 *
 * The integration pass that reads the real library lives in
 * `media.integration.test.ts` and is opt-in via an environment variable.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseSongCache, readLeb128, CacheFormatError, SUPPORTED_CACHE_VERSIONS } from './cache.js'
import { calculateBlockLocation } from './stfs.js'
import { decodeDxt, expectedPayloadBytes, readDxtHeader } from './dxt.js'
import { parseDta, findSongNode, readSongAudio, getNumbers } from './dta.js'
import { deriveYargSongKey, decipherYargSong } from './yargsong.js'
import { previewWindow, buildPanFilter } from './preview.js'
import { parseRange } from '../static.js'

// --- LEB128 ------------------------------------------------------------------

describe('LEB128 (.NET 7-bit encoded int)', () => {
  it('reads single-byte values', () => {
    assert.deepEqual(readLeb128(Buffer.from([0x00])), { value: 0, width: 1 })
    assert.deepEqual(readLeb128(Buffer.from([0x01])), { value: 1, width: 1 })
    assert.deepEqual(readLeb128(Buffer.from([0x7f])), { value: 127, width: 1 })
  })

  it('reads multi-byte values, low group first', () => {
    // 128 = 0b1000_0000 → continuation on the low group, then 1.
    assert.deepEqual(readLeb128(Buffer.from([0x80, 0x01])), { value: 128, width: 2 })
    assert.deepEqual(readLeb128(Buffer.from([0xff, 0x01])), { value: 255, width: 2 })
    assert.deepEqual(readLeb128(Buffer.from([0xe5, 0x8e, 0x26])), { value: 624_485, width: 3 })
  })

  it('reads the widest int32 .NET will write', () => {
    assert.deepEqual(readLeb128(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x07])), {
      value: 2_147_483_647,
      width: 5,
    })
  })

  it('refuses a run that never terminates', () => {
    // Six continuation bytes cannot be an int32, and reading on would walk into
    // the next field with no complaint.
    assert.throws(
      () => readLeb128(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80])),
      CacheFormatError,
    )
  })
})

// --- songcache.bin -----------------------------------------------------------

/** Encode a length the way .NET's `BinaryWriter` does. */
function leb128(value: number): Buffer {
  const bytes: number[] = []
  let remaining = value

  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80)
    remaining >>>= 7
  }
  bytes.push(remaining)

  return Buffer.from(bytes)
}

const dotnetString = (value: string): Buffer => {
  const utf8 = Buffer.from(value, 'utf8')
  return Buffer.concat([leb128(utf8.length), utf8])
}

const int32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32LE(value)
  return buffer
}

const int64 = (value: bigint): Buffer => {
  const buffer = Buffer.alloc(8)
  buffer.writeBigInt64LE(value)
  return buffer
}

/** `int32 length` followed by the payload — the cache's universal framing. */
const lengthPrefixed = (payload: Buffer): Buffer => Buffer.concat([int32(payload.length), payload])

/** A `CacheLoopable`: a count, then each item length-prefixed. */
const loopable = (items: Buffer[]): Buffer =>
  Buffer.concat([int32(items.length), ...items.map(lengthPrefixed)])

const HASH_A = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678'
const HASH_B = '00112233445566778899AABBCCDDEEFF00112233'

/**
 * A minimal but structurally faithful cache file.
 *
 * Built from the *writer's* order in `CacheHandler.Serialize`, so this doubles
 * as an executable statement of the layout.
 */
function buildCacheFile(version: number): Buffer {
  const stringTable = lengthPrefixed(int32(0))
  const stringTables = Buffer.concat(Array.from({ length: 9 }, () => stringTable))

  const iniEntry = Buffer.concat([
    dotnetString('Some Artist - Some Song'),
    Buffer.from([0]), // chart format
    int64(0n), // chart last write
    Buffer.from([0]), // no song.ini timestamp
    Buffer.from(HASH_A, 'hex'),
    Buffer.from('metadata tail we never read'),
  ])

  const sngEntry = Buffer.concat([
    dotnetString('Packed.sng'),
    int64(0n),
    int32(1), // sng version
    Buffer.from([0]), // chart format
    Buffer.from(HASH_B, 'hex'),
  ])

  const iniGroup = Buffer.concat([
    dotnetString('C:\\charts'),
    loopable([iniEntry]),
    loopable([sngEntry]),
  ])

  const conEntry = Buffer.concat([
    dotnetString('dtanode'),
    Buffer.from([0]), // index byte
    dotnetString('shortname'),
    Buffer.from(HASH_A, 'hex'),
  ])

  const conGroup = Buffer.concat([
    dotnetString('C:\\packs\\pack_con'),
    int64(0n), // root last write
    int32(0), // PackedCONEntry
    loopable([conEntry]),
  ])

  return Buffer.concat([
    int32(version),
    Buffer.from([0]), // fullDirectoryPlaylists
    stringTables,
    loopable([]), // update directories
    loopable([]), // unpacked upgrades
    loopable([]), // packed upgrades
    loopable([iniGroup]),
    loopable([conGroup]),
  ])
}

describe('songcache.bin', () => {
  it('reads ini, sng and CON entries out of a well-formed file', () => {
    const { refs } = parseSongCache(buildCacheFile(SUPPORTED_CACHE_VERSIONS[0]!))

    assert.equal(refs.length, 3)

    assert.deepEqual(refs[0], {
      hash: HASH_A,
      format: 'Ini',
      // The group's base directory joined to the entry's relative path.
      path: 'C:\\charts\\Some Artist - Some Song',
    })

    assert.deepEqual(refs[1], {
      hash: HASH_B,
      format: 'Sng',
      path: 'C:\\charts\\Packed.sng',
    })

    assert.deepEqual(refs[2], {
      hash: HASH_A,
      format: 'CON',
      path: 'C:\\packs\\pack_con',
      subName: 'shortname',
      dtaName: 'dtanode',
    })
  })

  it('skips a metadata tail it does not understand', () => {
    // The ini entry above carries 27 bytes of trailing junk after its hash. The
    // whole premise of the parser is that the length prefix makes that safe.
    const { refs } = parseSongCache(buildCacheFile(SUPPORTED_CACHE_VERSIONS[0]!))
    assert.equal(refs[0]?.hash, HASH_A)
  })

  it('refuses a version it has not been checked against', () => {
    assert.throws(() => parseSongCache(buildCacheFile(19_990_101)), CacheFormatError)
  })

  it('accepts every version on the verified list', () => {
    for (const version of SUPPORTED_CACHE_VERSIONS) {
      const { refs, version: reported } = parseSongCache(buildCacheFile(version))
      assert.equal(reported, version)
      assert.equal(refs.length, 3)
    }
  })

  it('refuses a relative path that escapes its group directory', () => {
    const escaping = Buffer.concat([
      dotnetString('..\\..\\Windows\\System32'),
      Buffer.from([0]),
      int64(0n),
      Buffer.from([0]),
      Buffer.from(HASH_A, 'hex'),
    ])

    const group = Buffer.concat([
      dotnetString('C:\\charts'),
      loopable([escaping]),
      loopable([]),
    ])

    const file = Buffer.concat([
      int32(SUPPORTED_CACHE_VERSIONS[0]!),
      Buffer.from([0]),
      Buffer.concat(Array.from({ length: 9 }, () => lengthPrefixed(int32(0)))),
      loopable([]),
      loopable([]),
      loopable([]),
      loopable([group]),
      loopable([]),
    ])

    assert.deepEqual(parseSongCache(file).refs, [])
  })

  it('fails loudly rather than reading past the end of a truncated entry', () => {
    const truncated = buildCacheFile(SUPPORTED_CACHE_VERSIONS[0]!).subarray(0, 120)
    assert.throws(() => parseSongCache(truncated), CacheFormatError)
  })
})

// --- The SNG mask ------------------------------------------------------------

describe('SNG mask', () => {
  /** `mask[i] = keys[i % 16] ^ i` — `SngMask.LoadMask`. */
  function buildMask(keys: Buffer): Buffer {
    const mask = Buffer.alloc(256)
    for (let i = 0; i < 256; i++) mask[i] = keys[i % 16]! ^ i
    return mask
  }

  it('derives 256 bytes from 16 keys', () => {
    const keys = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 7 + 3))
    const mask = buildMask(keys)

    assert.equal(mask.length, 256)
    // Index 0 is the key untouched, because 0 XOR anything is that thing.
    assert.equal(mask[0], keys[0])
    assert.equal(mask[1], keys[1]! ^ 1)
    assert.equal(mask[16], keys[0]! ^ 16)
    assert.equal(mask[255], keys[15]! ^ 255)
  })

  it('round-trips a payload, with the mask restarting at each listing', () => {
    const keys = Buffer.from(Array.from({ length: 16 }, (_, i) => 0xa0 + i))
    const mask = buildMask(keys)

    const plain = Buffer.from('notes.mid contents, longer than the 256-byte mask '.repeat(8))
    const cipher = Buffer.from(plain)
    for (let i = 0; i < cipher.length; i++) cipher[i] = cipher[i]! ^ mask[i & 0xff]!

    assert.notDeepEqual(cipher, plain)

    const back = Buffer.from(cipher)
    for (let i = 0; i < back.length; i++) back[i] = back[i]! ^ mask[i & 0xff]!

    assert.deepEqual(back, plain)
  })
})

// --- The .yargsong cipher ----------------------------------------------------

describe('.yargsong key derivation', () => {
  const set = Buffer.from([3, 141, 59, 26, 53, 89, 79, 32, 38, 46, 26, 43, 38, 32, 79])

  it('is stable for a given seed and set', () => {
    const first = deriveYargSongKey(200, set)
    const second = deriveYargSongKey(200, set)

    assert.notEqual(first, null)
    assert.deepEqual(first, second)
  })

  it('produces different keys for different seeds', () => {
    const a = deriveYargSongKey(1, set)
    const b = deriveYargSongKey(2, set)

    assert.notEqual(a, null)
    assert.notEqual(b, null)
    assert.notDeepEqual(a, b)
  })

  it('keeps every value inside int32', () => {
    // The C# is `unchecked`, so the values wrap rather than growing. A JS number
    // that has drifted past 2^31 is the exact bug this file exists to prevent.
    for (const seed of [0, 1, 127, 128, 200, 251, 255]) {
      const key = deriveYargSongKey(seed, set)
      assert.notEqual(key, null, `seed ${seed}`)

      for (const value of [key!.a, key!.b, key!.c]) {
        assert.ok(Number.isInteger(value), `seed ${seed}: ${value} is not an integer`)
        assert.equal(value, value | 0, `seed ${seed}: ${value} escaped int32`)
      }
    }
  })

  it('matches the reference values from a real file header', () => {
    /*
     * Taken from an actual `.yargsong` in the YARG setlist: seed `0xFB` with
     * the fifteen bytes that follow it. The expected values were confirmed by
     * decrypting that file and finding a valid SNG package behind them.
     *
     * This is the vector that catches a 64-bit slip: the arithmetic overflows
     * several times on the way here, and any of those going unwrapped changes
     * `a`, `b` and `c` together.
     */
    const header = Buffer.from('4fd60f3ed859de6aebaf187f34bef2', 'hex')
    assert.deepEqual(deriveYargSongKey(0xfb, header), { a: 3451, b: -3211, c: 3115 })
  })

  it('round-trips a payload through the stream cipher', () => {
    const key = { a: 3451, b: -3211, c: 3115 }

    const plain = Buffer.from('SNGPKG\u0001\u0000\u0000\u0000 and then some payload bytes')
    const cipher = Buffer.from(plain)

    // Encrypting is the inverse of `decipherYargSong`: `(plain ^ a) + p*c + b`.
    for (let i = 0; i < cipher.length; i++) {
      cipher[i] = (((cipher[i]! ^ key.a) + Math.imul(i, key.c) + key.b) | 0) & 0xff
    }

    assert.deepEqual(decipherYargSong(Buffer.from(cipher), 0, key), plain)
  })

  it('is position-dependent, so a chunked read must pass its offset', () => {
    const key = { a: 11, b: -7, c: 5 }
    const bytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])

    // A fresh copy per call: `decipherYargSong` works in place, and a
    // `subarray` is a view — deciphering one would corrupt the others.
    const whole = decipherYargSong(Buffer.from(bytes), 0, key)
    const tailAtZero = decipherYargSong(Buffer.from(bytes.subarray(4)), 0, key)
    const tailAtFour = decipherYargSong(Buffer.from(bytes.subarray(4)), 4, key)

    // Deciphering the second half as though it were the first is the bug this
    // guards: same length, wrong bytes, no error anywhere.
    assert.notDeepEqual(tailAtZero, whole.subarray(4))
    assert.deepEqual(tailAtFour, whole.subarray(4))
  })

  it('declines a short cipher set rather than reading past it', () => {
    assert.equal(deriveYargSongKey(200, Buffer.from([1, 2, 3])), null)
  })
})

// --- STFS block addressing ---------------------------------------------------

describe('calculateBlockLocation', () => {
  const FIRST = 0xc000
  const BLOCK = 0x1000

  it('places the first blocks straight after the header', () => {
    assert.equal(calculateBlockLocation(0, 0), FIRST)
    assert.equal(calculateBlockLocation(1, 0), FIRST + BLOCK)
    assert.equal(calculateBlockLocation(169, 0), FIRST + 169 * BLOCK)
  })

  it('skips the hash blocks that precede each section', () => {
    /*
     * The adjustment is `(blockNum / 170) + 1` — a running count of the hash
     * blocks passed, not one per section boundary. At block 170 that is two,
     * which reads as off-by-one until you notice `0xC000` already accounts for
     * the tables in front of the *first* data block.
     *
     * Stated as literals rather than re-deriving the formula, so that a change
     * to the implementation has to be argued with rather than mirrored.
     */
    assert.equal(calculateBlockLocation(170, 0), FIRST + (170 + 2) * BLOCK)

    // `shift` 1 means two hash tables everywhere the entry ID says so, which
    // doubles the adjustment rather than adding to it.
    assert.equal(calculateBlockLocation(170, 1), FIRST + (170 + 4) * BLOCK)
  })

  it('adds a second skip at the 170-squared boundary', () => {
    const squared = 170 * 170

    // 171 level-one tables passed, plus 2 for the level-two boundary.
    assert.equal(calculateBlockLocation(squared, 0), FIRST + (squared + 171 + 2) * BLOCK)
    assert.equal(calculateBlockLocation(squared, 1), FIRST + (squared + 342 + 4) * BLOCK)
  })

  it('is monotonic, so the blocks of a file never address backwards', () => {
    let previous = -1
    for (const block of [0, 1, 169, 170, 171, 339, 340, 28_900, 28_901, 60_000]) {
      const location = calculateBlockLocation(block, 1)
      assert.ok(location > previous, `block ${block} went backwards`)
      previous = location
    }
  })
})

// --- .png_xbox ---------------------------------------------------------------

/** A synthetic `.png_xbox` header plus `payload` bytes. */
function dxtFile(width: number, height: number, dxt1: boolean, payload: Buffer): Buffer {
  const header = Buffer.alloc(32)
  header[1] = dxt1 ? 0x04 : 0x08
  header.writeInt32LE(dxt1 ? 0x08 : 0x00, 2)
  header.writeInt16LE(width, 7)
  header.writeInt16LE(height, 9)
  return Buffer.concat([header, payload])
}

describe('.png_xbox header', () => {
  it('reads the unaligned width and height', () => {
    assert.deepEqual(readDxtHeader(dxtFile(512, 256, false, Buffer.alloc(0))), {
      width: 512,
      height: 256,
      dxt1: false,
    })
  })

  it('calls it DXT1 only when both marker fields agree', () => {
    assert.equal(readDxtHeader(dxtFile(64, 64, true, Buffer.alloc(0)))?.dxt1, true)
    assert.equal(readDxtHeader(dxtFile(64, 64, false, Buffer.alloc(0)))?.dxt1, false)

    // Right bits-per-pixel, wrong format word: DXT5, per `TransferDXT`.
    const mixed = dxtFile(64, 64, true, Buffer.alloc(0))
    mixed.writeInt32LE(0x09, 2)
    assert.equal(readDxtHeader(mixed)?.dxt1, false)
  })

  it('computes the mip-0 payload size from the block count', () => {
    assert.equal(expectedPayloadBytes({ width: 256, height: 256, dxt1: true }), 64 * 64 * 8)
    assert.equal(expectedPayloadBytes({ width: 512, height: 512, dxt1: false }), 128 * 128 * 16)
    // Non-multiples of four round up to a whole block.
    assert.equal(expectedPayloadBytes({ width: 5, height: 5, dxt1: true }), 2 * 2 * 8)
  })

  it('declines a header that is too short or claims no size', () => {
    assert.equal(readDxtHeader(Buffer.alloc(8)), null)
    assert.equal(readDxtHeader(dxtFile(0, 64, true, Buffer.alloc(0))), null)
  })

  it('declines a payload too short for the size it claims', () => {
    assert.equal(decodeDxt(dxtFile(256, 256, true, Buffer.alloc(16))), null)
  })

  it('decodes a solid DXT1 block, undoing the Xbox byte order', () => {
    // One 4x4 block of pure red. 0xF800 is 5-6-5 red; the payload is written
    // byte-swapped because that is how the Xbox stores it.
    const block = Buffer.alloc(8)
    block.writeUInt16LE(0xf800, 0)
    block.writeUInt16LE(0xf800, 2)
    // Indices all zero: every texel takes colour 0.

    const swapped = Buffer.from(block)
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i]!
      swapped[i] = swapped[i + 1]!
      swapped[i + 1] = t
    }

    const image = decodeDxt(dxtFile(4, 4, true, swapped))
    assert.notEqual(image, null)
    assert.equal(image!.rgba.length, 4 * 4 * 4)

    for (let texel = 0; texel < 16; texel++) {
      const at = texel * 4
      assert.equal(image!.rgba[at], 255, 'red')
      assert.equal(image!.rgba[at + 1], 0, 'green')
      assert.equal(image!.rgba[at + 2], 0, 'blue')
      assert.equal(image!.rgba[at + 3], 255, 'alpha is opaque for DXT1')
    }
  })
})

// --- songs.dta ---------------------------------------------------------------

describe('songs.dta', () => {
  const sample = `
    ;a comment about the pack
    (betteroffalone
       (name "Better Off Alone")
       (song
         (name "songs/betteroffalone/betteroffalone")
         (pans (-1.0  1.0  -1.0 1.0))
         (vols (-0.5 -0.5   0.0 0.0))
         (crowd_channels (2 3))
       )
       (song_length 218400)
       (preview 89352 119352)
    )
    ('quoted-name'
       (song (name "songs/other/other"))
       (preview 1000 2000)
    )
  `

  it('finds a song by its plain shortname', () => {
    const node = findSongNode(parseDta(sample), 'betteroffalone')
    assert.notEqual(node, null)
  })

  it("finds a song whose name is written as a quoted symbol", () => {
    // Real packages write `'miku'`, and keeping the quotes in the token meant
    // those songs never matched their own subName.
    assert.notEqual(findSongNode(parseDta(sample), 'quoted-name'), null)
  })

  it('skips a leading byte-order mark', () => {
    assert.notEqual(findSongNode(parseDta(`\ufeff${sample}`), 'betteroffalone'), null)
  })

  it('reads the preview window, pans, vols and crowd channels', () => {
    const node = findSongNode(parseDta(sample), 'betteroffalone')!
    const audio = readSongAudio(node)

    assert.deepEqual(audio.preview, { start: 89352, end: 119352 })
    assert.deepEqual(audio.pans, [-1, 1, -1, 1])
    assert.deepEqual(audio.vols, [-0.5, -0.5, 0, 0])
    assert.deepEqual(audio.crowdChannels, [2, 3])
  })

  it('ignores comments, including ones that follow a value', () => {
    const withComments = '(song (preview 100 200) ;(preview 999 999)\n)'
    assert.deepEqual(getNumbers(parseDta(withComments)[0] as string[], 'preview'), [100, 200])
  })

  it('does not throw on an unterminated list', () => {
    assert.doesNotThrow(() => parseDta('(song (name "x"'))
  })

  it('does not throw on a stray closing paren', () => {
    assert.doesNotThrow(() => parseDta('))))(song)'))
  })
})

describe('mogg downmix', () => {
  it('places channels by constant power and applies the volume in dB', () => {
    const filter = buildPanFilter([-1, 1], [0, 0])
    assert.match(filter!, /^pan=stereo\|c0=/)
    // Hard left contributes only to c0, hard right only to c1.
    assert.match(filter!, /c0=1\.0000\*c0/)
    assert.match(filter!, /c1=1\.0000\*c1/)
  })

  it('leaves the crowd track out', () => {
    const filter = buildPanFilter([-1, 1, -1, 1], [0, 0, 0, 0], [2, 3])
    assert.ok(!filter!.includes('c2'), 'crowd channel 2 leaked into the mix')
    assert.ok(!filter!.includes('c3'), 'crowd channel 3 leaked into the mix')
  })

  it('has nothing to say about a mogg with no pan data', () => {
    assert.equal(buildPanFilter([], []), null)
  })
})

// --- The preview window ------------------------------------------------------

describe('previewWindow', () => {
  // Every branch of `PreviewContext.Create`, which is what decides whether a
  // preview starts where the charter meant it to.

  it('defaults to 0:20-0:50 when neither bound is usable', () => {
    assert.deepEqual(previewWindow({ startMs: -1, endMs: -1, lengthSeconds: 240 }), {
      start: 20,
      duration: 30,
    })
  })

  it('centres a 30s window in a song too short for 0:50', () => {
    assert.deepEqual(previewWindow({ startMs: -1, endMs: -1, lengthSeconds: 40 }), {
      start: 5,
      duration: 30,
    })
  })

  it('takes the whole song when it is shorter than 30s', () => {
    assert.deepEqual(previewWindow({ startMs: -1, endMs: -1, lengthSeconds: 22 }), {
      start: 0,
      duration: 22,
    })
  })

  it('honours a usable start, running 30s from it', () => {
    assert.deepEqual(previewWindow({ startMs: 60_000, endMs: -1, lengthSeconds: 240 }), {
      start: 60,
      duration: 30,
    })
  })

  it('honours an explicit start and end', () => {
    assert.deepEqual(previewWindow({ startMs: 89_352, endMs: 119_352, lengthSeconds: 218.4 }), {
      start: 89.352,
      duration: 30,
    })
  })

  it('clamps an end past the song to the song', () => {
    assert.deepEqual(previewWindow({ startMs: 230_000, endMs: 300_000, lengthSeconds: 240 }), {
      start: 230,
      duration: 10,
    })
  })

  it('substitutes 30s for an end that does not follow its start', () => {
    assert.deepEqual(previewWindow({ startMs: 60_000, endMs: 30_000, lengthSeconds: 240 }), {
      start: 60,
      duration: 30,
    })
  })

  it('backs up 30s from an end given on its own', () => {
    assert.deepEqual(previewWindow({ startMs: -1, endMs: 100_000, lengthSeconds: 240 }), {
      start: 70,
      duration: 30,
    })
  })

  it('does not back up past the start of the song', () => {
    assert.deepEqual(previewWindow({ startMs: -1, endMs: 10_000, lengthSeconds: 240 }), {
      start: 0,
      duration: 10,
    })
  })

  it('falls back to the default when the start is past the end of the song', () => {
    // A charter's typo — `preview_start_time` in samples rather than ms, say.
    assert.deepEqual(previewWindow({ startMs: 9_000_000, endMs: -1, lengthSeconds: 240 }), {
      start: 20,
      duration: 30,
    })
  })
})

// --- HTTP range --------------------------------------------------------------

describe('parseRange', () => {
  // iOS Safari will not play an <audio> source from a server that ignores
  // these, which makes this the difference between previews working on a phone
  // and not.

  it('ignores a request with no range', () => {
    assert.equal(parseRange(undefined, 1000), null)
    assert.equal(parseRange('', 1000), null)
  })

  it('reads a bounded range', () => {
    assert.deepEqual(parseRange('bytes=0-1023', 5000), { start: 0, end: 1023 })
    assert.deepEqual(parseRange('bytes=100-199', 5000), { start: 100, end: 199 })
  })

  it('reads an open-ended range as running to the last byte', () => {
    assert.deepEqual(parseRange('bytes=100-', 5000), { start: 100, end: 4999 })
  })

  it('reads a suffix range as the final N bytes', () => {
    assert.deepEqual(parseRange('bytes=-500', 5000), { start: 4500, end: 4999 })
    // Longer than the file: the whole file, not a negative offset.
    assert.deepEqual(parseRange('bytes=-9000', 5000), { start: 0, end: 4999 })
  })

  it('clamps an end past the file', () => {
    assert.deepEqual(parseRange('bytes=4000-9999', 5000), { start: 4000, end: 4999 })
  })

  it('reports a start past the file as unsatisfiable', () => {
    assert.equal(parseRange('bytes=5000-', 5000), 'unsatisfiable')
    assert.equal(parseRange('bytes=6000-7000', 5000), 'unsatisfiable')
  })

  it('reports a backwards range as unsatisfiable', () => {
    assert.equal(parseRange('bytes=900-100', 5000), 'unsatisfiable')
  })

  it('ignores a multi-range request rather than answering it wrongly', () => {
    // Legal, and would need a multipart body. No browser sends one for media
    // playback; answering with the whole file is a valid response.
    assert.equal(parseRange('bytes=0-99,200-299', 5000), null)
  })

  it('ignores a unit it does not speak', () => {
    assert.equal(parseRange('items=0-10', 5000), null)
  })
})
