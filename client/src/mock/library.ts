/**
 * The demo library: a synthetic song list, generated in the browser.
 *
 * This exists so the app can be published as a static site — GitHub Pages has
 * no YARG install, no `songcache.bin` and no server to read one, so the demo
 * has to bring its own library. **Everything here is invented.** The band
 * names, album titles, song titles and charter handles are generated from word
 * banks; nothing is a real release and nothing is anybody's actual library.
 *
 * Two things are deliberately real, because they are the parts the UI resolves
 * rather than displays: the **source ids** are genuine OpenSource ids so the
 * badges in `lib/sources.ts` resolve to real icons, and the **genres** are the
 * names YARG's own Genrelizer produces, so the facet list reads like one. The
 * ids are restricted to YARG's own setlists and community/custom packs — no
 * Rock Band or Guitar Hero sources, since attributing invented songs to a
 * licensed catalogue would be a fabricated record rather than a demo.
 *
 * ## Everything is seeded
 *
 * One fixed seed drives the whole generator, so the library is byte-identical
 * on every load and in every browser. That is not tidiness — the app puts the
 * selected song's id in the address bar, so a link somebody copies out of the
 * demo has to still point at the same song tomorrow. A `Math.random()`
 * anywhere in here would break that quietly.
 *
 * Generated lazily, not at module scope, so a production build that never
 * calls it can drop the whole file. See `mock/index.ts`.
 */

import { INSTRUMENTS, NO_RATING, SONG_RATINGS } from '@shared/types'
import type { InstrumentKey, Song, SongFacets, SongFormat, SongLibrary } from '@shared/types'
import { sourceName } from '../lib/sources'

/** Changing this reshuffles the entire demo library. It is a public URL's anchor. */
const SEED = 0x59_41_53_53

/** Songs to generate. Enough that the list virtualizes and the jump rail earns its place. */
const TARGET_SONGS = 1_650

// --- Randomness -------------------------------------------------------------

/** mulberry32: small, fast, and identical across engines — which is the point. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

interface Rng {
  /** Float in [0, 1). */
  next: () => number
  /** Integer in [min, max]. */
  int: (min: number, max: number) => number
  /** One element, uniformly. */
  pick: <T>(items: readonly T[]) => T
  /** True with the given probability. */
  chance: (probability: number) => boolean
  /** One element, weighted towards the front — a Zipf-ish shape. */
  weighted: <T>(items: readonly T[]) => T
}

function makeRng(seed: number): Rng {
  const next = makeRandom(seed)

  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))

  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)] as never,
    chance: (probability) => next() < probability,
    // Squaring biases towards index 0, which is what makes a handful of packs
    // and charters dominate the library the way they do in a real one.
    weighted: (items) => items[Math.floor(next() ** 2.2 * items.length)] as never,
  }
}

/**
 * A 40-character uppercase hex id, derived from the song's own identity.
 *
 * YARG's hashes are SHA-1 over the chart; nothing here has a chart to hash, so
 * this is five rounds of FNV-1a over the song's key with different salts. What
 * matters is only that it looks like the real thing (the UI shows it, and the
 * art URLs are keyed by it) and that the same song always gets the same one.
 */
function fakeHash(key: string): string {
  let out = ''

  for (let round = 0; round < 5; round += 1) {
    let hash = 0x81_1c_9d_c5 ^ Math.imul(round + 1, 0x9e_37_79_b9)

    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index)
      hash = Math.imul(hash, 0x01_00_01_93)
    }

    out += (hash >>> 0).toString(16).padStart(8, '0')
  }

  return out.toUpperCase()
}

// --- Word banks -------------------------------------------------------------

const BAND_ADJECTIVES = [
  'Velvet',
  'Hollow',
  'Neon',
  'Paper',
  'Iron',
  'Quiet',
  'Static',
  'Golden',
  'Bitter',
  'Crooked',
  'Lunar',
  'Concrete',
  'Wired',
  'Salted',
  'Restless',
  'Amber',
  'Feral',
  'Marble',
  'Pale',
  'Rusted',
  'Distant',
  'Endless',
  'Copper',
  'Silent',
  'Frozen',
  'Broken',
  'Northern',
  'Electric',
]

