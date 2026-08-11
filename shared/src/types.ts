/**
 * Types shared between the server and the client.
 *
 * Everything here describes the *wire* shape. Notably absent: filesystem paths.
 * `currentSong.json` exposes `ActualLocation` / `SortBasedLocation`, which leak
 * the user's Windows username — those are resolved server-side and never sent.
 */

/**
 * The instruments carried by YARG's CSV export, in export column order.
 *
 * Keys are ours; `csvHeader` is the exact column name YARG writes, which is how
 * the loader matches them (position is not relied on).
 */
export const INSTRUMENTS = [
  { key: 'guitar5', label: 'Guitar', csvHeader: 'Guitar (5-Fret) Difficulty', group: 'guitar' },
  { key: 'bass5', label: 'Bass', csvHeader: 'Bass (5-Fret) Difficulty', group: 'bass' },
  { key: 'rhythm5', label: 'Rhythm', csvHeader: 'Rhythm (5-Fret) Difficulty', group: 'guitar' },
  { key: 'coop5', label: 'Co-op', csvHeader: 'Co-op (5-Fret) Difficulty', group: 'guitar' },
  { key: 'keys', label: 'Keys', csvHeader: 'Keys Difficulty', group: 'keys' },
  { key: 'guitar6', label: 'Guitar (6)', csvHeader: 'Guitar (6-Fret) Difficulty', group: 'guitar' },
  { key: 'bass6', label: 'Bass (6)', csvHeader: 'Bass (6-Fret) Difficulty', group: 'bass' },
  { key: 'rhythm6', label: 'Rhythm (6)', csvHeader: 'Rhythm (6-Fret) Difficulty', group: 'guitar' },
  { key: 'coop6', label: 'Co-op (6)', csvHeader: 'Co-op (6-Fret) Difficulty', group: 'guitar' },
  { key: 'drums4', label: 'Drums', csvHeader: 'Drums (4-Lane) Difficulty', group: 'drums' },
  { key: 'proDrums', label: 'Pro Drums', csvHeader: 'Pro Drums Difficulty', group: 'drums' },
  { key: 'drums5', label: 'Drums (5)', csvHeader: 'Drums (5-Lane) Difficulty', group: 'drums' },
  { key: 'eliteDrums', label: 'Elite Drums', csvHeader: 'Elite Drums Difficulty', group: 'drums' },
  { key: 'proGuitar17', label: 'Pro Guitar', csvHeader: 'Pro Guitar (17-Fret) Difficulty', group: 'guitar' },
  { key: 'proGuitar22', label: 'Pro Guitar (22)', csvHeader: 'Pro Guitar (22-Fret) Difficulty', group: 'guitar' },
  { key: 'proBass17', label: 'Pro Bass', csvHeader: 'Pro Bass (17-Fret) Difficulty', group: 'bass' },
  { key: 'proBass22', label: 'Pro Bass (22)', csvHeader: 'Pro Bass (22-Fret) Difficulty', group: 'bass' },
  { key: 'proKeys', label: 'Pro Keys', csvHeader: 'Pro Keys Difficulty', group: 'keys' },
  { key: 'vocals', label: 'Vocals', csvHeader: 'Vocals Difficulty', group: 'vocals' },
  { key: 'harmony', label: 'Harmony', csvHeader: 'Harmony Difficulty', group: 'vocals' },
] as const

export type InstrumentKey = (typeof INSTRUMENTS)[number]['key']
export type InstrumentGroup = (typeof INSTRUMENTS)[number]['group']

/** The five instrument groups, for the compact "what can I play" filter. */
export const INSTRUMENT_GROUPS: readonly InstrumentGroup[] = [
  'guitar',
  'bass',
  'drums',
  'keys',
  'vocals',
]

/** Chart container format — YARG's `EntryType`. */
export type SongFormat = 'Ini' | 'Sng' | 'ExCON' | 'CON' | 'Unknown'

/**
 * One song in the library.
 *
 * Difficulty values are `null` when the instrument is absent (YARG writes `-1`)
 * and `0..6` otherwise, where `0` can also mean "present but untiered".
 */
export interface Song {
  /** Stable identity: canonical uppercase-hex hash when available, else a synthetic key. */
  id: string
  /** Canonical uppercase hex (40 chars), or null if the source had no hash. */
  hash: string | null

