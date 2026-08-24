/**
 * Reader for YARG's `songcache.bin`.
 *
 * The README's long-standing answer to "where does the art come from" was
 * "patch YARG to publish an index". It turns out YARG already publishes one:
 * it rewrites this file on every scan, and it holds both of the things this app
 * used to get from two places — where each chart lives on disk, and the song
 * metadata the list is built out of.
 *
 * That second half arrived later. This started as a reader for paths alone,
 * beside a CSV export the user had to remember to re-generate by hand; the
 * whole library now comes from here instead, which is why `readMetadata` exists
 * and why the string tables are read rather than skipped.
 *
 * ## Why a read-only parser is cheap here
 *
 * Two properties of the format do all the work:
 *
 *  1. **Everything is length-prefixed.** Groups and entries alike are written
 *     as `int32 length` followed by that many bytes, so a parser can read the
 *     fields it cares about at the head of a blob and then skip to the next one
 *     by arithmetic. Roughly seventy fields of a song entry — every credit
 *     string, every link, the venue hints, the per-part charter credits — are
 *     never touched. That is what makes this safe to write against a format
 *     nobody promised us.
 *
 *  2. **The encodings are plain .NET.** Little-endian scalars, strings as a
 *     7-bit-encoded (LEB128) length followed by UTF-8, and `HashWrapper` as its
 *     20 raw SHA-1 bytes. No framework metadata, no type tags.
 *
 * ## The shape
 *
 * ```
 *   int32   CACHE_VERSION
 *   bool    fullDirectoryPlaylists
 *   9 ×     string table          ← read (int32 byteLength, int32 count, strings)
 *   array   update directories    ─┐
 *   array   unpacked upgrades      ├─ skipped wholesale by their length prefixes
 *   array   packed upgrades       ─┘
 *   array   ini groups            ← read
 *   array   CON groups            ← read
 * ```
 *
 * where `array` is the `CacheLoopable` primitive: `int32 count`, then `count`
 * slices each introduced by its own `int32 length`.
 *
 * ## The version check is not paranoia
 *
 * `CACHE_VERSION` is a date stamp and the layout genuinely changes shape between
 * values — the CON group header's third field is an `int32` enum today and was a
 * `bool` before, and YARG's own full-scan reader (`ReadCONGroup`) still has the
 * one-byte read that change left behind. We follow the *writer* and the quick
 * reader (`QuickReadCONGroup`), and we refuse to parse any version that has not
 * been checked by hand against them. A mismatch falls through to `scan.ts`,
 * which costs a slow first scan rather than the feature. See
 * `SUPPORTED_CACHE_VERSIONS`.
 *
 * Source of truth: `YARG.Core/Song/Cache/CacheHandler.cs` (`Serialize`,
 * `Deserialize_Quick`), `CacheLoopable.cs`, `CacheGroups/*.cs`, and the
 * `ForceDeserialize` methods on each entry type.
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve } from 'node:path'

import type { ChartRef } from './types.js'

/**
 * What a given cache version does to the run this reader reads.
 *
 * There is one flag here today, and the honest description of this type is "the
 * differences that were not free". Everything else YARG has added since this
 * parser was written landed in the tail an entry's own length prefix skips, and
 * cost nothing; `yargGuid` is the first field that did not.
 */
export interface CacheEntryLayout {
  /**
   * `YargGuid`, a LEB128-prefixed string written between the `Source` index and
   * `IsMaster`. Added in `26_08_21_00`.
   *
   * The one field ever to land *inside* the region `readMetadata` reads, and so
   * the reason that function takes a layout at all. Nothing downstream wants
   * the value — it is read only to know where `IsMaster` starts.
   */
  yargGuid: boolean
}

