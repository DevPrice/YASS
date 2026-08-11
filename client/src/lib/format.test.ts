/**
 * Display-formatting tests.
 *
 * Nearly all of this file is about one function. `titleCredit` rewrites the
 * name of every song in the library on the way to the screen, and it does it
 * with regular expressions against a field a few hundred different people
 * typed by hand — so the interesting cases are not the ones it catches but the
 * ones it has to leave alone. `Little Feat` is a band. `Ft. Lauderdale` is a
 * place. Getting either wrong is a title silently rewritten into nonsense on a
 * surface nobody is checking, which is exactly the class of bug a test suite
 * is for and a screenshot is not.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { artistCredit, formatTitleCredit, titleCredit } from './format'

/** A song is two fields as far as any of this is concerned. */
const song = (name: string, artist: string) => ({ name, artist })

describe('titleCredit — credits it should find', () => {
  it('takes a parenthesised credit out of the title', () => {
    assert.deepEqual(titleCredit(song('Love the Way You Lie (feat. Rihanna)', 'Eminem')), {
      title: 'Love the Way You Lie',
      featuring: '(feat. Rihanna)',
      version: null,
    })
  })

  it('reads square brackets and braces too', () => {
    assert.deepEqual(titleCredit(song('Empire State of Mind [ft. Alicia Keys]', 'Jay-Z')), {
      title: 'Empire State of Mind',
      featuring: '(feat. Alicia Keys)',
      version: null,
    })
    assert.equal(titleCredit(song('Song {feat. Guest}', 'Band')).featuring, '(feat. Guest)')
  })

  it('drops the full stop requirement inside brackets, where nothing is ambiguous', () => {
    assert.deepEqual(titleCredit(song('Numb/Encore (feat Jay-Z)', 'Linkin Park')), {
      title: 'Numb/Encore',
      featuring: '(feat. Jay-Z)',
      version: null,
    })
    assert.equal(titleCredit(song('Song (ft Guest)', 'Band')).featuring, '(feat. Guest)')
  })

  it('reads a bare credit in the artist field', () => {
    assert.deepEqual(titleCredit(song('Numb/Encore', 'Jay-Z feat. Linkin Park')), {
      title: 'Numb/Encore',
      featuring: '(feat. Linkin Park)',
      version: null,
    })
  })

  it('reads a bare credit in the title', () => {
    assert.deepEqual(titleCredit(song('Dirt Off Your Shoulder ft. Jay-Z', 'Linkin Park')), {
      title: 'Dirt Off Your Shoulder',
      featuring: '(feat. Jay-Z)',
      version: null,
    })
  })

  it('reads the word spelled out, and the two shorthands charters use', () => {
    assert.equal(titleCredit(song('Song', 'Eminem featuring Dido')).featuring, '(feat. Dido)')
    assert.equal(titleCredit(song('Song', 'Nas f/Lauryn Hill')).featuring, '(feat. Lauryn Hill)')
    assert.equal(titleCredit(song('Song', 'Nas f/ Lauryn Hill')).featuring, '(feat. Lauryn Hill)')
  })

  it('always writes the marker back as `feat.`, whatever the CSV shouted', () => {
    assert.equal(titleCredit(song('Song (FEAT. RIHANNA)', 'Eminem')).featuring, '(feat. RIHANNA)')
    assert.equal(titleCredit(song('Song (Featuring Dido)', 'Eminem')).featuring, '(feat. Dido)')
  })

  it('eats the dash or comma that introduced the credit', () => {
    assert.deepEqual(titleCredit(song('Song - feat. Guest', 'Band')), {
      title: 'Song',
      featuring: '(feat. Guest)',
      version: null,
    })
    assert.deepEqual(titleCredit(song('Song', 'Band, feat. Guest')), {
      title: 'Song',
      featuring: '(feat. Guest)',
      version: null,
    })
    assert.equal(titleCredit(song('Song — feat. Guest', 'Band')).title, 'Song')
  })
})

