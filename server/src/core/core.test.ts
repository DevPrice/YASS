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

import { base64HashToHex, extractCurrentSongHash, normalizeHash } from './hash.js'
import {
  buildLibrarySongs,
  parseYear,
  partDifficulty,
  trackNumber,
  vocalPartCount,
} from './library.js'
import { stripRichText } from './richtext.js'
import type { CacheSong, CacheSongMeta, PartName, PartValue } from '../media/cache.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')

const readFixture = (name: string) => readFile(join(FIXTURES, name), 'utf8')

const ABSENT: PartValue = { subTracks: 0, intensity: -1 }

/** Every part absent, which is what `PartValues.Default` deserializes to. */
function noParts(): Record<PartName, PartValue> {
  const names: PartName[] = [
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
  ]

  return Object.fromEntries(names.map((name) => [name, { ...ABSENT }])) as Record<
    PartName,
    PartValue
  >
}

/** One cache entry, with only the fields a test cares about spelled out. */
function entry(hash: string, meta: Partial<CacheSongMeta> = {}): CacheSong {
  return {
    ref: { hash, format: 'Ini', path: `C:\\charts\\${hash}` },
    meta: {
      name: '',
      artist: '',
      album: '',
      genre: '',
      subgenre: '',
      year: '',
      charter: '',
      playlist: '',
      source: '',
      isMaster: true,
      albumTrack: 2147483647,
      lengthMs: 0,
      rating: 4,
      parts: noParts(),
      ...meta,
    },
  }
}

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

describe('scalar parsing', () => {
  it('parses years leniently', () => {
    assert.equal(parseYear('1984 (remaster)'), 1984)
    assert.equal(parseYear('2010'), 2010)
    assert.equal(parseYear(''), null)
    // int.MaxValue is YARG's "unknown" sentinel and must never render.
    assert.equal(parseYear('2147483647'), null)
  })

  it('tells an absent part from one that was never given a tier', () => {
    // No subtracks: the instrument simply isn't charted.
    assert.equal(partDifficulty({ subTracks: 0, intensity: -1 }), null)
    // Charted but untiered clamps to 0, which is YARG's own `GetIntensity`.
    assert.equal(partDifficulty({ subTracks: 31, intensity: -1 }), 0)
    assert.equal(partDifficulty({ subTracks: 31, intensity: 5 }), 5)
    // The distinction that matters: an absent part with a stale tier byte is
    // still absent, and reading `intensity` alone would call it a 4.
    assert.equal(partDifficulty({ subTracks: 0, intensity: 4 }), null)
  })

  it('counts vocal parts off the harmony subtracks', () => {
    const of = (harmony: number, lead = 0) =>
      vocalPartCount({ subTracks: harmony, intensity: 0 }, { subTracks: lead, intensity: 0 })

    assert.equal(of(0b111), 3)
    assert.equal(of(0b011), 2)
    assert.equal(of(0b001), 1)
    // No harmonies charted, but a lead vocal is still one part.
    assert.equal(of(0, 1), 1)
    assert.equal(of(0, 0), 0)
  })

  it('rejects the track numbers that are not track numbers', () => {
    assert.equal(trackNumber(2147483647), null)
    assert.equal(trackNumber(0), null)
    assert.equal(trackNumber(-1), null)
    assert.equal(trackNumber(3), 3)
    // A real authored value, however odd, is kept rather than second-guessed.
    assert.equal(trackNumber(16000), 16000)
  })
})