/**
 * The layouts this file has actually been checked against.
 *
 * An allowlist rather than a single constant, and the difference matters: the
 * version is a date stamp that YARG bumps to force a rescan whenever *anything*
 * in the cache changes, and almost everything that changes is in the metadata
 * tail this parser never reads. Pinning to one value would mean falling back to
 * the scanner on every YARG update, including the ones that moved nothing we
 * look at.
 *
 * So a version earns its place here by inspection, not by being recent. Each
 * was verified by diffing every file under `Song/Cache/` and `Song/Entries/`
 * between its commit and the one before it, and accounting for every
 * serialization change at or before `SongRating` — which is where
 * `readMetadata` stops. Across all four, the head of every entry — relative
 * path, format byte, timestamps, then the hash — is byte-identical, as are the
 * group order, `AvailableParts`, the string-table count, and the CON group's
 * `int32` type tag.
 *
 * | Version       | YARG commit                                             | In the read region                |
 * |---------------|---------------------------------------------------------|-----------------------------------|
 * | `26_04_28_00` | `108f6c16` "Add support for charter_audio metadata …"    | —                                 |
 * | `26_07_23_00` | `1a970e88` "Fix vocal gender parsing for ini and con"    | — `VenueHint` and after           |
 * | `26_08_12_00` | `6e08bad1` "Add vocals censorship chart feature (#405)"  | — `CleanVocals`, one field after  |
 * | `26_08_21_00` | `180dc09f` "Add support for yarg_guid ini tag"           | **`YargGuid`, before `IsMaster`** |
 *
 * Those last two are worth reading together, because they are the two outcomes
 * this table exists to tell apart. `26_08_12_00` added a `bool` immediately
 * *after* `SongRating` and needed no code at all. `26_08_21_00` added a
 * variable-length string *before* `IsMaster` and moved every scalar after it —
 * a reader that ignored the difference would have kept parsing, silently, and
 * returned a library of wrong track numbers and wrong durations. One field's
 * distance separates the two.
 *
 * **Do not add a version without doing that diff.** The format really does
 * change shape between stamps — the CON group header's type tag used to be a
 * `bool`, and YARG's own full-scan reader still carries the one-byte read that
 * change left behind. Guessing here produces confident, wrong hashes; refusing
 * produces a slow first scan. `scan.ts` is what makes refusing cheap.
 */
export const SUPPORTED_CACHE_VERSIONS: ReadonlyMap<number, CacheEntryLayout> = new Map([
  [26_04_28_00, { yargGuid: false }],
  [26_07_23_00, { yargGuid: false }],
  [26_08_12_00, { yargGuid: false }],
  [26_08_21_00, { yargGuid: true }],
])

/** 20 bytes of SHA-1, written raw by `HashWrapper.Serialize`. */
const HASH_BYTES = 20

/** `CONEntryGroup.CONEntryType`. */
const CON_TYPE_PACKED = 0
const CON_TYPE_UNPACKED_CON = 1
const CON_TYPE_UNPACKED_PKG = 2

/** `CacheReadStrings.NUM_CATEGORIES` — title, artist, album, …, source. */
const STRING_TABLE_COUNT = 9

/**
 * `AvailableParts`, field by field, in declaration order.
 *
 * This array *is* the layout: the struct is 21 `PartValues` written as one
 * `sizeof`'d blob, so position is the only thing identifying a part. Do not
 * reorder it. Names are YARG's own rather than this app's instrument keys —
 * `core/library.ts` does that mapping, and keeping the two vocabularies apart
 * is what lets this file stay a literal reading of the format.
 */
const PART_NAMES = [
  'bandDifficulty',
  'fiveFretGuitar',
  'fiveFretBass',
  'fiveFretRhythm',
  'fiveFretCoopGuitar',
  'keys',
  'sixFretGuitar',
  'sixFretBass',
  'sixFretRhythm',
  'sixFretCoopGuitar',
  'fourLaneDrums',
  'proDrums',
  'fiveLaneDrums',
  'eliteDrums',
  'proGuitar17',
  'proGuitar22',
  'proBass17',
  'proBass22',
  'proKeys',
  'leadVocals',
  'harmonyVocals',
] as const

