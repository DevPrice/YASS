/**
 * The pass that reads a real library. Opt-in, and skipped by default.
 *
 * ```
 *   YASS_MEDIA_FIXTURE_YARG_DIR=%LOCALAPPDATA%\..\LocalLow\YARC\YARG\release \
 *   npm test --workspace=server
 * ```
 *
 * **Why none of this is a committed fixture.** `songcache.bin` bakes in
 * absolute paths that carry the user's Windows account name, and the charts
 * themselves are gigabytes of copyrighted music. So the inputs stay on the
 * machine that has them, the test is skipped everywhere else, and the unit
 * vectors in `media.test.ts` carry the parts that can be pinned.
 *
 * Two claims are being made here, and both fail quietly rather than loudly if
 * they break. The first is the join: every song must resolve to a chart on
 * disk, because album art and previews are downstream of it and the symptom of
 * losing it is covers going dark, not an error. The second arrived when the
 * song list moved into this same file — that the metadata read back out of it
 * is really the metadata, and not a plausible-looking misalignment.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { describe, it } from 'node:test'

import { findMappingsDir, loadGenreTable, readGenrelizerMode } from '../core/genrelizer.js'
import { loadLibraryFromCache } from '../core/library.js'
import { readSongCache } from './cache.js'
import { openConPackage, findConListing, isContiguous } from './stfs.js'
import { decodeDxt, expectedPayloadBytes, readDxtHeader } from './dxt.js'
import { parseDta, findSongNode, readSongAudio } from './dta.js'
import { songCachePath } from '../core/paths.js'
import { findListing, openSngPackage } from './sng.js'
import { extractArt } from './art.js'
import type { ChartRef } from './types.js'

const YARG_DIR = process.env.YASS_MEDIA_FIXTURE_YARG_DIR

/** Only run when pointed at a real install. */
const available = Boolean(YARG_DIR) && existsSync(songCachePath(YARG_DIR ?? ''))
const options = available
  ? {}
  : { skip: 'set YASS_MEDIA_FIXTURE_YARG_DIR to a YARG data directory' }

const CHART_FILES = ['notes.mid', 'notes.midi', 'notes.chart', 'notes.txt']

const sha1 = (bytes: Buffer): string => createHash('sha1').update(bytes).digest('hex').toUpperCase()

/** Read once and share; parsing is milliseconds but the file is 2 MB. */
let cached: ChartRef[] | null = null

async function refs(): Promise<ChartRef[]> {
  cached ??= (await readSongCache(songCachePath(YARG_DIR!))).songs.map((song) => song.ref)
  return cached
}