const BAND_NOUNS = [
  'Lantern',
  'Meridian',
  'Harbour',
  'Divide',
  'Cathedral',
  'Anchor',
  'Signal',
  'Machine',
  'Compass',
  'Cartographer',
  'Aviary',
  'Foundry',
  'Kingdom',
  'Orchard',
  'Circuit',
  'Wolves',
  'Tides',
  'Engines',
  'Spires',
  'Lanterns',
  'Cities',
  'Astronauts',
  'Choir',
  'Reactor',
  'Vessel',
  'Almanac',
  'Corridor',
  'Aqueduct',
  'Filament',
  'Monolith',
]

/** Single-word names, built by welding two halves together. */
const BAND_STEMS_A = [
  'Null',
  'Iron',
  'Ash',
  'Glass',
  'Storm',
  'Moth',
  'Vault',
  'Hex',
  'Kilo',
  'Slate',
  'Fern',
  'Grav',
]
const BAND_STEMS_B = [
  'haven',
  'wake',
  'crest',
  'fall',
  'drift',
  'bloom',
  'shard',
  'song',
  'vector',
  'spine',
  'lark',
  'well',
]

const TITLE_NOUNS = [
  'Ash',
  'Amber',
  'Static',
  'Daylight',
  'Ceiling',
  'Undertow',
  'Foxglove',
  'Cartography',
  'Halogen',
  'Sawdust',
  'Perihelion',
  'Anthem',
  'Telegram',
  'Cathedrals',
  'Coastline',
  'Ivory',
  'Mercury',
  'Blueprints',
  'Lanterns',
  'Fever',
  'Gravity',
  'Antennae',
  'Ricochet',
  'Saltwater',
  'Aftermath',
  'Threadbare',
  'Kerosene',
  'Overgrowth',
  'Semaphore',
  'Tidewater',
  'Lighthouse',
  'Wolfsbane',
  'Paperweight',
  'Wintering',
  'Fallow',
  'Nocturne',
  'Vespers',
  'Sundial',
  'Firebreak',
  'Longitude',
]

const TITLE_ADJECTIVES = [
  'Hollow',
  'Bright',
  'Bitter',
  'Endless',
  'Quiet',
  'Crooked',
  'Molten',
  'Patient',
  'Reckless',
  'Threadbare',
  'Weightless',
  'Radiant',
  'Sunken',
  'Fractured',
  'Tidal',
  'Ferrous',
  'Distant',
  'Feral',
]

const TITLE_VERBS = [
  'Burning',
  'Falling',
  'Waiting',
  'Drifting',
  'Breaking',
  'Turning',
  'Holding',
  'Leaving',
  'Chasing',
  'Sinking',
  'Rising',
  'Counting',
]

const TITLE_PREPOSITIONS = ['in', 'under', 'above', 'without', 'against', 'beyond', 'through']

const ALBUM_NOUNS = [
  'Weather',
  'Machines',
  'Cartography',
  'Interiors',
  'Arrivals',
  'Fieldwork',
  'Parallax',
  'Postcards',
  'Inventory',
  'Migration',
  'Choreography',
  'Constellations',
  'Provisions',
  'Vestibule',
  'Almanac',
  'Aperture',
  'Sediment',
  'Telemetry',
  'Halcyon',
  'Groundwork',
  'Ephemera',
  'Waypoints',
  'Overtures',
  'Residue',
]

const ALBUM_ADJECTIVES = [
  'Slow',
  'Bright',
  'Late',
  'Minor',
  'Second',
  'Common',
  'Lesser',
  'Modern',
  'Hollow',
  'Total',
  'Small',
  'Wild',
]

/**
 * Charter handles.
 *
 * Invented, like everything else here. The field matters to the demo because
 * it is a facet and a sort key, and a library where every song was charted by
 * one person would show neither doing anything.
 */
const CHARTERS = [
  'quicksilver',
  'bramblecast',
  'harmonium',
  'pinecone',
  'ivy.t',
  'atlas_9',
  'noodlebark',
  'm.void',
  'copperline',
  'sundowner',
  'glasshouse',
  'kestrel',
  'lo-fi lodge',
  'tempest.wav',
  'ferrous',
  'nightjar',
  'paper.moth',
  'switchback',
  'oleander',
  'vantablack',
  'driftglass',
  'halcyonic',
]