describe('titleCredit — text it must not touch', () => {
  it('leaves a bare `feat` alone, because Little Feat is a band', () => {
    assert.deepEqual(titleCredit(song('Dixie Chicken', 'Little Feat')), {
      title: 'Dixie Chicken',
      featuring: null,
      version: null,
    })
    assert.deepEqual(titleCredit(song('No Mean Feat', 'Band')), {
      title: 'No Mean Feat',
      featuring: null,
      version: null,
    })
  })

  it('does not find a marker inside a longer word', () => {
    assert.deepEqual(titleCredit(song('The Agony of Defeat. The End', 'Band')), {
      title: 'The Agony of Defeat. The End',
      featuring: null,
      version: null,
    })
    assert.equal(titleCredit(song('Soft. Loud. Soft.', 'Band')).featuring, null)
  })

  it('needs somebody in front of the marker, so a title can open with `Ft.`', () => {
    assert.deepEqual(titleCredit(song('Ft. Lauderdale', 'Band')), {
      title: 'Ft. Lauderdale',
      featuring: null,
      version: null,
    })
    assert.equal(artistCredit({ artist: 'feat. Rihanna', isMaster: true }).name, 'feat. Rihanna')
  })

  it('does not read `with` as a credit', () => {
    assert.equal(titleCredit(song('One More Time (with Daft Punk)', 'Band')).featuring, null)
    assert.equal(titleCredit(song('Unchained Melody (with Orchestra)', 'Band')).featuring, null)
    assert.equal(titleCredit(song('Sing with the Choir', 'Band')).featuring, null)
  })

  it('keeps a title that is nothing but a credit', () => {
    assert.deepEqual(titleCredit(song('(feat. Rihanna)', 'Eminem')), {
      title: '(feat. Rihanna)',
      featuring: null,
      version: null,
    })
  })

  it('keeps every parenthetical that is not a credit', () => {
    assert.deepEqual(titleCredit(song('Song (feat. Guest) (Live)', 'Band')), {
      title: 'Song (Live)',
      featuring: '(feat. Guest)',
      version: null,
    })
    assert.deepEqual(titleCredit(song('Song feat. Guest (Live)', 'Band')), {
      title: 'Song (Live)',
      featuring: '(feat. Guest)',
      version: null,
    })
    assert.equal(titleCredit(song('Blurry (Autochart)', 'Puddle of Mudd')).title, 'Blurry (Autochart)')
  })

  it('never splits the names inside one credit', () => {
    // No separator distinguishes three guests from one band whose name has
    // commas in it, so the string after the marker is passed through whole.
    assert.equal(
      titleCredit(song('Song (feat. Earth, Wind & Fire)', 'Band')).featuring,
      '(feat. Earth, Wind & Fire)',
    )
    assert.equal(
      titleCredit(song('Song (feat. Tyler, The Creator)', 'Band')).featuring,
      '(feat. Tyler, The Creator)',
    )
  })

  it('is a no-op on the ordinary song, which is almost all of them', () => {
    assert.deepEqual(titleCredit(song('Through the Fire and Flames', 'DragonForce')), {
      title: 'Through the Fire and Flames',
      featuring: null,
      version: null,
    })
    assert.deepEqual(titleCredit(song('', '')), { title: '', featuring: null, version: null })
  })
})

describe('titleCredit — version notes', () => {
  it('takes a trailing version note off the title', () => {
    assert.deepEqual(titleCredit(song('Tom Sawyer (Original Version)', 'Rush')), {
      title: 'Tom Sawyer',
      featuring: null,
      version: '(Original Version)',
    })
  })

  it('matches however the charter capitalised it, and leaves the words alone', () => {
    // 34 charts in one real library write it exactly this way. Title-casing
    // `version` here would be inventing a spelling nobody typed.
    assert.equal(titleCredit(song('Mama Tried (RB3 version)', 'Merle Haggard')).version, '(RB3 version)')
    assert.equal(
      titleCredit(song('Through the Fire and Flames (RB4 Version)', 'DragonForce')).version,
      '(RB4 Version)',
    )
  })

  it('re-brackets, so one note does not arrive looking like two facts', () => {
    assert.equal(titleCredit(song('Long Time [Vocal Version]', 'Boston')).version, '(Vocal Version)')
  })

  it('takes only the last parenthetical, and only when it is the version', () => {
    assert.deepEqual(
      titleCredit(song('Party for Two (with Billy Currington) (RB3 version)', 'Shania Twain')),
      {
        title: 'Party for Two (with Billy Currington)',
        featuring: null,
        version: '(RB3 version)',
      },
    )
  })

  it('leaves every other trailing parenthetical alone', () => {
    // The same library's neighbours: 68 `(Live)`, 23 `(Co-op)`, 16
    // `(Autochart)` — and `(I Promise)`, which is half a title. Nothing in the
    // string tells a qualifier from a subtitle, so the rule stops at `Version`.
    for (const title of [
      'Enter Sandman (Live)',
      'Laid To Rest (Co-op)',
      'Blurry (Autochart)',
      'Old Town Road (Remix)',
      'Hymn for the Weekend (I Promise)',
    ]) {
      assert.equal(titleCredit(song(title, 'Band')).version, null, title)
      assert.equal(titleCredit(song(title, 'Band')).title, title, title)
    }
  })

  it('keeps a title that is nothing but a version note', () => {
    assert.deepEqual(titleCredit(song('(Original Version)', 'Band')), {
      title: '(Original Version)',
      featuring: null,
      version: null,
    })
  })

  it('does not fire on a title that merely contains the word', () => {
    assert.equal(titleCredit(song('The Version Control Blues', 'Band')).version, null)
    assert.equal(titleCredit(song('Version (Reprise)', 'Band')).version, null)
  })

  it('carries the credit and the note together, sleeve order', () => {
    assert.deepEqual(titleCredit(song('Long Time (Vocal Version)', 'Boston feat. Guest')), {
      title: 'Long Time',
      featuring: '(feat. Guest)',
      version: '(Vocal Version)',
    })
    assert.equal(
      formatTitleCredit(song('Long Time (Vocal Version)', 'Boston feat. Guest')),
      'Long Time (feat. Guest) (Vocal Version)',
    )
  })
})

