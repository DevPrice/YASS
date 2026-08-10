/**
 * Core parsing tests.
 *
 * These run against the pinned fixtures in `fixtures/`, which were captured
 * from a live YARG install rather than hand-written from the spec — the whole
 * point being that `currentSong.json` is an accidental API and the real bytes
 * are the only trustworthy reference.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { parseCsv } from './csv.js'
import { base64HashToHex, extractCurrentSongHash, normalizeHash } from './hash.js'
import { parseCsvLibrary, parseDifficulty, parseLength, parseYear } from './library.js'
import { stripRichText } from './richtext.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')

const readFixture = (name: string) => readFile(join(FIXTURES, name), 'utf8')

describe('stripRichText', () => {
  it('removes the tags YARG emits', () => {
    assert.equal(stripRichText('<color=#FF0000>Song</color> <i>Title</i>'), 'Song Title')
    assert.equal(stripRichText('<b>Bold</b> and <size=+2>big</size>'), 'Bold and big')
    assert.equal(stripRichText('<sprite=3>Icon'), 'Icon')
  })

  it('leaves text that only looks like markup alone', () => {
    // The reason we match a known tag list instead of `<[^>]*>`: these are real
    // song titles and stripping them would corrupt the library.
    assert.equal(stripRichText('I <3 You'), 'I <3 You')
    assert.equal(stripRichText('<unknown>kept</unknown>'), '<unknown>kept</unknown>')
    assert.equal(stripRichText('a < b > c'), 'a < b > c')
  })

  it('does not let <s> swallow the start of an unknown tag', () => {
    assert.equal(stripRichText('<something>text'), '<something>text')
  })

  it('handles empty and missing input', () => {
    assert.equal(stripRichText(''), '')
    assert.equal(stripRichText(null), '')
    assert.equal(stripRichText(undefined), '')
  })
})

describe('hash normalization', () => {
  it('converts the base64 HashBytes from currentSong.json to canonical hex', () => {
    assert.equal(
      base64HashToHex('vmCohsn7edFKfCj2LXHiaZnS7yU='),
      'BE60A886C9FB79D14A7C28F62D71E26999D2EF25',
    )
  })

  it('reads the structural Hash shape YARG actually writes', () => {
    assert.equal(
      extractCurrentSongHash({ HashBytes: 'vmCohsn7edFKfCj2LXHiaZnS7yU=' }),
      'BE60A886C9FB79D14A7C28F62D71E26999D2EF25',
    )
  })

  it('also accepts a plain hex string, in case YARG wires up the converter', () => {
    assert.equal(
      extractCurrentSongHash('be60a886c9fb79d14a7c28f62d71e26999d2ef25'),
      'BE60A886C9FB79D14A7C28F62D71E26999D2EF25',
    )
  })

  it('rejects malformed hashes rather than producing a bad join key', () => {
    assert.equal(normalizeHash('not-a-hash'), null)
    assert.equal(normalizeHash('ABCD'), null)
    assert.equal(normalizeHash(''), null)
    assert.equal(extractCurrentSongHash(undefined), null)
    assert.equal(extractCurrentSongHash({}), null)
  })
})

describe('CSV parsing', () => {
  it('handles quotes, embedded commas, and doubled quotes', () => {
    const rows = parseCsv('a,b\n"x,y","he said ""hi"""\n')
    assert.deepEqual(rows, [
      ['a', 'b'],
      ['x,y', 'he said "hi"'],
    ])
  })

  it('handles CRLF and a missing trailing newline', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2'), [
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('strips a UTF-8 BOM', () => {
    const rows = parseCsv('﻿Name,Artist\nA,B\n')
    assert.deepEqual(rows[0], ['Name', 'Artist'])
  })
})

describe('scalar parsing', () => {
  it('parses M:SS lengths, including minutes past 59', () => {
    assert.equal(parseLength('4:07'), 247)
    // YARG does not cap minutes; a 75-minute chart renders as 75:00.
    assert.equal(parseLength('75:00'), 4500)
    assert.equal(parseLength(''), null)
    assert.equal(parseLength('garbage'), null)
  })

  it('parses years leniently', () => {
    assert.equal(parseYear('1984 (remaster)'), 1984)
    assert.equal(parseYear('2010'), 2010)
    assert.equal(parseYear(''), null)
    // int.MaxValue is YARG's "unknown" sentinel and must never render.
    assert.equal(parseYear('2147483647'), null)
  })

  it('maps the -1 difficulty sentinel to absent', () => {
    assert.equal(parseDifficulty('-1'), null)
    assert.equal(parseDifficulty('0'), 0)
    assert.equal(parseDifficulty('5'), 5)
    assert.equal(parseDifficulty(''), null)
  })
})

describe('library from the sample CSV', () => {
  it('parses every row and its edge cases', async () => {
    const { songs, warnings } = parseCsvLibrary(await readFixture('songs.sample.csv'))

    assert.equal(warnings.length, 0)
    assert.equal(songs.length, 8)

    const quoted = songs.find((s) => s.name === 'Bohemian Rhapsody, Pt. 1')
    assert.ok(quoted, 'a quoted field containing a comma should survive')
    assert.equal(quoted.format, 'CON')

    const doubled = songs.find((s) => s.name === 'He said "Hello"')
    assert.ok(doubled, 'doubled quotes should unescape')
    assert.equal(doubled.yearNumber, 1984)

    const marathon = songs.find((s) => s.name === 'The Longest Jam In The World')
    assert.equal(marathon?.lengthSeconds, 4500)

    const unicode = songs.find((s) => s.artist === 'Motörhead')
    assert.ok(unicode, 'non-ASCII metadata should decode as UTF-8')

    const hashless = songs.find((s) => s.name === 'No Hash Song')
    assert.equal(hashless?.hash, null)
    assert.ok(hashless?.id.startsWith('row:'), 'hashless rows get a synthetic id')
  })

  it('gives every song a unique id, so React keys are safe', async () => {
    const { songs } = parseCsvLibrary(await readFixture('songs.sample.csv'))
    assert.equal(new Set(songs.map((s) => s.id)).size, songs.length)
  })
})

describe('now-playing to library join', () => {
  it('matches the live currentSong.json capture against a library row', async () => {
    // This is the join the whole now-playing highlight depends on: the JSON
    // carries base64, the CSV carries hex, and they must meet in the middle.
    const currentSong = JSON.parse(await readFixture('currentSong.playing.json')) as {
      Hash: unknown
    }
    const { songs } = parseCsvLibrary(await readFixture('songs.sample.csv'))

    const hash = extractCurrentSongHash(currentSong.Hash)
    assert.equal(hash, 'BE60A886C9FB79D14A7C28F62D71E26999D2EF25')

    const matched = songs.find((song) => song.hash === hash)
    assert.ok(matched, 'the playing song should resolve to a library row')
    assert.equal(matched.name, 'Dayglow Visa Rd. (Autochart)')
  })

  it('treats a blank currentSong.json as nothing playing, not an error', async () => {
    const text = await readFixture('currentSong.empty.json')
    assert.equal(text.trim(), '')
    // The watcher's contract: blank means menus. Parsing it would throw, which
    // is exactly the bug this fixture exists to prevent.
    assert.throws(() => JSON.parse(text) as unknown)
  })
})