export type PartName = (typeof PART_NAMES)[number]

/**
 * One `PartValues`: two bytes, and both are needed to read a difficulty.
 *
 * `[StructLayout(LayoutKind.Explicit)]` overlays `SubTracks` and the
 * `DifficultyMask` at offset 0 — they are the same byte under two names — with
 * `Intensity` as an `sbyte` at offset 1. A part is charted when `subTracks` is
 * non-zero (YARG's `IsActive()`), and `intensity` is `-1` when untiered, which
 * is a different fact from being absent.
 */
export interface PartValue {
  subTracks: number
  intensity: number
}

/**
 * The song metadata this reader takes out of an entry.
 *
 * A deliberately partial view: these are the fields the library list needs,
 * which all sit in the fixed-size run between the hash and `Preview.Start`.
 * Everything past that point — previews, venue hints, links, credits, the
 * per-part charter strings — is left in the file. See `readMetadata`.
 */
export interface CacheSongMeta {
  name: string
  artist: string
  album: string
  genre: string
  subgenre: string
  /** As authored, e.g. `1984 (remaster)`. YARG's `UnmodifiedYear`. */
  year: string
  charter: string
  playlist: string
  source: string

  isMaster: boolean
  /** `int.MaxValue` when unset, which is YARG's sentinel rather than a track. */
  albumTrack: number
  lengthMs: number
  /** `SongRating`, as its raw enum ordinal. */
  rating: number

  parts: Record<PartName, PartValue>
}

/** A chart's location and its metadata, read in one pass over one entry. */
export interface CacheSong {
  ref: ChartRef
  meta: CacheSongMeta
}

export class CacheFormatError extends Error {}

/**
 * A position inside a buffer, bounded to a slice of it.
 *
 * Slices are views rather than copies: a 2 MB cache produces thousands of them
 * and every one is a pair of integers over the same `Buffer`. Every read is
 * bounds-checked against `end`, because the whole premise of skipping fields we
 * don't understand is that a wrong guess must fail loudly here rather than
 * wander into the next entry and produce a plausible, wrong hash.
 */
class Cursor {
  #buf: Buffer
  #pos: number
  #end: number

  constructor(buf: Buffer, pos = 0, end = buf.length) {
    this.#buf = buf
    this.#pos = pos
    this.#end = end
  }

  get remaining(): number {
    return this.#end - this.#pos
  }

