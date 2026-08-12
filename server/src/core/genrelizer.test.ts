/**
 * Genrelizer tests.
 *
 * The real mappings are not committed — they belong to YARG's install, not to
 * this repo — so these run against a small hand-built table that exercises each
 * mechanism. The claim that the *whole* port is faithful is not something unit
 * vectors can make; that is checked against a real library and YARG's own
 * export in `media.integration.test.ts`.
 */

import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  buildGenreTable,
  expandAliases,
  Genrelizer,
  readGenrelizerMode,
  titleCase,
} from './genrelizer.js'

/** A table with one real genre, one aliased genre, and a couple of subgenres. */
function table() {
  return buildGenreTable(
    [
      {
        name: 'Heavy Metal',
        substitutions: { heavy: ['hvy'] },
        subgenres: {
          'Hair Metal': { substitutions: { hair: ['glam hair'] } },
          'Progressive Metal': {},
        },
      },
      { name: 'Metalcore' },
      { name: 'Rock', suffixes: [' music'], prefixes: ['the '] },
      { name: 'Blues', subgenres: { '12-Bar Blues': { substitutions: { '12-bar': ['12 bar'] } } } },
      { name: 'Reggae' },
      { name: 'Ska' },
      { name: 'Other' },
    ],
    'test',
  )
}

const resolver = (mode: 'genrelize' | 'overgenrelize' = 'genrelize') =>
  new Genrelizer(table(), mode)

describe('alias expansion', () => {
  it('applies every combination of substitutions, including none', () => {
    const keys = expandAliases('Hardcore Polka', [], [], {
      hardcore: ['hard core', 'hard-core'],
      polka: ['pulka'],
    })

    // The power set, not the product: leaving a substitution out is a result.
    assert.deepEqual(new Set(keys), new Set([
      'Hardcore Polka',
      'hard core Polka',
      'hard-core Polka',
      'Hardcore pulka',
      'hard core pulka',
      'hard-core pulka',
    ]))
  })

  it('decorates every substitution result with the affixes', () => {
    const keys = expandAliases('Rock', ['the '], [' music'], {})
    assert.deepEqual(new Set(keys), new Set(['Rock', 'Rock music', 'the Rock music', 'the Rock']))
  })

  it('substitutes case-insensitively, which is how the files are written', () => {
    // The mapping files spell substitutions in lowercase by convention, while
    // `name` carries the display capitalization.
    assert.ok(expandAliases('Heavy Metal', [], [], { heavy: ['hvy'] }).includes('hvy Metal'))
  })
})

describe('titleCase', () => {
  it('normalizes a word to leading capital, rest lowercase', () => {
    assert.equal(titleCase('hARD rock'), 'Hard Rock')
    assert.equal(titleCase('  spacey  jazz  '), 'Spacey  Jazz')
  })

  it('leaves an all-uppercase word alone, because it is probably an acronym', () => {
    assert.equal(titleCase('EDM'), 'EDM')
    assert.equal(titleCase('UK garage'), 'UK Garage')
  })
})

describe('resolving a lone genre', () => {
  it('matches a genre by any spelling the mappings define', () => {
    for (const raw of ['Heavy Metal', 'heavy metal', 'HEAVY METAL', 'hvy metal']) {
      assert.deepEqual(resolver().resolve(raw, '', ''), { genre: 'Heavy Metal', subgenre: null })
    }
  })

  it('promotes a subgenre name to its parent, keeping the detail', () => {
    assert.deepEqual(resolver().resolve('12 bar blues', '', ''), {
      genre: 'Blues',
      subgenre: '12-Bar Blues',
    })
  })

  it('reads a slashed list as its first entry', () => {
    // "A list of unrelated genres" — the first is the best single answer.
    assert.deepEqual(resolver().resolve('Heavy Metal/Punk', '', ''), {
      genre: 'Heavy Metal',
      subgenre: null,
    })
  })

  it('reads slashed adjectives as the noun at the end', () => {
    // "Melodic" is not a genre, so pattern A fails and the text after the last
    // slash is tried — which is where the noun lives in this shape.
    assert.deepEqual(resolver().resolve('Melodic/Symphonic/Heavy Metal', '', ''), {
      genre: 'Heavy Metal',
      subgenre: null,
    })
  })

  it('gives up rather than guessing when neither end of a slash matches', () => {
    assert.deepEqual(resolver().resolve('Melodic/Neoclassical Doomjazz', '', ''), {
      genre: 'Other',
      subgenre: 'Melodic/Neoclassical Doomjazz',
    })
  })

  it('reads a comma-separated list as its first entry', () => {
    assert.deepEqual(resolver().resolve('Metalcore, Heavy Metal', '', ''), {
      genre: 'Metalcore',
      subgenre: null,
    })
  })

  it('keeps an unrecognized genre as tidied detail under Other', () => {
    assert.deepEqual(resolver().resolve('yacht funk', '', ''), {
      genre: 'Other',
      subgenre: 'Yacht Funk',
    })
  })

  it('says so when there is nothing to go on', () => {
    assert.deepEqual(resolver().resolve('', '', ''), { genre: 'Unknown Genre', subgenre: null })
    assert.deepEqual(resolver().resolve('   ', '  ', ''), {
      genre: 'Unknown Genre',
      subgenre: null,
    })
  })

  it('treats a lone subgenre field as the genre', () => {
    assert.deepEqual(resolver().resolve('', 'Hair Metal', ''), {
      genre: 'Heavy Metal',
      subgenre: 'Hair Metal',
    })
  })
})

