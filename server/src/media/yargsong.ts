/**
 * The outer cipher on `*.yargsong` files.
 *
 * A `.yargsong` is an ordinary SNG package with one more layer wrapped around
 * it: a 24-byte header, then every byte of the rest run through a keystream
 * derived from that header. Strip the layer and `sng.ts` reads what is left
 * without knowing the difference.
 *
 * ## Reproducing the arithmetic exactly
 *
 * The key derivation is deliberately obfuscated — YARG's own source calls it
 * "the Crawford special number" and admits it is "a super dumbed down version
 * of the algorithm". It is all 32-bit signed `unchecked` integer arithmetic,
 * which is not what JavaScript numbers do, and the failure mode is silent: get
 * one overflow wrong and the file decrypts to noise rather than to an error.
 *
 * So every operation here is forced back into int32 — `Math.imul` for products,
 * `| 0` for sums, `& 0xff` for the byte casts. The derivation is exported on its
 * own as `deriveYargSongKey` so it can be pinned by a unit vector without a real
 * file, and there is an integration test against a real one.
 *
 * Two details that look like bugs and are not:
 *
 *  - `(x + 5) % 255` can produce a negative `x` in C#, whose `%` truncates
 *    toward zero exactly as JavaScript's does. We keep the sign rather than
 *    normalising it, because the sign is load-bearing for the `j` walk below.
 *  - `values[3]` is accumulated and never used. It is computed anyway: dropping
 *    it changes nothing today, and keeping it means this reads as a transcription
 *    of the original rather than an interpretation of it.
 *
 * Source: `YARG.Core/IO/YARGSongFileStream.cs`.
 */

import { open, type FileHandle } from 'node:fs/promises'

const SIGNATURE = Buffer.from('YARGSONG', 'ascii')

/** Signature (8) + seed (1) + cipher set (15). */
export const YARGSONG_HEADER_SIZE = 24
const SET_LENGTH = 15

/**
 * The three keystream values, from the seed byte and the 15-byte set.
 *
 * `a`, `b` and `c` are `_values[0..2]` in YARG. The fourth is computed and
 * discarded, as it is there.
 */
export interface YargSongKey {
  a: number
  b: number
  c: number
}

/**
 * Derive the keystream values from a `.yargsong` header.
 *
 * `seed` is the single byte after the signature; `set` is the 15 bytes after
 * that. Returns null when the walk would index outside the set, which cannot
 * happen for a file YARG itself wrote — C# would throw there, so a file that
 * gets us to that point is not one of ours.
 */
export function deriveYargSongKey(seed: number, set: Buffer): YargSongKey | null {
  if (set.length < SET_LENGTH) return null

  // Straight transcription. The names are YARG's.
  const z = (seed + 1679) | 0
  const w = (((z ^ 4) | 0) - ((z * 2) | 0)) | 0
  const n = ((Math.imul(25, w) | 0) - 5) | 0
  let x = (((w + ((z << 1) | 0)) | 0) ^ 4) | 0

  let l = Math.imul((n + 73) | 0, (n + 23) | 0) | 0
  l = (l - (((Math.imul(n, n) | 0) + (Math.imul(96, n) | 0)) | 0)) | 0
  x = (((((-l | 0) + n) | 0) + x) | 0) - (Math.imul(w, 25) | 0)
  x = x | 0

  // "Convert to byte again" — C#'s `%` truncates toward zero, and so does
  // JavaScript's, so a negative x survives as a negative x in both.
  x = ((x + 5) | 0) % 255

  const values = [0, 0, 0, 0]
  for (let i = 0, j = 0; i < 24; i++, j = (j + x) | 0) {
    const at = j % SET_LENGTH
    const other = ((j + 7001) | 0) % SET_LENGTH
    // C# would throw on a negative index here; we decline instead.
    if (at < 0 || other < 0) return null

    // The `& 0xff` is C#'s `(byte)` cast, and it applies to the sum *before* it
    // is accumulated. Parenthesised explicitly because JavaScript binds `+`
    // tighter than `&`, which would quietly truncate the running total instead.
    const term = ((((set[at]! + Math.imul(i, 3298)) | 0) + 88903) | 0) & 0xff
    values[0] = (values[0]! + term) | 0
    values[1] = (values[1]! - set[other]!) | 0
    values[2] = (values[2]! + set[at]!) | 0
    values[3] = (values[3]! + ((j << 2) | 0)) | 0
  }

  return { a: values[0]!, b: values[1]!, c: values[2]! }
}