/**
 * Source ids, restricted to YARG's own setlists and community/custom packs.
 *
 * Real ids from the OpenSource registry so the badges resolve to real icons —
 * see the note at the top of this file for why licensed catalogues are left
 * out. Order is the weighting: `rng.weighted` leans on the front, so the demo
 * library is mostly a few big community packs with a long tail, which is the
 * shape a real one has.
 */
const SOURCES = [
  'yarg',
  '$DEFAULT$',
  'custom',
  'yargdlc',
  'charts',
  'charts2',
  'comtpi',
  'comtpii',
  'comtpiii',
  'comtpiv',
  'comtp45',
  'comtpv',
  'antihero',
  'antihero2',
  'ahbe',
  'cth1',
  'cth2',
  'cth3',
  'fp',
  'fp2',
  'fp3',
  'guitarzero',
  'guitarzero2',
  'psh',
  'psh2',
  'dhc',
  'djenthero',
  'blackhole',
  'cb',
  'digi',
  'zerogravity',
  'zgsb',
  'synergy',
  'wcc',
  'scu',
  'encore',
  'creativech',
  'imetal',
  'ragequit',
  'marathon',
  'marathonhero2',
  'paradigm',
  'revolved',
  'vortex_hero',
  'fuse',
  'codered',
  'facelift',
  'ma',
  'bs',
  'csc',
  'a2z',
  'bitcrusher',
  'chillhanger',
  'emotion',
  'indp',
  'airheads',
  'lanebreakers',
  'zancharted',
  'rv',
  'yarn',
  'example',
  'meme',
]

/**
 * Folder names for loose customs, which is what a `$DEFAULT$` playlist holds.
 *
 * Everything from a pack takes the pack's own name — see where this is used.
 * These are the ones people name themselves, and they are named like that.
 */
const LOOSE_PLAYLISTS = ['', '', 'downloads', 'to sort', 'friday night', 'requests', 'new charts']

/**
 * Genre and subgenre, spelled the way YARG's Genrelizer spells them.
 *
 * Taken from the official genre list the Overgenrelizer buckets
 * (`server/src/core/genrelizer.broad.ts`), so the demo's facet list is the one
 * a real library produces. Subgenres are the specific names a charter would
 * have typed, which is exactly what the real pipeline keeps them for.
 *
 * **Ordered by how common they are in a real chart library**, because the pick
 * is weighted towards the front. A uniform pick gave all sixty an equal share,
 * which put Dubstep and Classical at the top of the genre facet — a list nobody
 * has ever had. Guitar games are mostly rock and metal, and the facet should say
 * so before it says anything else.
 */