  name: string
  artist: string
  album: string
  genre: string
  subgenre: string
  charter: string
  playlist: string
  /** Raw source id, e.g. `rb3dlc`, `$DEFAULT$`. */
  source: string

  /** Raw year string as authored, e.g. `1984 (remaster)`. May be empty. */
  year: string
  /** Parsed leading year, or null when unparsable. */
  yearNumber: number | null

  /** Song length in seconds, or null when the source omitted it. */
  lengthSeconds: number | null

  isMaster: boolean
  /** Display string: `No Rating`, `Family Friendly`, `Mature`, … */
  ageRating: string
  /** 0 instrumental, 1 solo, 2-3 harmonies. */
  vocalParts: number

  difficulties: Record<InstrumentKey, number | null>
  bandDifficulty: number | null

  format: SongFormat
}

/** Aggregate facets for the filter UI, computed once when the index loads. */
export interface SongFacets {
  sources: FacetCount[]
  genres: FacetCount[]
  charters: FacetCount[]
  formats: FacetCount[]
  playlists: FacetCount[]
  yearRange: { min: number; max: number } | null
  lengthRange: { min: number; max: number } | null
}

export interface FacetCount {
  value: string
  count: number
}

/** What `GET /api/songs` returns. */
export interface SongLibrary {
  songs: Song[]
  facets: SongFacets
  /** Where the index came from, surfaced so the UI can explain staleness. */
  meta: LibraryMeta
}

export interface LibraryMeta {
  /** `csv` today; `yarg-index` once YARG publishes its own index. */
  source: 'csv' | 'yarg-index' | 'none'
  /** Epoch ms of the source file's mtime — the staleness signal. */
  generatedAt: number | null
  count: number
  /** Non-fatal problems from the last load (bad rows, missing columns). */
  warnings: string[]
}

/**
 * The currently playing song.
 *
 * `playing: false` covers both "YARG is in menus" (the file is blank) and
 * "YARG isn't running". Path fields are deliberately not included.
 */
export interface NowPlaying {
  playing: boolean
  song: NowPlayingSong | null
  /** Epoch ms this state was observed. */
  updatedAt: number
}

export interface NowPlayingSong {
  /** Canonical uppercase hex, converted from the base64 the JSON carries. */
  hash: string | null
  /** Matching `Song.id` from the library, when the hash joins. */
  libraryId: string | null

  name: string
  artist: string
  album: string
  genre: string
  charter: string
  source: string
  year: string

  lengthSeconds: number | null
  bandDifficulty: number | null
  vocalsCount: number
  isMaster: boolean
  albumTrack: number | null

  /** True when album art was found next to the chart; fetch it from /api/art/current. */
  hasArt: boolean
}

/** User-editable settings. */
export interface Settings {
  /**
   * YARG's persistent data directory — the folder holding `currentSong.json`.
   * Defaults per-OS with the `release` channel, but YARG can be launched with
   * `-persistent-data-path`, so this must stay user-configurable.
   */
  yargDataDir: string
  /** Path to the CSV export produced by YARG's Settings → Export Songs List. */
  songListCsvPath: string
  /** How often to re-read `currentSong.json`, in ms. */
  pollIntervalMs: number
  /** Bind address. `0.0.0.0` exposes on the LAN; `127.0.0.1` keeps it local. */
  host: string
  port: number
}

/**
 * What `GET /api/status` returns.
 *
 * Host-only, and written for the tray: it answers "is this thing up, what is it
 * bound to, and did it load the songs" in one request, so the popover can be
 * filled from a single poll.
 */
export interface ServerStatus {
  /** The library as last loaded — count, warnings and the export's timestamp. */
  songs: LibraryMeta
  /** The address actually bound, which the saved settings may have moved past. */
  host: string
  port: number
  /** True when the saved host/port no longer match the bound ones. */
  restartRequired: boolean
}