describe('titleCredit — one credit, however many fields carried it', () => {
  it('says a guest named in both fields once', () => {
    assert.deepEqual(
      titleCredit(song('Love the Way You Lie (feat. Rihanna)', 'Eminem feat. Rihanna')),
      { title: 'Love the Way You Lie', featuring: '(feat. Rihanna)', version: null },
    )
  })

  it('keeps the fuller spelling when one credit contains the other', () => {
    assert.equal(
      titleCredit(song('Song (feat. Rihanna)', 'Eminem feat. Rihanna & Dr. Dre')).featuring,
      '(feat. Rihanna & Dr. Dre)',
    )
  })

  it('folds case and diacritics before calling two credits the same', () => {
    assert.equal(
      titleCredit(song('Song (feat. Beyoncé)', 'Jay-Z feat. beyonce')).featuring,
      '(feat. Beyoncé)',
    )
  })

  it('lists both when the two fields name different guests', () => {
    assert.equal(
      titleCredit(song('Song (feat. Rihanna)', 'Eminem feat. Dr. Dre')).featuring,
      '(feat. Rihanna, Dr. Dre)',
    )
  })

  it('collects more than one bracketed credit from a title', () => {
    assert.equal(
      titleCredit(song('Song (feat. A) [ft. B]', 'Band')).featuring,
      '(feat. A, B)',
    )
  })
})

describe('titleCredit — the case it is known to get wrong', () => {
  it('reads `Ft.` meaning Fort as a credit', () => {
    // The price of supporting the unbracketed abbreviation, which is how a real
    // library writes it far more often than it writes a place name mid-title.
    // Pinned so the trade-off stays a decision rather than a surprise.
    assert.deepEqual(titleCredit(song('Live from Ft. Worth', 'Band')), {
      title: 'Live from',
      featuring: '(feat. Worth)',
      version: null,
    })
  })
})

describe('formatTitleCredit', () => {
  it('is the title and its credit as one flat string', () => {
    assert.equal(
      formatTitleCredit(song('Love the Way You Lie', 'Eminem feat. Rihanna')),
      'Love the Way You Lie (feat. Rihanna)',
    )
    assert.equal(formatTitleCredit(song('Song', 'Band')), 'Song')
  })
})

describe('artistCredit', () => {
  it('bills the artist without the guests, so the row files under them', () => {
    assert.deepEqual(artistCredit({ artist: 'Eminem feat. Rihanna', isMaster: true }), {
      name: 'Eminem',
      madeFamousBy: false,
    })
    assert.equal(artistCredit({ artist: 'Nas f/Lauryn Hill', isMaster: true }).name, 'Nas')
  })

  it('still strips the cover house, and still says so', () => {
    assert.deepEqual(artistCredit({ artist: 'Blondie (WaveGroup)', isMaster: true }), {
      name: 'Blondie',
      madeFamousBy: true,
    })
    assert.deepEqual(artistCredit({ artist: 'Foo (WaveGroup Sound) (Live)', isMaster: true }), {
      name: 'Foo (Live)',
      madeFamousBy: true,
    })
  })

  it('handles a chart that is both a cover and a collaboration', () => {
    assert.deepEqual(
      artistCredit({ artist: 'Santana (WaveGroup) feat. Rob Thomas', isMaster: true }),
      { name: 'Santana', madeFamousBy: true },
    )
  })

  it('trusts the Master column when nothing else contradicts it', () => {
    assert.equal(artistCredit({ artist: 'Blondie', isMaster: false }).madeFamousBy, true)
    assert.equal(artistCredit({ artist: 'Blondie', isMaster: true }).madeFamousBy, false)
    assert.equal(artistCredit({ artist: '', isMaster: false }).madeFamousBy, false)
  })
})