  #need(count: number): number {
    const at = this.#pos
    if (count < 0 || at + count > this.#end) {
      throw new CacheFormatError(
        `read of ${count} bytes at ${at} runs past the end of the slice (${this.#end})`,
      )
    }
    this.#pos = at + count
    return at
  }

  u8(): number {
    return this.#buf.readUInt8(this.#need(1))
  }

  bool(): boolean {
    return this.u8() !== 0
  }

  i8(): number {
    return this.#buf.readInt8(this.#need(1))
  }

  i32(): number {
    return this.#buf.readInt32LE(this.#need(4))
  }

  u32(): number {
    return this.#buf.readUInt32LE(this.#need(4))
  }

  /**
   * An `int64`, narrowed to a JS number.
   *
   * Every one of these is a duration or an offset in milliseconds, so the
   * values in play are billions at the very most — nowhere near the 2^53 where
   * this would start losing integers. A cache that somehow held a bigger one
   * would be describing a song a quarter of a million years long.
   */
  i64(): number {
    return Number(this.#buf.readBigInt64LE(this.#need(8)))
  }

  skip(count: number): void {
    this.#need(count)
  }

  /** Canonical uppercase hex, matching `HashWrapper.ToString()` and the CSV. */
  hash(): string {
    const at = this.#need(HASH_BYTES)
    return this.#buf.toString('hex', at, at + HASH_BYTES).toUpperCase()
  }

  /**
   * .NET's `BinaryWriter` string: a 7-bit-encoded length, then UTF-8 bytes.
   *
   * Exported for testing as `readLeb128` below — the encoding is the one piece
   * of this file with no external landmark, so it gets unit vectors.
   */
  string(): string {
    const length = this.leb128()
    if (length === 0) return ''
    const at = this.#need(length)
    return this.#buf.toString('utf8', at, at + length)
  }

  leb128(): number {
    let result = 0
    let shift = 0

    // .NET's writer emits at most 5 bytes for an int32; a sixth continuation
    // bit means we are not where we think we are in the file.
    for (let i = 0; i < 5; i++) {
      const byte = this.u8()
      result |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result >>> 0
      shift += 7
    }

    throw new CacheFormatError('7-bit encoded integer did not terminate within 5 bytes')
  }

  /** Take `length` bytes as a sub-cursor and advance past them. */
  slice(length: number): Cursor {
    const at = this.#need(length)
    return new Cursor(this.#buf, at, at + length)
  }

  /**
   * `CacheLoopable`: a count, then that many independently length-prefixed
   * slices.
   *
   * The reason this is the only primitive that matters — a slice we cannot
   * interpret still tells us exactly where the next one starts.
   */
  *loop(): Generator<Cursor> {
    const count = this.i32()
    if (count < 0) throw new CacheFormatError(`negative group count ${count}`)

    for (let i = 0; i < count; i++) {
      yield this.slice(this.i32())
    }
  }

  /** Consume a `CacheLoopable` without looking inside any of its slices. */
  skipLoop(): void {
    for (const _slice of this.loop()) {
      // Intentionally empty: the length prefixes have already done the work.
    }
  }
}

/** LEB128 decode, exposed for the unit vectors. Returns the value and its width. */
export function readLeb128(bytes: Buffer, offset = 0): { value: number; width: number } {
  const cursor = new Cursor(bytes, offset)
  const before = bytes.length - cursor.remaining
  const value = cursor.leb128()
  return { value, width: bytes.length - cursor.remaining - before }
}

/**
 * Join a base directory to a relative path YARG wrote, and refuse anything that
 * escapes.
 *
 * `Path.GetRelativePath` produced these against a directory the user configured,
 * so in practice they are ordinary subpaths. But this file is parsed rather than
 * trusted, and the results become filesystem reads — a `..\..\..` in a cache
 * written by something else is not a thing to find out about later.
 */
function resolveRelative(base: string, relative: string): string | null {
  if (relative === '') return base
  // An absolute relative-path is a contradiction; treat it as corruption.
  if (isAbsolute(relative)) return null

  const resolved = resolve(join(base, relative))
  const baseResolved = resolve(base)
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + '\\') && !resolved.startsWith(baseResolved + '/')) {
    return null
  }

  return resolved
}

/**
 * The nine deduplicated string tables, in the order `CacheReadStrings` names
 * them. Entries carry indices into these rather than their own copies of
 * "Iron Maiden" four hundred times over.
 */
type StringTables = readonly string[][]

/**
 * Read the string-table block.
 *
 * Not a `CacheLoopable` despite looking like one — the count is
 * `NUM_CATEGORIES`, a compile-time constant, so there is no count in the file
 * and these are nine bare length-prefixed slices. Each slice then opens with
 * its own `int32` count.
 */
function readStringTables(stream: Cursor): StringTables {
  const tables: string[][] = []

  for (let i = 0; i < STRING_TABLE_COUNT; i++) {
    const table = stream.slice(stream.i32())
    const count = table.i32()
    if (count < 0) throw new CacheFormatError(`negative string count ${count} in table ${i}`)

    const values: string[] = new Array<string>(count)
    for (let j = 0; j < count; j++) values[j] = table.string()
    tables.push(values)
  }

  return tables
}

/**
 * An index into one of the tables, refused rather than defaulted when it misses.
 *
 * Same rule as every bounds check here: a stray index is evidence of being in
 * the wrong place in the file, and an empty string in its place would hide that
 * behind a library of blank titles.
 */