describe('resolving a genre and subgenre together', () => {
  it('keeps the charter genre and standardizes the subgenre', () => {
    assert.deepEqual(resolver().resolve('Heavy Metal', 'glam hair metal', ''), {
      genre: 'Heavy Metal',
      subgenre: 'Hair Metal',
    })
  })

  it('collapses a pair that says the same thing twice', () => {
    assert.deepEqual(resolver().resolve('Metalcore', 'Metalcore', ''), {
      genre: 'Metalcore',
      subgenre: null,
    })
  })

  it('uses a subgenre that names a full genre as the subgenre', () => {
    assert.deepEqual(resolver().resolve('Heavy Metal', 'Metalcore', ''), {
      genre: 'Heavy Metal',
      subgenre: 'Metalcore',
    })
  })

  it('lets the subgenre rescue a genre that resolved to Other', () => {
    // The genre is nonsense, so the only real information is the subgenre.
    assert.deepEqual(resolver().resolve('asdfgh', 'Hair Metal', ''), {
      genre: 'Heavy Metal',
      subgenre: 'Hair Metal',
    })
  })
})

describe('the Magma special cases', () => {
  it('reinterprets a telltale Magma pair', () => {
    // Magma had no `metalcore` genre, so its users had to write `metal > core`.
    assert.deepEqual(resolver().resolve('metal', 'core', ''), {
      genre: 'Metalcore',
      subgenre: null,
    })
  })

  it('reassigns both halves when the pair points somewhere else entirely', () => {
    assert.deepEqual(resolver().resolve('metal', 'hair', ''), {
      genre: 'Heavy Metal',
      subgenre: 'Hair Metal',
    })
  })

  it('leaves a pair alone when it is not the Magma fingerprint', () => {
    // `Metal > Metalcore` was not something Magma could produce, so the
    // charter meant it: the genre stays, and the subgenre is theirs.
    assert.deepEqual(resolver().resolve('Heavy Metal', 'core', ''), {
      genre: 'Heavy Metal',
      subgenre: 'Core',
    })
  })

  it('splits Reggae/Ska on the artist, since Magma could not', () => {
    const it_ = resolver()
    assert.equal(it_.resolve('reggae/ska', '', 'Bob Marley & The Wailers').genre, 'Reggae')
    assert.equal(it_.resolve('reggae/ska', 'other', 'UB40').genre, 'Reggae')
    // Everyone else gets ska, which is far the more common of the two.
    assert.equal(it_.resolve('reggae/ska', '', 'Some Punk Band').genre, 'Ska')
    assert.equal(it_.resolve('reggaeska', '', 'Some Punk Band').genre, 'Ska')
  })
})

describe('the overgenrelize mode', () => {
  it('collapses to a broad heading and drops the subgenre', () => {
    assert.deepEqual(resolver('overgenrelize').resolve('Heavy Metal', 'glam hair metal', ''), {
      genre: 'Metal',
      subgenre: null,
    })
    assert.deepEqual(resolver('overgenrelize').resolve('12 bar blues', '', ''), {
      genre: 'Jazz/Blues',
      subgenre: null,
    })
  })

  it('files an unrecognized genre under Other rather than inventing a bucket', () => {
    assert.deepEqual(resolver('overgenrelize').resolve('yacht funk', '', ''), {
      genre: 'Other',
      subgenre: null,
    })
  })
})

describe("reading YARG's own setting", () => {
  const withSettings = async (body: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'yass-genre-'))
    await writeFile(join(dir, 'settings.json'), body, 'utf8')
    return dir
  }

  it('reads the three modes off the enum YARG stores', async () => {
    assert.equal(await readGenrelizerMode(await withSettings('{"Genrelizer": 0}')), 'off')
    assert.equal(await readGenrelizerMode(await withSettings('{"Genrelizer": 1}')), 'genrelize')
    assert.equal(
      await readGenrelizerMode(await withSettings('{"Genrelizer": 2}')),
      'overgenrelize',
    )
  })

  it("falls back to YARG's default rather than to off", async () => {
    // Defaulting to `off` would silently undo normalization for anyone whose
    // settings file this cannot read, which is the worse failure of the two.
    assert.equal(await readGenrelizerMode(await withSettings('{}')), 'genrelize')
    assert.equal(await readGenrelizerMode(await withSettings('not json')), 'genrelize')
    assert.equal(await readGenrelizerMode(await withSettings('{"Genrelizer": 7}')), 'genrelize')
    assert.equal(await readGenrelizerMode(join(tmpdir(), 'yass-nonexistent-dir')), 'genrelize')
    assert.equal(await readGenrelizerMode(''), 'genrelize')
  })
})