describe('songcache.bin against a real library', options, () => {
  it('parses every entry', async () => {
    const all = await refs()

    assert.ok(all.length > 0, 'no charts came out of the cache')

    for (const ref of all) {
      assert.match(ref.hash, /^[0-9A-F]{40}$/, `${ref.path} has a malformed hash`)
      assert.ok(ref.path.length > 0, 'a ref came back with no path')

      // Packages are identified by a shortname; loose charts are not.
      if (ref.format === 'CON' || ref.format === 'ExCON') {
        assert.ok(ref.subName, `${ref.path} is a package with no subName`)
      }
    }
  })

  /*
   * The song list and the chart index now come out of the same parse, so this
   * can no longer be the cross-check between two sources it once was — it is a
   * check that the metadata half of that parse produces a usable library rather
   * than 4,000 rows of plausible-looking garbage. A misread by even one byte
   * moves every field after it, so "every song has a title and a sane length"
   * is a much stronger assertion here than it looks.
   */
  it('builds a library every song of which is coherent', async () => {
    const library = await loadLibraryFromCache(YARG_DIR!)

    assert.deepEqual(library.meta.warnings, [])
    assert.equal(library.meta.source, 'cache')
    assert.ok(library.songs.length > 0, 'the cache loaded no songs')

    const index = new Map((await refs()).map((ref) => [ref.hash, ref]))
    const problems: string[] = []

    for (const song of library.songs) {
      const where = `${song.artist} - ${song.name}`

      if (!song.name && !song.artist) problems.push('a song has neither title nor artist')
      // Rich text survives into the cache; the CSV used to strip it upstream.
      if (/<\/?(?:color|i|b|size)[=>]/i.test(song.name)) {
        problems.push(`${where}: rich text left in the title`)
      }
      // Twelve hours is not a song; a misaligned read is what produces one.
      if (song.lengthSeconds !== null && (song.lengthSeconds < 0 || song.lengthSeconds > 43_200)) {
        problems.push(`${where}: implausible length ${song.lengthSeconds}s`)
      }
      if (song.yearNumber !== null && (song.yearNumber < 1900 || song.yearNumber > 2100)) {
        problems.push(`${where}: implausible year ${song.yearNumber}`)
      }
      if (song.albumTrack !== null && (song.albumTrack < 1 || song.albumTrack > 100_000)) {
        problems.push(`${where}: implausible track ${song.albumTrack}`)
      }
      if (song.vocalParts < 0 || song.vocalParts > 3) {
        problems.push(`${where}: ${song.vocalParts} vocal parts`)
      }
      for (const [key, tier] of Object.entries(song.difficulties)) {
        if (tier !== null && (tier < 0 || tier > 10)) {
          problems.push(`${where}: ${key} difficulty ${tier}`)
        }
      }
      // Every song in the list came from an entry that also produced a ref.
      if (song.hash === null || !index.has(song.hash)) {
        problems.push(`${where}: no chart ref for its own hash`)
      }
    }

    assert.deepEqual(problems.slice(0, 10), [], `${problems.length} songs came out malformed`)
  })

  /*
   * The genre check that unit vectors cannot make.
   *
   * Genrelizing is a port of YARG's own algorithm against YARG's own downloaded
   * data, and the failure mode is not an exception — it is a library that looks
   * fine while quietly filing half of itself under `Other`. So this asserts the
   * property the whole feature exists for: after normalization, every genre in
   * the library is one of the closed set YARG sorts by. A single raw
   * `Classicrock` surviving would fail it.
   */
  it('normalizes every genre to one YARG would sort by', async (t) => {
    const mappings = await findMappingsDir()
    if (mappings === null) {
      t.skip('YARG has not downloaded the Genrelizer mappings on this machine')
      return
    }

    const mode = await readGenrelizerMode(YARG_DIR!)
    if (mode !== 'genrelize') {
      t.skip(`YARG's Genrelizer setting is "${mode}", so genres are not normalized this way`)
      return
    }

    const library = await loadLibraryFromCache(YARG_DIR!)
    const table = await loadGenreTable(mappings)

    // The official list, plus the two answers Genrelizer gives when it has none.
    const official = new Set([...table.display.values(), 'Other', 'Unknown Genre'])
    const strays = [...new Set(library.songs.map((song) => song.genre))].filter(
      (genre) => !official.has(genre),
    )

    assert.deepEqual(strays, [], 'these genres are not on YARG\'s official list')
    // And the point of it: far fewer genres than there are ways of writing them.
    assert.ok(
      new Set(library.songs.map((song) => song.genre)).size <= official.size,
      'more distinct genres than the official list has entries',
    )
  })

  it('agrees with the chart index on how many songs there are', async () => {
    const library = await loadLibraryFromCache(YARG_DIR!)
    const all = await refs()

    // Not equality: duplicate charts share a hash, so the index dedupes where
    // the list keeps both. The list can only ever be the larger of the two.
    assert.ok(
      library.songs.length >= new Set(all.map((ref) => ref.hash)).size,
      'the song list has fewer songs than there are distinct charts',
    )
  })
})