function pick(table: readonly string[], index: number, what: string): string {
  const value = table[index]
  if (value === undefined) {
    throw new CacheFormatError(`${what} index ${index} is outside its table (${table.length})`)
  }
  return value
}

/**
 * The metadata run at the head of every entry, whatever kind of entry it is.
 *
 * ## Why this is safe to read, when the ~90 fields after it are not
 *
 * The layout from the hash up to `SongRating` is almost all fixed-size: a
 * `sizeof`'d `AvailableParts`, nine string-table indices, two bools, four
 * `int32`s, two `int64`s and a `uint32`. Nothing in it is parsed conditionally,
 * so nothing here depends on having correctly interpreted anything before it.
 *
 * The one exception is `YargGuid`, a string `26_08_21_00` inserted after the
 * `Source` index, which is why `layout` exists — see `CacheEntryLayout`. Note
 * what that costs: the guid's own length prefix keeps *this* function honest,
 * but only because the version told us to expect it. A version whose layout was
 * guessed would read a length byte out of `IsMaster` and wander.
 *
 * This still stops at `SongRating` rather than going further, and the entry's
 * own length prefix skips the rest. Everything past that point — the previews,
 * `CleanVocals`, the venue hints, the links, the credits — has changed
 * repeatedly across the supported versions and never once cost us a line of
 * code. That is the whole reason the read region is drawn where it is.
 */
function readMetadata(
  entry: Cursor,
  strings: StringTables,
  layout: CacheEntryLayout,
): CacheSongMeta {
  const parts = {} as Record<PartName, PartValue>
  for (const part of PART_NAMES) {
    // Order matters twice over: across the array, and within the pair.
    const subTracks = entry.u8()
    parts[part] = { subTracks, intensity: entry.i8() }
  }

  // Nine `int32` indices, in the order the tables were written.
  const name = pick(strings[0]!, entry.i32(), 'title')
  const artist = pick(strings[1]!, entry.i32(), 'artist')
  const album = pick(strings[2]!, entry.i32(), 'album')
  const genre = pick(strings[3]!, entry.i32(), 'genre')
  const subgenre = pick(strings[4]!, entry.i32(), 'subgenre')
  const year = pick(strings[5]!, entry.i32(), 'year')
  const charter = pick(strings[6]!, entry.i32(), 'charter')
  const playlist = pick(strings[7]!, entry.i32(), 'playlist')
  const source = pick(strings[8]!, entry.i32(), 'source')

  // Read and dropped: the app has no use for a chart's GUID, but the bytes are
  // between us and `IsMaster`.
  if (layout.yargGuid) entry.string()

  const isMaster = entry.bool()
  entry.skip(1) // VideoLoop

  const albumTrack = entry.i32()
  entry.skip(4) // PlaylistTrack

  const lengthMs = entry.i64()
  entry.skip(8) // SongOffset

  const rating = entry.u32()

  return {
    name,
    artist,
    album,
    genre,
    subgenre,
    year,
    charter,
    playlist,
    source,
    isMaster,
    albumTrack,
    lengthMs,
    rating,
    parts,
  }
}

/**
 * One ini group: a base directory, then unpacked charts and `.sng` containers.
 *
 * Both entry lists store paths *relative* to the group directory, which is why
 * the directory is read first and why a group is the unit the fallback scanner
 * also works in.
 */