/**
 * Decipher a run of bytes in place.
 *
 * `position` is the offset of `buffer[0]` within the *logical* stream — the
 * file offset minus the 24-byte header — because the keystream is a function of
 * absolute position, not of how a caller happened to chunk its reads.
 */
export function decipherYargSong(buffer: Buffer, position: number, key: YargSongKey): Buffer {
  const { a, b, c } = key

  for (let i = 0; i < buffer.length; i++) {
    const p = (position + i) | 0
    buffer[i] = (((buffer[i]! - Math.imul(p, c) - b) | 0) ^ a) & 0xff
  }

  return buffer
}

/**
 * Random access to a chart container, with the outer layer already peeled.
 *
 * The point of the abstraction: a `.sng` and a `.yargsong` differ by exactly
 * this, and nothing downstream should have to care which it has. Offsets are
 * into the logical (decrypted) stream in both cases.
 */
export interface ContainerSource {
  /** Total logical length in bytes. */
  readonly size: number
  /**
   * True when a `.yargsong` layer was removed to get here.
   *
   * Callers need this because the two cases do not agree on what the first six
   * bytes are. A plain `.sng` opens with the `SNGPKG` tag and YARG checks it; a
   * deciphered `.yargsong` opens with its own `RB3CON` tag, and YARG checks
   * nothing at all — it seeks straight past six bytes to the version field.
   * Requiring `SNGPKG` of both would reject every `.yargsong` there is.
   */
  readonly wrapped: boolean
  read(position: number, length: number): Promise<Buffer>
  close(): Promise<void>
}

class PlainSource implements ContainerSource {
  #handle: FileHandle
  readonly size: number
  readonly wrapped = false

  constructor(handle: FileHandle, size: number) {
    this.#handle = handle
    this.size = size
  }

  async read(position: number, length: number): Promise<Buffer> {
    const clamped = Math.max(0, Math.min(length, this.size - position))
    const buffer = Buffer.allocUnsafe(clamped)
    if (clamped === 0) return buffer

    await this.#handle.read(buffer, 0, clamped, position)
    return buffer
  }

  close(): Promise<void> {
    return this.#handle.close()
  }
}

class YargSongSource implements ContainerSource {
  #handle: FileHandle
  #key: YargSongKey
  readonly size: number
  readonly wrapped = true

  constructor(handle: FileHandle, size: number, key: YargSongKey) {
    this.#handle = handle
    this.#key = key
    this.size = size
  }

  async read(position: number, length: number): Promise<Buffer> {
    const clamped = Math.max(0, Math.min(length, this.size - position))
    const buffer = Buffer.allocUnsafe(clamped)
    if (clamped === 0) return buffer

    await this.#handle.read(buffer, 0, clamped, position + YARGSONG_HEADER_SIZE)
    return decipherYargSong(buffer, position, this.#key)
  }

  close(): Promise<void> {
    return this.#handle.close()
  }
}

/**
 * Open a container, transparently removing the `.yargsong` layer if present.
 *
 * Dispatches on the signature rather than the extension, which is what YARG
 * does — the wrapper is a property of the bytes, and charts get renamed.
 */
export async function openContainer(path: string): Promise<ContainerSource> {
  const handle = await open(path, 'r')

  try {
    const { size } = await handle.stat()

    const header = Buffer.allocUnsafe(YARGSONG_HEADER_SIZE)
    const { bytesRead } = await handle.read(header, 0, YARGSONG_HEADER_SIZE, 0)

    if (bytesRead === YARGSONG_HEADER_SIZE && header.subarray(0, 8).equals(SIGNATURE)) {
      const key = deriveYargSongKey(header[8]!, header.subarray(9, 9 + SET_LENGTH))
      if (key !== null) {
        return new YargSongSource(handle, size - YARGSONG_HEADER_SIZE, key)
      }
    }

    return new PlainSource(handle, size)
  } catch (error) {
    await handle.close()
    throw error
  }
}