describe('library from cache entries', () => {
  it('carries the metadata across, stripping the markup YARG stores raw', () => {
    const { songs, warnings } = buildLibrarySongs([
      entry('A'.repeat(40), {
        name: '<color=#FF0000>Song</color> <i>Title</i>',
        artist: 'Motörhead',
        album: 'An Album',
        year: '1984 (remaster)',
        albumTrack: 7,
        lengthMs: 247_800,
        rating: 2,
        isMaster: false,
      }),
    ])

    assert.deepEqual(warnings, [])
    const [song] = songs
    // The CSV stripped rich text on its way out; the cache does not, so this is
    // the one transformation that has to happen here or the list renders markup.
    assert.equal(song?.name, 'Song Title')
    assert.equal(song?.artist, 'Motörhead')
    assert.equal(song?.yearNumber, 1984)
    assert.equal(song?.year, '1984 (remaster)')
    assert.equal(song?.albumTrack, 7)
    // Truncated to the second the CSV's `M:SS` would have shown, not rounded up.
    assert.equal(song?.lengthSeconds, 247)
    assert.equal(song?.ageRating, 'Mature')
    assert.equal(song?.isMaster, false)
  })

  it('spells the ratings the way the CSV export did', () => {
    const labels = [0, 1, 2, 3, 4, 5, 6].map(
      (rating) => buildLibrarySongs([entry('B'.repeat(40), { name: 'x', rating })]).songs[0]?.ageRating,
    )

    assert.deepEqual(labels, [
      'Family Friendly',
      'Supervision Recommended',
      'Mature',
      'Sensitive Content',
      // Unspecified, No_Rating and None all read as "No Rating", which is the
      // fallback arm of YARG's own switch.
      'No Rating',
      'No Rating',
      'No Rating',
    ])
  })

  it('maps every instrument to its part in the struct', () => {
    const parts = noParts()
    parts.fiveFretGuitar = { subTracks: 31, intensity: 3 }
    parts.proDrums = { subTracks: 31, intensity: 6 }
    parts.harmonyVocals = { subTracks: 0b111, intensity: 1 }
    parts.bandDifficulty = { subTracks: 1, intensity: 4 }

    const [song] = buildLibrarySongs([entry('C'.repeat(40), { name: 'x', parts })]).songs

    assert.equal(song?.difficulties.guitar5, 3)
    assert.equal(song?.difficulties.proDrums, 6)
    assert.equal(song?.difficulties.harmony, 1)
    assert.equal(song?.difficulties.bass5, null)
    assert.equal(song?.bandDifficulty, 4)
    assert.equal(song?.vocalParts, 3)
  })

  it('gives duplicate charts of one song distinct ids', () => {
    const hash = 'D'.repeat(40)
    const { songs } = buildLibrarySongs([
      entry(hash, { name: 'Same Song' }),
      entry(hash, { name: 'Same Song' }),
      entry(hash, { name: 'Same Song' }),
    ])

    // Both charts are kept — YARG keeps them too — but React needs the keys to
    // differ, and the hash alone cannot provide that.
    assert.equal(songs.length, 3)
    assert.equal(new Set(songs.map((s) => s.id)).size, 3)
    assert.equal(songs[0]?.hash, hash)
    assert.equal(songs[1]?.hash, hash)
  })

  it('drops an entry with no identifying text at all, and says so', () => {
    const { songs, warnings } = buildLibrarySongs([
      entry('E'.repeat(40)),
      entry('F'.repeat(40), { artist: 'Has An Artist' }),
    ])

    assert.equal(songs.length, 1)
    assert.equal(songs[0]?.artist, 'Has An Artist')
    assert.match(warnings[0] ?? '', /1 chart/)
  })

  it('does not let a dropped entry push a real duplicate onto a suffix', () => {
    const hash = 'E'.repeat(40)
    const { songs } = buildLibrarySongs([entry(hash), entry(hash, { name: 'The Real One' })])

    // The nameless chart never claimed the id, so the song that survives gets
    // the plain hash rather than `…#2`.
    assert.equal(songs.length, 1)
    assert.equal(songs[0]?.id, hash)
  })
})

describe('now-playing to library join', () => {
  it('matches the live currentSong.json capture against a library row', async () => {
    // This is the join the whole now-playing highlight depends on: the JSON
    // carries base64, the cache carries raw SHA-1 bytes, and the two have to
    // meet on the same canonical hex.
    const currentSong = JSON.parse(await readFixture('currentSong.playing.json')) as {
      Hash: unknown
    }

    const hash = extractCurrentSongHash(currentSong.Hash)
    assert.equal(hash, 'BE60A886C9FB79D14A7C28F62D71E26999D2EF25')

    const { songs } = buildLibrarySongs([
      entry('BE60A886C9FB79D14A7C28F62D71E26999D2EF25', {
        name: 'Dayglow Visa Rd. (Autochart)',
      }),
      entry('0'.repeat(40), { name: 'Some Other Song' }),
    ])

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
