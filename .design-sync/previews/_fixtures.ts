/**
 * Song fixtures for the preview cards.
 *
 * Not a component — the leading underscore keeps it out of the way, and the
 * converter enumerates previews by component name, so nothing here is mistaken
 * for a card.
 *
 * **Everything invented here follows `client/src/mock/library.ts`'s rule**, and
 * for its reason: song, artist and album names are made up, while the *source
 * ids* are genuine OpenSource ones restricted to YARG's own setlists and
 * community packs. Attaching an invented song to a licensed catalogue would
 * read as a fabricated record of a real release rather than as sample data.
 * `SourceBadge`'s own card is the one place a licensed id appears, and there it
 * renders the registry entry alone — no invented song is attributed to it.
 *
 * Difficulties are `0..6`, or `null` where the instrument is absent — which is
 * the distinction most of these components exist to draw.
 */

import type { Song } from '@shared/types'

/** Every instrument absent; spread over it to name only what a chart charts. */
const NO_PARTS: Song['difficulties'] = {
  guitar5: null,
  bass5: null,
  rhythm5: null,
  coop5: null,
  keys: null,
  guitar6: null,
  bass6: null,
  rhythm6: null,
  coop6: null,
  drums4: null,
  proDrums: null,
  drums5: null,
  eliteDrums: null,
  proGuitar17: null,
  proGuitar22: null,
  proBass17: null,
  proBass22: null,
  proKeys: null,
  vocals: null,
  harmony: null,
}

const BASE: Song = {
  id: 'PREVIEW0000000000000000000000000000000001',
  hash: 'PREVIEW0000000000000000000000000000000001',
  name: 'Hollow Transmission',
  artist: 'The Paper Aviators',
  album: 'Signal Fires',
  genre: 'Rock',
  subgenre: 'Alternative',
  charter: 'yarg-charts',
  playlist: '',
  source: 'yarg',
  year: '2019',
  yearNumber: 2019,
  lengthSeconds: 243,
  albumTrack: 4,
  isMaster: true,
  ageRating: 'No Rating',
  vocalParts: 1,
  difficulties: { ...NO_PARTS, guitar5: 4, bass5: 3, drums4: 4, proDrums: 4, vocals: 3 },
  bandDifficulty: 4,
  format: 'Sng',
  hasArt: false,
  hasPreview: false,
}

export const makeSong = (over: Partial<Song> = {}): Song => ({ ...BASE, ...over })

/** A full band chart, mid difficulty — the ordinary case a row usually shows. */
export const FULL_BAND = makeSong()

/** Every family charted, at the ceiling. Drives the red tier in the rings. */
export const EXPERT = makeSong({
  id: 'PREVIEW0000000000000000000000000000000002',
  hash: 'PREVIEW0000000000000000000000000000000002',
  name: 'Vaultbreaker',
  artist: 'Nine Volt Hymn',
  album: 'Torque',
  genre: 'Metal',
  subgenre: 'Progressive',
  source: 'yargdlc',
  year: '2023',
  yearNumber: 2023,
  lengthSeconds: 402,
  vocalParts: 3,
  difficulties: {
    ...NO_PARTS,
    guitar5: 6,
    bass5: 6,
    drums4: 6,
    proDrums: 6,
    keys: 5,
    proKeys: 5,
    vocals: 6,
    harmony: 6,
  },
  bandDifficulty: 6,
})

/** Guitar and vocals only — the gaps are the point, not an omission. */
export const SPARSE = makeSong({
  id: 'PREVIEW0000000000000000000000000000000003',
  hash: 'PREVIEW0000000000000000000000000000000003',
  name: 'Kitchen Radio (Acoustic Version)',
  artist: 'Marguerite Vale',
  album: 'Low Ceilings',
  genre: 'Folk',
  subgenre: '',
  source: '$DEFAULT$',
  charter: 'anonymous',
  year: '2015',
  yearNumber: 2015,
  lengthSeconds: 176,
  isMaster: false,
  vocalParts: 1,
  difficulties: { ...NO_PARTS, guitar5: 2, vocals: 2 },
  bandDifficulty: 2,
  format: 'Ini',
})

/**
 * A long title carrying both asides at once, plus an untiered part.
 *
 * `SongTitle` pulls `(feat. …)` and `(Live …)` out of the name and sets them
 * quieter, and a `0` difficulty means charted-but-unrated — the two cases most
 * likely to look broken if a component gets them wrong.
 */
export const LONG_TITLE = makeSong({
  id: 'PREVIEW0000000000000000000000000000000004',
  hash: 'PREVIEW0000000000000000000000000000000004',
  name: 'Everything We Left at the Station (feat. Junie Okafor) (Live at Wintergarden)',
  artist: 'Brassneck Union',
  album: 'Night Freight',
  genre: 'Soul',
  subgenre: 'Neo-Soul',
  source: 'yarg',
  year: '2021 (remaster)',
  yearNumber: 2021,
  lengthSeconds: 511,
  vocalParts: 2,
  difficulties: { ...NO_PARTS, guitar5: 3, bass5: 0, drums4: 4, keys: 3, vocals: 5, harmony: 5 },
  bandDifficulty: 4,
})

/**
 * A guest credit short enough to sit inline without truncating.
 *
 * `LONG_TITLE` carries the same asides but overflows a list-width cell, so it
 * proves what truncation looks like rather than what a dimmed aside looks like.
 */
export const FEATURED = makeSong({
  id: 'PREVIEW0000000000000000000000000000000006',
  hash: 'PREVIEW0000000000000000000000000000000006',
  name: 'Wire and Wolves (feat. Junie Okafor)',
  artist: 'Brassneck Union',
  album: 'Night Freight',
  genre: 'Soul',
  year: '2021',
  yearNumber: 2021,
  lengthSeconds: 227,
})

/**
 * The same credit, filed in the *artist* field instead of the title.
 *
 * Libraries do this inconsistently, so `titleCredit` reads both fields and
 * moves the guest onto the title either way — which also keeps the row sorted
 * under `Brassneck Union` rather than opening a second header for one track.
 */
export const ARTIST_CREDIT = makeSong({
  id: 'PREVIEW0000000000000000000000000000000007',
  hash: 'PREVIEW0000000000000000000000000000000007',
  name: 'Wire and Wolves',
  artist: 'Brassneck Union feat. Junie Okafor',
  album: 'Night Freight',
  genre: 'Soul',
  year: '2021',
  yearNumber: 2021,
  lengthSeconds: 227,
})

/** Instrumental, no vocals charted at all. */
export const INSTRUMENTAL = makeSong({
  id: 'PREVIEW0000000000000000000000000000000005',
  hash: 'PREVIEW0000000000000000000000000000000005',
  name: 'Meridian Drift',
  artist: 'Cassette Ghost',
  album: 'Blue Hour',
  genre: 'Electronic',
  subgenre: 'Ambient',
  source: 'yargdlc',
  year: '2020',
  yearNumber: 2020,
  lengthSeconds: 328,
  vocalParts: 0,
  difficulties: { ...NO_PARTS, guitar5: 3, bass5: 3, drums4: 3, keys: 4, proKeys: 4 },
  bandDifficulty: 3,
})
