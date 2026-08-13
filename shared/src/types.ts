/**
 * Types shared between the server and the client.
 *
 * Everything here describes the *wire* shape. Notably absent: filesystem paths.
 * `currentSong.json` exposes `ActualLocation` / `SortBasedLocation`, which leak
 * the user's Windows username — those are resolved server-side and never sent.
 */

/**
 * The instruments the app knows about, in the order they are shown.
 *
 * Keys and labels are ours; `part` is the field name in YARG's `AvailableParts`
 * struct, which is where the difficulties are read from. The loader matches on
 * that name rather than on position — `server/src/media/cache.ts` is the file
 * that turns the struct's fixed field order into these names, and this is the
 * one place that has to agree with it.
 */
export const INSTRUMENTS = [
  { key: 'guitar5', label: 'Guitar', part: 'fiveFretGuitar', group: 'guitar' },
  { key: 'bass5', label: 'Bass', part: 'fiveFretBass', group: 'bass' },
  { key: 'rhythm5', label: 'Rhythm', part: 'fiveFretRhythm', group: 'guitar' },
  { key: 'coop5', label: 'Co-op', part: 'fiveFretCoopGuitar', group: 'guitar' },
  { key: 'keys', label: 'Keys', part: 'keys', group: 'keys' },
  { key: 'guitar6', label: 'Guitar (6)', part: 'sixFretGuitar', group: 'guitar' },
  { key: 'bass6', label: 'Bass (6)', part: 'sixFretBass', group: 'bass' },
  { key: 'rhythm6', label: 'Rhythm (6)', part: 'sixFretRhythm', group: 'guitar' },
  { key: 'coop6', label: 'Co-op (6)', part: 'sixFretCoopGuitar', group: 'guitar' },
  { key: 'drums4', label: 'Drums', part: 'fourLaneDrums', group: 'drums' },
  { key: 'proDrums', label: 'Pro Drums', part: 'proDrums', group: 'drums' },
  { key: 'drums5', label: 'Drums (5)', part: 'fiveLaneDrums', group: 'drums' },
  { key: 'eliteDrums', label: 'Elite Drums', part: 'eliteDrums', group: 'drums' },
  { key: 'proGuitar17', label: 'Pro Guitar', part: 'proGuitar17', group: 'guitar' },
  { key: 'proGuitar22', label: 'Pro Guitar (22)', part: 'proGuitar22', group: 'guitar' },
  { key: 'proBass17', label: 'Pro Bass', part: 'proBass17', group: 'bass' },
  { key: 'proBass22', label: 'Pro Bass (22)', part: 'proBass22', group: 'bass' },
  { key: 'proKeys', label: 'Pro Keys', part: 'proKeys', group: 'keys' },
  { key: 'vocals', label: 'Vocals', part: 'leadVocals', group: 'vocals' },
  { key: 'harmony', label: 'Harmony', part: 'harmonyVocals', group: 'vocals' },
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
 * `SongRating` as YARG's own exporter spells it, indexed by the enum ordinal.
 *
 * Position is the wire value — the server reads `meta.rating` straight into
 * this array, so do not reorder it. It is also, happily, the order the ratings
 * escalate in, which is the order the filter draws them: a scale reads as a
 * scale, the same way the difficulty tiers and the length buckets do.
 *
 * Here rather than in the server because the client filters on these exact
 * strings, and a second copy of them is a second thing to get wrong — the same
 * reason `ENV_VARS` lives here.
 */
export const SONG_RATINGS = [
  'Family Friendly',
  'Supervision Recommended',
  'Mature',
  'Sensitive Content',
] as const

/**
 * Every ordinal past those four — `Unspecified`, `No_Rating`, `None` — which is
 * also YARG's own fallback arm, and the last chip rather than the first: "the
 * chart never said" is not the mildest rating, it is the absence of one.
 */
export const NO_RATING = 'No Rating'

/** Every value `Song.ageRating` can hold, in the order the filter shows them. */
export const AGE_RATINGS: readonly string[] = [...SONG_RATINGS, NO_RATING]

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

  /**
   * Position on its album, or null when the chart never said.
   *
   * Carried for sorting and nothing else — no view renders it. It is what puts
   * an album's songs in running order under the artist sort instead of
   * alphabetical order, which is the one place the list is read as a body of
   * work rather than an index. See `compareWithinArtist` in the client.
   */
  albumTrack: number | null

  isMaster: boolean
  /** One of `AGE_RATINGS` — a display string, never the raw ordinal. */
  ageRating: string
  /** 0 instrumental, 1 solo, 2-3 harmonies. */
  vocalParts: number

  difficulties: Record<InstrumentKey, number | null>
  bandDifficulty: number | null

  format: SongFormat

  /**
   * True when the server can reach this chart's files on disk.
   *
   * Both are answers about *availability*, not about what has been generated
   * yet — art is derived on demand and cached, so promising only what already
   * exists would leave the whole library grey until something asked. False
   * means there is genuinely nothing to fetch: the chart index has no entry for
   * this hash, or the media pipeline is unavailable, and the client should draw
   * what it drew before any of this existed.
   *
   * Set server-side from the chart index (`server/src/media/`) after the
   * library loads, rather than carried on the song: the paths themselves never
   * cross the wire, and every media URL is keyed by hash.
   */
  hasArt: boolean
  hasPreview: boolean
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

/**
 * One address this machine can be reached at, and whether it is worth reading
 * out loud.
 *
 * A developer's machine answers with three or four of these — Wi-Fi, plus
 * whatever VirtualBox, WSL, Docker or a VPN installed — and they are
 * indistinguishable as bare IPv4 strings. Handing a guest the wrong one is a
 * failure that only shows up across a loud room, so the adapter's name travels
 * with the address instead of being thrown away.
 */
export interface LanAddress {
  url: string
  /** The adapter as the OS names it: "Wi-Fi", "Ethernet", "vEthernet (WSL)". */
  name: string
  /** A virtual adapter, which no phone on the network can reach. */
  virtual: boolean
}

export interface LibraryMeta {
  /** `cache` when `songcache.bin` was read; `none` when it could not be. */
  source: 'cache' | 'none'
  /**
   * Epoch ms of `songcache.bin`'s mtime — i.e. when YARG last rescanned.
   *
   * This used to be a staleness signal, back when the library came from an
   * export the user had to remember to re-generate. It is now simply the age of
   * the game's own index, which the app follows automatically.
   */
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
  /**
   * Backstop poll for `currentSong.json`, in ms.
   *
   * The file is watched; this is only the safety net for a watch that has
   * silently died. Not surfaced in the tray — see `core/settings.ts`.
   */
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
  /** Album art and previews: whether they work, and how far along they are. */
  media: MediaSummary
}

/**
 * What the tray needs to say about album art and previews.
 *
 * Deliberately not paths. `ffmpeg` is a boolean rather than the location of the
 * binary — the popover only has to answer "is this working", and the location
 * would be one more absolute path travelling somewhere it isn't needed.
 */
export interface MediaSummary {
  /** False when the media features are dark, which the tray offers to fix. */
  ffmpeg: boolean
  /**
   * Whether this platform has an ffmpeg build YASS can fetch for itself.
   *
   * Windows only: the pinned artifact is a Windows build. Everywhere else the
   * popover says how to install one instead of offering a download that cannot
   * work. Sent from the server rather than read off the renderer's platform
   * because the server is the process that would do the fetching.
   */
  canFetchFfmpeg: boolean
  /** Charts the index resolved — i.e. how many songs can have art. */
  charts: number
  /** Where the index came from. `none` means neither strategy produced one. */
  source: 'cache' | 'scan' | 'none'
  /** True while thumbnails are still being generated in the background. */
  precomputing: boolean
  /** Progress through that pass, for a line the popover can show. */
  precomputed: number
  precomputeTotal: number
}

/** Settings plus read-only context the UI needs to render the settings screen. */
/**
 * The environment variable that forces each field.
 *
 * Here rather than in the server, because the settings UI has to name the
 * variable to the person looking at a field it will not let them edit — and a
 * second copy of these strings is a second thing to get wrong.
 */
export const ENV_VARS: Record<keyof Settings, string> = {
  yargDataDir: 'YASS_YARG_DATA_DIR',
  pollIntervalMs: 'YASS_POLL_INTERVAL_MS',
  host: 'YASS_HOST',
  port: 'YASS_PORT',
}

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
    /** The game's song index. Without it there is no song list at all. */
    songCacheExists: boolean
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