const GENRES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Alternative', ['College Rock', 'Alternative Rock', '']],
  ['Indie Rock', ['Indie', 'Lo-fi', '']],
  ['Rock', ['Arena Rock', '']],
  ['Classic Rock', ['70s Rock', '']],
  ['Hard Rock', ['Blues Rock', '']],
  ['Progressive', ['Prog Rock', 'Prog Metal', 'Avant-Garde']],
  ['Math Rock', ['Post-Rock', '']],
  ['Post-Hardcore', ['Screamo', '']],
  ['Metalcore', ['Melodic Metalcore', 'Deathcore']],
  ['Heavy Metal', ['NWOBHM', 'Traditional Metal', '']],
  ['Melodic/Power Metal', ['Power Metal', 'Symphonic Metal']],
  ['Thrash/Speed Metal', ['Thrash', 'Speed Metal']],
  ['Death/Black Metal', ['Melodic Death Metal', 'Black Metal', 'Technical Death Metal']],
  ['Djent', ['Progressive Metal', '']],
  ['Groove Metal', ['', 'Sludge']],
  ['Doom Metal', ['Stoner Metal', '']],
  ['Grindcore', ['Powerviolence', '']],
  ['Nu-Metal', ['Rap Metal', '']],
  ['Punk', ['Hardcore Punk', 'Skate Punk', '']],
  ['Pop-Punk', ['Easycore', '']],
  ['Emo', ['Midwest Emo', 'Emo Revival']],
  ['Grunge', ['', 'Post-Grunge']],
  ['Industrial', ['Industrial Metal', 'EBM']],
  ['Psychedelic', ['Psych Rock', 'Space Rock']],
  ['Surf Rock', ['', 'Instrumental Surf']],
  ['New Wave', ['Post-Punk', 'Darkwave']],
  ['Glam', ['Glam Metal', '']],
  ['Pop', ['Dance-Pop', 'Art Pop', '']],
  ['Pop-Rock', ['Power Pop', '']],
  ['Synthpop/Electropop', ['Synthwave', 'Chillwave']],
  ['Ballad', ['Piano Ballad', '']],
  ['Electronic', ['IDM', 'Breakcore', 'Electro']],
  ['House', ['Deep House', 'French House']],
  ['Techno', ['Minimal', '']],
  ['Trance', ['Uplifting Trance', '']],
  ['Dubstep', ['Riddim', 'Melodic Dubstep']],
  ['Hardcore EDM', ['Happy Hardcore', 'Hardstyle']],
  ['DnB/Breakbeat/Jungle', ['Liquid DnB', 'Neurofunk']],
  ['Chiptune', ['Bitpop', '8-bit']],
  ['Ambient/Drone', ['Dark Ambient', '']],
  ['Hip-Hop/Rap', ['Boom Bap', 'Alternative Hip-Hop']],
  ['R&B/Soul/Funk', ['Neo-Soul', 'Funk']],
  ['Disco', ['Nu-Disco', '']],
  ['Jazz', ['Big Band', 'Bebop', '']],
  ['Fusion', ['Jazz Fusion', '']],
  ['Blues', ['Electric Blues', 'Delta Blues']],
  ['Country', ['Alt-Country', 'Bluegrass']],
  ['Folk', ['Folk Rock', 'Freak Folk', '']],
  ['Ska', ['Ska Punk', 'Two-Tone']],
  ['Reggae', ['Dub', '']],
  ['Latin', ['Cumbia', 'Bossa Nova']],
  ['J-Rock', ['Visual Kei', '']],
  ['J-Pop', ['City Pop', '']],
  ['K-Pop', ['', 'K-Rock']],
  ['World', ['Afrobeat', 'Balkan']],
  ['Soundtrack', ['Video Game', 'Film Score']],
  ['Orchestral', ['Neoclassical', '']],
  ['Classical', ['Baroque', 'Romantic']],
]

/**
 * Which parts a band's charts tend to have.
 *
 * The instrument grid is the densest thing in the detail pane and the "what can
 * I play" filter is the whole reason the app has facets, so the demo has to
 * contain charts that genuinely differ: full-band charts with harmonies, and
 * guitar-only ones with no drums at all, which is most of what a community
 * library actually holds.
 */
const PART_PROFILES = [
  { weight: 34, groups: ['guitar', 'bass', 'drums', 'vocals'], pro: false, sixFret: false },
  { weight: 22, groups: ['guitar', 'bass', 'drums', 'vocals', 'keys'], pro: false, sixFret: false },
  { weight: 16, groups: ['guitar', 'bass'], pro: false, sixFret: false },
  { weight: 10, groups: ['guitar'], pro: false, sixFret: false },
  { weight: 8, groups: ['guitar', 'bass', 'drums'], pro: false, sixFret: true },
  { weight: 6, groups: ['guitar', 'bass', 'drums', 'vocals', 'keys'], pro: true, sixFret: false },
  { weight: 4, groups: ['drums'], pro: false, sixFret: false },
] as const

type PartProfile = (typeof PART_PROFILES)[number]

const FORMATS: ReadonlyArray<readonly [SongFormat, number]> = [
  ['Sng', 62],
  ['Ini', 28],
  ['CON', 7],
  ['ExCON', 3],
]

// --- Naming -----------------------------------------------------------------