function readIniGroup(
  group: Cursor,
  strings: StringTables,
  layout: CacheEntryLayout,
  into: CacheSong[],
): void {
  const directory = normalize(group.string())

  // Unpacked: string relativePath, byte chartFormat, int64 chartLastWrite,
  // bool hasIniLastWrite [+ int64], then the metadata block opening with the hash.
  for (const entry of group.loop()) {
    const relative = entry.string()
    entry.skip(1 + 8)
    if (entry.bool()) entry.skip(8)

    const path = resolveRelative(directory, relative)
    if (path === null) continue

    const hash = entry.hash()
    into.push({ ref: { hash, format: 'Ini', path }, meta: readMetadata(entry, strings, layout) })
  }

  // Packed: string relativePath, int64 lastWrite, uint32 sngVersion,
  // byte chartFormat, then the hash.
  for (const entry of group.loop()) {
    const relative = entry.string()
    entry.skip(8 + 4 + 1)

    const path = resolveRelative(directory, relative)
    if (path === null) continue

    const hash = entry.hash()
    into.push({ ref: { hash, format: 'Sng', path }, meta: readMetadata(entry, strings, layout) })
  }
}

/**
 * One CON group: an `AbridgedFileInfo` root, a type tag, then its songs.
 *
 * The type tag is the field the format changed shape at, and the reason this
 * file refuses unknown cache versions. `PackedCONEntry` is a single `.con`
 * package file; the two unpacked variants are directories laid out the same way
 * a package is internally, which YARG calls `ExCON`.
 */
function readConGroup(
  group: Cursor,
  strings: StringTables,
  layout: CacheEntryLayout,
  into: CacheSong[],
): void {
  const root = normalize(group.string())
  group.skip(8) // AbridgedFileInfo.LastWriteTime

  const type = group.i32()
  if (type !== CON_TYPE_PACKED && type !== CON_TYPE_UNPACKED_CON && type !== CON_TYPE_UNPACKED_PKG) {
    throw new CacheFormatError(`unknown CON entry type ${type}`)
  }

  const packed = type === CON_TYPE_PACKED
  const format = packed ? 'CON' : 'ExCON'

  for (const entry of group.loop()) {
    // The DTA node name and a byte index — both read by the group loop in YARG,
    // before the per-entry deserializer takes over. The name is kept: it is the
    // key into `songs.dta`, and it does not always equal `subName`.
    const dtaName = entry.string()
    entry.skip(1)

    const subName = entry.string()
    // The unpacked variants carry the loose `.mid`'s timestamp; packed does not.
    if (!packed) entry.skip(8)

    const hash = entry.hash()
    into.push({
      ref: { hash, format, path: root, subName, dtaName },
      meta: readMetadata(entry, strings, layout),
    })
  }
}

export interface CacheParseResult {
  songs: CacheSong[]
  /** The version stamp actually found, for the log line when it isn't ours. */
  version: number
}

/**
 * Parse a `songcache.bin` buffer into chart references.
 *
 * Throws `CacheFormatError` on a version mismatch or a structural surprise.
 * Callers are expected to catch and fall back to scanning — see `index.ts`.
 */
export function parseSongCache(data: Buffer): CacheParseResult {
  const stream = new Cursor(data)

  const version = stream.i32()
  const layout = SUPPORTED_CACHE_VERSIONS.get(version)
  if (layout === undefined) {
    throw new CacheFormatError(
      `songcache.bin is version ${version}; this reader has only been verified against ` +
        [...SUPPORTED_CACHE_VERSIONS.keys()].join(', '),
    )
  }

  stream.skip(1) // fullDirectoryPlaylists

  // Read rather than skipped, which is the one structural change this file has
  // seen since it was only ever after paths: every entry's title, artist and
  // album are indices into these.
  const strings = readStringTables(stream)

  // Update directories, unpacked upgrades, packed upgrades. All three describe
  // RBCON patches, none of which changes where a chart lives.
  stream.skipLoop()
  stream.skipLoop()
  stream.skipLoop()

  const songs: CacheSong[] = []
  for (const group of stream.loop()) readIniGroup(group, strings, layout, songs)
  for (const group of stream.loop()) readConGroup(group, strings, layout, songs)

  return { songs, version }
}

/** Read and parse a cache file. Rejects with `CacheFormatError` on a bad one. */
export async function readSongCache(path: string): Promise<CacheParseResult> {
  return parseSongCache(await readFile(path))
}