/** Settings plus read-only context the UI needs to render the settings screen. */
export interface SettingsView {
  /** The effective values — the settings file with environment overrides applied. */
  settings: Settings
  /**
   * Fields currently forced by an environment variable. Editing these has no
   * effect until the variable is unset, and they are never written to the file.
   */
  envOverrides: Array<keyof Settings>
  /** Platform default for `yargDataDir`, shown as a hint. */
  defaultYargDataDir: string
  /** Per-path existence checks so the UI can flag a bad configuration. */
  status: {
    yargDataDirExists: boolean
    currentSongJsonExists: boolean
    songListCsvExists: boolean
  }
}

// --- Venue lighting ---------------------------------------------------------

/**
 * YARG's venue lighting cues, indexed by the byte the data stream sends.
 *
 * Position is the wire value, so this array *is* the decode table — do not
 * reorder it. Taken from `LightingEvent.cs` in the YARG source; YALCY reads the
 * same byte from the same offset.
 *
 * `chorus` and `verse` never appear here in practice: YARG diverts them into
 * the song-section field instead. Neither do the `strobe*` values, which are
 * only ever written to the strobe field. They are listed because the byte is a
 * single enum and an index has to line up.
 */
export const LIGHTING_CUES = [
  'default',
  'dischord',
  'chorus',
  'coolManual',
  'stomp',
  'verse',
  'warmManual',
  'bigRockEnding',
  'blackoutFast',
  'blackoutSlow',
  'blackoutSpotlight',
  'coolAutomatic',
  'flareFast',
  'flareSlow',
  'frenzy',
  'intro',
  'harmony',
  'silhouettes',
  'silhouettesSpotlight',
  'searchlights',
  'strobeFastest',
  'strobeFast',
  'strobeMedium',
  'strobeSlow',
  'strobeOff',
  'sweep',
  'warmAutomatic',
  'keyframeFirst',
  'keyframeNext',
  'keyframePrevious',
  'menu',
  'score',
  'noCue',
] as const

export type LightingCue = (typeof LIGHTING_CUES)[number]

/**
 * YARG's camera colour grades, indexed by the byte the data stream sends.
 *
 * Same rule as above: position is the wire value. From `PostProcessingEvent.cs`.
 * These are real screen filters in the game — `contrastRed` tints the venue red,
 * `blackAndWhite` drains it — which makes this the most literal answer to "what
 * colour is the stage right now".
 */
export const POST_PROCESSING = [
  'default',
  'bloom',
  'bright',
  'contrast',
  'posterize',
  'photoNegative',
  'mirror',
  'blackAndWhite',
  'sepiaTone',
  'silverTone',
  'choppyBlackAndWhite',
  'photoNegativeRedAndBlack',
  'polarizedBlackAndWhite',
  'polarizedRedAndBlue',
  'desaturatedBlue',
  'desaturatedRed',
  'contrastRed',
  'contrastGreen',
  'contrastBlue',
  'grainyFilm',
  'grainyChromaticAbberation',
  'scanlines',
  'scanlinesBlackAndWhite',
  'scanlinesBlue',
  'scanlinesSecurity',
  'trails',
  'trailsLong',
  'trailsDesaturated',
  'trailsFlickery',
  'trailsSpacey',
] as const

export type PostProcessing = (typeof POST_PROCESSING)[number]

/**
 * What YARG's venue is doing right now.
 *
 * Deliberately not the whole packet. The stream carries note bitfields, vocal
 * pitches, camera cuts and star power at 88 Hz; none of that belongs on a phone
 * browsing a song list, and forwarding it would turn a quiet SSE connection
 * into a firehose. This is the subset that answers "what colour is the room".
 *
 * The strobe field is read and discarded on purpose. See `venueStream.ts`.
 */
export interface VenueState {
  /** True while packets are arriving. False means YARG is closed, the setting is off, or the stream stopped. */
  streaming: boolean
  /** The active lighting cue, or null outside gameplay. */
  cue: LightingCue | null
  /** The active colour grade, or null outside gameplay. */
  grade: PostProcessing | null
  /** Which part of the song the chart's venue track says we're in. */
  section: 'verse' | 'chorus' | null
  /**
   * Tempo, or null outside gameplay.
   *
   * Carried so the client can drift through a cue's colours at the song's
   * pace rather than an arbitrary one. Rounded on the way out: it arrives as a
   * float 88 times a second, and untouched float noise would publish a change
   * every packet.
   */
  bpm: number | null
}