function bandName(rng: Rng): string {
  switch (rng.int(0, 3)) {
    case 0:
      return `${rng.pick(BAND_ADJECTIVES)} ${rng.pick(BAND_NOUNS)}`
    case 1:
      return `The ${rng.pick(BAND_ADJECTIVES)} ${rng.pick(BAND_NOUNS)}`
    case 2:
      return `${rng.pick(BAND_STEMS_A)}${rng.pick(BAND_STEMS_B)}`
    default:
      return `${rng.pick(BAND_NOUNS)} ${rng.pick(BAND_NOUNS)}`
  }
}

function songTitle(rng: Rng): string {
  switch (rng.int(0, 5)) {
    case 0:
      return `${rng.pick(TITLE_ADJECTIVES)} ${rng.pick(TITLE_NOUNS)}`
    case 1:
      return `${rng.pick(TITLE_NOUNS)} ${rng.pick(TITLE_PREPOSITIONS)} ${rng.pick(TITLE_NOUNS)}`
    case 2:
      return `${rng.pick(TITLE_VERBS)} ${rng.pick(TITLE_PREPOSITIONS)} ${rng.pick(TITLE_NOUNS)}`
    case 3:
      return rng.pick(TITLE_NOUNS)
    case 4:
      return `${rng.pick(TITLE_NOUNS)} & ${rng.pick(TITLE_NOUNS)}`
    default:
      return `All the ${rng.pick(TITLE_ADJECTIVES)} ${rng.pick(TITLE_NOUNS)}`
  }
}

function albumTitle(rng: Rng, artist: string): string {
  switch (rng.int(0, 4)) {
    case 0:
      return `${rng.pick(ALBUM_ADJECTIVES)} ${rng.pick(ALBUM_NOUNS)}`
    case 1:
      return rng.pick(ALBUM_NOUNS)
    case 2:
      return `${rng.pick(ALBUM_NOUNS)} ${roman(rng.int(2, 4))}`
    case 3:
      // Self-titled, which is a real thing albums do and a useful case for the
      // album column: it repeats the artist beside it.
      return artist
    default:
      return `The ${rng.pick(ALBUM_ADJECTIVES)} ${rng.pick(ALBUM_NOUNS)}`
  }
}

function roman(value: number): string {
  return ['I', 'II', 'III', 'IV', 'V'][value - 1] ?? String(value)
}

// --- Generation -------------------------------------------------------------

function pickProfile(rng: Rng): PartProfile {
  const total = PART_PROFILES.reduce((sum, profile) => sum + profile.weight, 0)
  let roll = rng.next() * total

  for (const profile of PART_PROFILES) {
    roll -= profile.weight
    if (roll <= 0) return profile
  }

  return PART_PROFILES[0]
}

function pickFormat(rng: Rng): SongFormat {
  const total = FORMATS.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = rng.next() * total

  for (const [format, weight] of FORMATS) {
    roll -= weight
    if (roll <= 0) return format
  }

  return 'Sng'
}

/**
 * A song's twenty-one difficulty tiers.
 *
 * Built from the band's profile and its own intensity rather than rolled per
 * instrument, because the difficulty ring, the intensity filter and the lens
 * picker are all reading these — and a library where a song's drums and guitar
 * were unrelated numbers would make every one of those look like noise.
 */