describe('container readers against real files', options, () => {
  it('hashes the chart inside every SNG back to the cache', async (t) => {
    const packages = (await refs()).filter((ref) => ref.format === 'Sng')
    if (packages.length === 0) {
      t.skip('no .sng or .yargsong charts in this library')
      return
    }

    // The whole set: they are small, and the `.yargsong` cipher is the one
    // piece of this codebase where a wrong answer is indistinguishable from a
    // right one until you hash it.
    for (const ref of packages) {
      const pkg = await openSngPackage(ref.path)
      assert.notEqual(pkg, null, `could not open ${ref.path}`)

      try {
        const found = findListing(pkg!, CHART_FILES)
        assert.notEqual(found, null, `no chart file inside ${ref.path}`)

        assert.equal(
          sha1(await pkg!.readFile(found!.listing)),
          ref.hash,
          `${ref.path} decrypted to the wrong bytes`,
        )
      } finally {
        await pkg!.close()
      }
    }
  })

  it('extracts the .mid from every CON back to the cache', async (t) => {
    const packages = (await refs()).filter((ref) => ref.format === 'CON')
    if (packages.length === 0) {
      t.skip('no CON packages in this library')
      return
    }

    let contiguous = 0
    let split = 0

    for (const ref of packages) {
      const pkg = await openConPackage(ref.path)
      assert.notEqual(pkg, null, `${ref.path} did not read as a CON`)

      try {
        const midi = findConListing(pkg!, `songs/${ref.subName}/${ref.subName}.mid`)
        assert.notEqual(midi, null, `${ref.subName} has no .mid inside ${ref.path}`)

        if (isContiguous(midi!)) contiguous++
        else split++

        // The strongest statement available: block addressing, the file table,
        // and whichever extraction path this listing takes are all correct, or
        // this hash is wrong.
        assert.equal(sha1(await pkg!.read(midi!)), ref.hash, `${ref.subName} extracted wrongly`)
      } finally {
        await pkg!.close()
      }
    }

    // Not an assertion about the library, just a note in the output: if a
    // library turns out to be all one kind, the other path is untested here.
    console.log(`  ${contiguous} contiguous, ${split} split CON extractions verified`)
  })

  it('decodes the album art inside every CON', async (t) => {
    const packages = (await refs()).filter((ref) => ref.format === 'CON')
    if (packages.length === 0) {
      t.skip('no CON packages in this library')
      return
    }

    for (const ref of packages) {
      const pkg = await openConPackage(ref.path)
      if (pkg === null) continue

      try {
        const listing = findConListing(pkg, `songs/${ref.subName}/gen/${ref.subName}_keep.png_xbox`)
        if (listing === null) continue

        const raw = await pkg.read(listing)
        const header = readDxtHeader(raw)
        assert.notEqual(header, null, `${ref.subName} has an unreadable texture header`)

        // Check the payload against `ceil(w/4) * ceil(h/4) * {8 | 16}` before
        // trusting a single pixel: a wrong guess about the format decodes to
        // plausible garbage rather than to an error.
        assert.ok(
          raw.length - 32 >= expectedPayloadBytes(header!),
          `${ref.subName}: ${raw.length - 32} bytes for a ${header!.width}x${header!.height} ` +
            `${header!.dxt1 ? 'DXT1' : 'DXT5'} mip 0 needing ${expectedPayloadBytes(header!)}`,
        )

        const image = decodeDxt(raw)
        assert.notEqual(image, null, `${ref.subName} failed to decode`)
        assert.equal(image!.rgba.length, image!.width * image!.height * 4)
      } finally {
        await pkg.close()
      }
    }
  })

  it('finds a preview window for every CON', async (t) => {
    const packages = (await refs()).filter((ref) => ref.format === 'CON')
    if (packages.length === 0) {
      t.skip('no CON packages in this library')
      return
    }

    for (const ref of packages) {
      const pkg = await openConPackage(ref.path)
      if (pkg === null) continue

      try {
        const listing = findConListing(pkg, 'songs/songs.dta')
        assert.notEqual(listing, null, `${ref.path} has no songs.dta`)

        const document = parseDta((await pkg.read(listing!)).toString('utf8'))

        // `dtaName` rather than `subName`, and the difference is real: at least
        // one package in a library this size keeps its files under one name and
        // its DTA node under another.
        const node = findSongNode(document, ref.dtaName ?? ref.subName!)
        assert.notEqual(node, null, `${ref.dtaName ?? ref.subName} is not in its own songs.dta`)

        const audio = readSongAudio(node!)
        assert.ok(audio.pans.length > 0, `${ref.subName} has no channel map`)
      } finally {
        await pkg.close()
      }
    }
  })
})

describe('album art extraction across formats', options, () => {
  it('gets a cover out of each format that has one', async () => {
    const all = await refs()

    for (const format of ['Ini', 'Sng', 'CON'] as const) {
      const sample = all.filter((ref) => ref.format === format).slice(0, 5)
      if (sample.length === 0) continue

      let found = 0
      for (const ref of sample) {
        const art = await extractArt(ref)
        if (art === null) continue

        found++
        assert.ok(art.data.length > 0, `${format} produced an empty image`)

        if (art.kind === 'rgba') {
          assert.equal(art.data.length, art.width * art.height * 4)
        }
      }

      assert.ok(found > 0, `no album art at all from ${sample.length} ${format} charts`)
    }
  })
})