function difficultiesFor(
  rng: Rng,
  profile: PartProfile,
  intensity: number,
  harmonies: number,
): { difficulties: Record<InstrumentKey, number | null>; band: number | null } {
  const difficulties = {} as Record<InstrumentKey, number | null>
  const present: number[] = []

  const tier = (offset: number) =>
    Math.min(6, Math.max(0, Math.round(intensity + offset + (rng.next() - 0.5) * 1.4)))

  for (const instrument of INSTRUMENTS) {
    difficulties[instrument.key] = null
  }

  const has = (group: string) => (profile.groups as readonly string[]).includes(group)

  if (has('guitar')) {
    difficulties.guitar5 = tier(0)
    if (rng.chance(0.18)) difficulties.rhythm5 = tier(-0.5)
    if (rng.chance(0.22)) difficulties.coop5 = tier(0)
  }
  if (has('bass')) difficulties.bass5 = tier(-0.8)
  if (has('drums')) {
    difficulties.drums4 = tier(-0.2)
    if (rng.chance(0.75)) difficulties.proDrums = tier(0.2)
    if (rng.chance(0.12)) difficulties.drums5 = tier(-0.2)
    if (rng.chance(0.05)) difficulties.eliteDrums = tier(0.5)
  }
  if (has('keys')) difficulties.keys = tier(-0.4)
  if (has('vocals')) {
    difficulties.vocals = tier(-0.6)
    if (harmonies > 1) difficulties.harmony = tier(-0.4)
  }

  if (profile.sixFret) {
    difficulties.guitar6 = tier(0)
    if (has('bass')) difficulties.bass6 = tier(-0.8)
  }

  if (profile.pro) {
    difficulties.proGuitar17 = tier(0.6)
    difficulties.proGuitar22 = difficulties.proGuitar17
    difficulties.proBass17 = tier(-0.4)
    difficulties.proBass22 = difficulties.proBass17
    if (has('keys')) difficulties.proKeys = tier(0.3)
  }

  for (const instrument of INSTRUMENTS) {
    const value = difficulties[instrument.key]
    if (value !== null) present.push(value)
  }

  // "Present but untiered" is a real state — YARG writes 0 for it — and the
  // ring has a rendering for it, so some songs should have it.
  if (rng.chance(0.04)) difficulties.guitar5 = difficulties.guitar5 === null ? null : 0

  const band =
    present.length === 0
      ? null
      : Math.min(6, Math.max(1, Math.round(present.reduce((a, b) => a + b, 0) / present.length)))

  return { difficulties, band }
}

/** Tally a column into descending-count buckets — the server's `tally`, ported. */
function tally(values: readonly string[]) {
  const counts = new Map<string, number>()

  for (const value of values) {
    if (value === '') continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

function buildFacets(songs: readonly Song[]): SongFacets {
  const years = songs.map((song) => song.yearNumber).filter((year): year is number => year !== null)
  const lengths = songs
    .map((song) => song.lengthSeconds)
    .filter((length): length is number => length !== null)

  return {
    sources: tally(songs.map((song) => song.source)),
    genres: tally(songs.map((song) => song.genre)),
    charters: tally(songs.map((song) => song.charter)),
    formats: tally(songs.map((song) => song.format)),
    playlists: tally(songs.map((song) => song.playlist)),
    yearRange: years.length === 0 ? null : { min: Math.min(...years), max: Math.max(...years) },
    lengthRange:
      lengths.length === 0 ? null : { min: Math.min(...lengths), max: Math.max(...lengths) },
  }
}

/**
 * Build the whole demo library.
 *
 * Songs are generated album by album under an artist, which is what makes the
 * artist sort read as a body of work: consecutive track numbers, one year, one
 * pack, one charter. Scattering the same fields randomly across 1,650 rows
 * would produce a list that no sort could make sense of.
 */
export function buildMockLibrary(): SongLibrary {
  const rng = makeRng(SEED)
  const songs: Song[] = []
  const usedIds = new Set<string>()
  const usedArtists = new Set<string>()

  while (songs.length < TARGET_SONGS) {
    const artist = bandName(rng)

    // The name banks make thousands of combinations but the generator draws a
    // few hundred names from them, so collisions happen — and a collision is
    // not one band with two albums, it is two bands the artist sort would merge
    // into one heading with two genres and two charters under it.
    if (usedArtists.has(artist)) continue
    usedArtists.add(artist)

    const [genre, subgenres] = rng.weighted(GENRES)
    const subgenre = rng.pick(subgenres)
    const profile = pickProfile(rng)

    /** How hard this band charts, before per-song and per-part jitter. */
    const intensity = rng.next() * 4.2 + 1.4
    const harmonies = (profile.groups as readonly string[]).includes('vocals')
      ? rng.chance(0.28)
        ? rng.int(2, 3)
        : 1
      : 0

    const source = rng.weighted(SOURCES)
    const charter = rng.weighted(CHARTERS)

    /** Bands that write long songs write them on every album. */
    const longform = rng.chance(0.06)

    /**
     * How much of this band a library holds.
     *
     * Weighted to one album, because a chart library is not a record
     * collection: a pack picks two or three songs off a record and moves on, and
     * only the discography packs carry the whole thing. Four albums each was
     * giving 1,650 songs to ninety bands — eighteen apiece, which made the
     * artist sort a list of ninety headings instead of a library.
     */
    const albums = rng.weighted([1, 1, 1, 2, 2, 3])

    for (let albumIndex = 0; albumIndex < albums && songs.length < TARGET_SONGS; albumIndex += 1) {
      const album = albumTitle(rng, artist)
      const yearNumber = rng.int(1971, 2025)
      // Usually a handful of tracks — what a pack takes off a record. The other
      // third of the time the whole thing was charted.
      const tracks = rng.chance(0.34) ? rng.int(6, 12) : rng.int(1, 5)
      // Per album, not per song: a pack is packaged once, so every chart in it
      // is the same container. A library with `.sng` and CON tracks alternating
      // inside one album would be a shape no real one has.
      const format = pickFormat(rng)

      for (let track = 1; track <= tracks && songs.length < TARGET_SONGS; track += 1) {
        const name = songTitle(rng)
        const id = fakeHash(`${artist} ${album} ${name} ${track}`)

        // Two identical hashes would give the two songs the same cover and make
        // one of them unreachable by link. Cheap to check, so check.
        if (usedIds.has(id)) continue
        usedIds.add(id)

        const { difficulties, band } = difficultiesFor(rng, profile, intensity, harmonies)

        songs.push({
          id,
          hash: id,
          // A credit in the title is the case `formatTitleCredit` exists for.
          name: rng.chance(0.05) ? `${name} (ft. ${bandName(rng)})` : name,
          artist,
          album,
          genre,
          subgenre,
          charter,
          /*
           * The folder the chart sits in, which is what YARG reads a playlist
           * from — so for anything out of a pack it is the pack, spelled the way
           * the registry spells it rather than the way the id does. Loose
           * customs get whatever their owner called the folder, and often
           * nothing at all.
           */
          playlist:
            source === '$DEFAULT$' || source === 'custom'
              ? rng.pick(LOOSE_PLAYLISTS)
              : sourceName(source),
          source,
          // The raw string as authored, which is the one a remaster's parenthetical
          // survives in — and the reason `yearNumber` is carried beside it.
          year: rng.chance(0.06)
            ? `${yearNumber} (${yearNumber + rng.int(8, 22)} Remaster)`
            : `${yearNumber}`,
          yearNumber,
          /*
           * Skewed short, with a tail.
           *
           * A uniform draw put a fifth of the library over seven minutes, which
           * made the length filter's four buckets look like they were cut at the
           * wrong places. Raising a uniform roll to a power moves the mass down
           * to where songs actually are — two to four minutes — and leaves the
           * long ones to the bands that write them.
           */
          lengthSeconds: rng.chance(0.02)
            ? null
            : longform && rng.chance(0.3)
              ? rng.int(600, 1_500)
              : Math.round(112 + 400 * rng.next() ** 1.7),
          albumTrack: rng.chance(0.04) ? null : track,
          // A cover, credited to the band that recorded it — the other half of
          // what the title/artist credit formatting is for.
          isMaster: !rng.chance(0.09),
          ageRating: rng.chance(0.14)
            ? rng.chance(0.4)
              ? NO_RATING
              : rng.pick(SONG_RATINGS.slice(1))
            : SONG_RATINGS[0],
          vocalParts: harmonies,
          difficulties,
          bandDifficulty: band,
          format,
          // Every song gets a procedural cover; see `mock/art.ts`.
          hasArt: true,
          // No audio ships with the demo, and a mock that synthesised tones
          // would be worse than silence. The sound control hides itself when
          // nothing in the library has a preview, which is the honest state for
          // a server with no ffmpeg — see `App.tsx`.
          hasPreview: false,
        })
      }
    }
  }

  return {
    songs,
    facets: buildFacets(songs),
    meta: {
      source: 'cache',
      // Fixed rather than "now": the value is rendered, and a demo whose
      // library was scanned three milliseconds ago reads as a bug.
      generatedAt: Date.UTC(2026, 7, 12, 19, 4),
      count: songs.length,
      warnings: [],
    },
  }
}
