/**
 * Builds the in-memory song index from YARG's own `songcache.bin`.
 *
 * ## Why this file no longer parses a CSV
 *
 * It used to read the export written by YARG's Settings → Export Songs List: a
 * snapshot, produced only when the user remembered to ask for one, going stale
 * every time the library grew. Meanwhile `media/` was already reading
 * `songcache.bin` to find out where each chart lived — so the app depended on
 * two descriptions of the same library, one of which the user had to maintain
 * by hand, and which disagreed with the other the moment a song was added.
 *
 * The cache answers both questions, and YARG rewrites it on every scan. One
 * source, no configuration, and a song list that follows the game.
 *
 * ## What changed in the data by making that switch
 *
 * Three differences worth knowing about, none of them a defect here:
 *
 *  - **Genres are as authored.** The CSV carried YARG's *genrelized* names,
 *    because `SongContainer` normalizes them against a downloaded mapping after
 *    the scan — and the cache is written before that happens. So a chart whose
 *    ini says `Alt. Rock` now reads `Alt. Rock` rather than `Alternative`.
 *  - **Nothing is filtered.** The CSV exported `SongContainer.Songs`, which
 *    drops anything above the player's Max Song Rating setting. The cache holds
 *    the whole library, so songs hidden inside YARG appear here.
 *  - **Track numbers exist.** The CSV had no column for one. See `albumTrack`.
 *
 * ## The cost
 *
 * There is no second source to fall back on. `media/scan.ts` can still find
 * charts on disk when the cache is unreadable, but it recovers paths and
 * hashes, not metadata — there is no song list to be had from it. So an
 * unsupported cache version now means an empty library with a warning saying
 * so, where it used to mean a slow scan behind a list that still worked. That
 * is the trade the version allowlist in `media/cache.ts` exists to protect.
 */

import { stat } from 'node:fs/promises'

import type {
  FacetCount,
  InstrumentKey,
  LibraryMeta,
  Song,
  SongFacets,
  SongLibrary,
} from '@shared/types.js'
import { INSTRUMENTS } from '@shared/types.js'
import { CacheFormatError, readSongCache, type CacheSong, type PartValue } from '../media/cache.js'
import { songCachePath } from './paths.js'
import { stripRichText } from './richtext.js'

/** `int.MaxValue` is YARG's "unset" sentinel for numeric metadata. */
const INT_MAX = 2147483647

/**
 * `SongRating` as the CSV export used to spell it, indexed by the enum ordinal.
 *
 * Kept identical to `SongExport.cs` so the strings the UI filters on did not
 * silently change spelling underneath it. Everything past this list —
 * `Unspecified`, `No_Rating`, `None` — is "No Rating", which is also YARG's own
 * fallback arm.
 */
const RATING_LABELS = ['Family Friendly', 'Supervision Recommended', 'Mature', 'Sensitive Content']

/** An empty library, used before a cache is found and on load failure. */
export function emptyLibrary(warnings: string[] = []): SongLibrary {
  return {
    songs: [],
    facets: {
      sources: [],
      genres: [],
      charters: [],
      formats: [],
      playlists: [],
      yearRange: null,
      lengthRange: null,
    },
    meta: { source: 'none', generatedAt: null, count: 0, warnings },
  }
}

/**
 * Pull a usable year out of YARG's raw year string.
 *
 * The stored year is as authored, so values like `1984 (remaster)` or `''` are
 * normal. We take the first 4-digit run and ignore the rest.
 */
export function parseYear(raw: string | undefined): number | null {
  if (!raw) return null

  // The 4-digit run must stand alone. Without the boundaries, the `2147483647`
  // sentinel matches its own first four digits and renders as the year 2147.
  const match = /(?<!\d)(\d{4})(?!\d)/.exec(raw)
  if (!match) return null

  const year = Number(match[1])
  if (year === INT_MAX || year < 1000 || year > 2999) return null

  return year
}

/**
 * A part's difficulty tier, or null when the instrument isn't charted.
 *
 * This is YARG's `GetIntensity` from the CSV exporter, and the two halves are
 * separate facts: `subTracks` says whether the part exists at all, and
 * `intensity` is `-1` on a part that exists but was never given a tier. Those
 * both have to end up as something, and YARG's answer — absent is absent, and
 * untiered clamps to 0 — is the one the whole UI was built against.
 */
export function partDifficulty(part: PartValue): number | null {
  if (part.subTracks === 0) return null
  return Math.max(0, part.intensity)
}

/**
 * How many vocal parts, by YARG's `VocalsCount`.
 *
 * The harmony part's subtrack bits are the record of how many voices were
 * charted; lead vocals only ever answers "at least one".
 */
export function vocalPartCount(harmony: PartValue, lead: PartValue): number {
  if (harmony.subTracks & 0b100) return 3
  if (harmony.subTracks & 0b010) return 2
  if (harmony.subTracks & 0b001 || lead.subTracks & 0b001) return 1
  return 0
}

/**
 * A track number, or null when the chart didn't really give one.
 *
 * `int.MaxValue` is YARG's explicit "unset", and zero or negative is nobody's
 * track. Everything else is taken at face value — including the 16000 that one
 * pack in this library writes into every chart, which is a real authored value
 * and sorts after the numbered tracks exactly as an unknown would.
 */
export function trackNumber(raw: number): number | null {
  if (raw === INT_MAX || raw <= 0) return null
  return raw
}

/** Tally a string column into descending-count facet buckets. */
function tally(values: readonly string[]): FacetCount[] {
  const counts = new Map<string, number>()

  for (const value of values) {
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

function buildFacets(songs: readonly Song[]): SongFacets {
  let minYear = Number.POSITIVE_INFINITY
  let maxYear = Number.NEGATIVE_INFINITY
  let minLength = Number.POSITIVE_INFINITY
  let maxLength = Number.NEGATIVE_INFINITY

  for (const song of songs) {
    if (song.yearNumber !== null) {
      minYear = Math.min(minYear, song.yearNumber)
      maxYear = Math.max(maxYear, song.yearNumber)
    }
    if (song.lengthSeconds !== null) {
      minLength = Math.min(minLength, song.lengthSeconds)
      maxLength = Math.max(maxLength, song.lengthSeconds)
    }
  }

  return {
    sources: tally(songs.map((s) => s.source)),
    genres: tally(songs.map((s) => s.genre)),
    charters: tally(songs.map((s) => s.charter)),
    formats: tally(songs.map((s) => s.format)),
    playlists: tally(songs.map((s) => s.playlist)),
    yearRange: Number.isFinite(minYear) ? { min: minYear, max: maxYear } : null,
    lengthRange: Number.isFinite(minLength) ? { min: minLength, max: maxLength } : null,
  }
}

/**
 * Turn one cache entry into a song.
 *
 * The rich-text stripping is not optional. The CSV export ran every string
 * through `RichTextUtils.StripRichTextTags` on its way out; the cache stores
 * what the chart author actually wrote, and plenty of them wrote
 * `<color=#FF0000>`. Without this the list renders markup as text.
 */
export function songFromCache(entry: CacheSong, id: string): Song {
  const { meta } = entry

  const difficulties = {} as Record<InstrumentKey, number | null>
  for (const instrument of INSTRUMENTS) {
    difficulties[instrument.key] = partDifficulty(meta.parts[instrument.part])
  }

  const year = stripRichText(meta.year).trim()

  // The band tier is read straight off the struct rather than through
  // `partDifficulty`: YARG's exporter did the same, and a band difficulty of
  // `-1` means untiered rather than absent.
  const band = meta.parts.bandDifficulty.intensity

  return {
    id,
    hash: entry.ref.hash,

    name: stripRichText(meta.name).trim(),
    artist: stripRichText(meta.artist).trim(),
    album: stripRichText(meta.album).trim(),
    genre: stripRichText(meta.genre).trim(),
    subgenre: stripRichText(meta.subgenre).trim(),
    charter: stripRichText(meta.charter).trim(),
    playlist: stripRichText(meta.playlist).trim(),
    source: stripRichText(meta.source).trim(),

    year,
    yearNumber: parseYear(year),

    // Truncated, not rounded, to land on the same second the CSV's `M:SS` did.
    // A non-positive length is a chart that never said, not a zero-length song.
    lengthSeconds: meta.lengthMs > 0 ? Math.trunc(meta.lengthMs / 1000) : null,
    albumTrack: trackNumber(meta.albumTrack),

    isMaster: meta.isMaster,
    ageRating: RATING_LABELS[meta.rating] ?? 'No Rating',
    vocalParts: vocalPartCount(meta.parts.harmonyVocals, meta.parts.leadVocals),

    difficulties,
    bandDifficulty: band < 0 ? null : band,

    format: entry.ref.format,

    // Stamped by `AppState` from the chart index once the library is loaded.
    hasArt: false,
    hasPreview: false,
  }
}

export interface ParseCacheLibraryResult {
  songs: Song[]
  warnings: string[]
}

/**
 * Turn parsed cache entries into songs, with ids that stay unique.
 *
 * Exported separately from the file reading so it can be tested against a
 * handful of entries rather than a 2 MB fixture.
 */
export function buildLibrarySongs(entries: readonly CacheSong[]): ParseCacheLibraryResult {
  const warnings: string[] = []
  const songs: Song[] = []
  const seenIds = new Set<string>()
  let nameless = 0

  for (const entry of entries) {
    const song = songFromCache(entry, entry.ref.hash)

    // A chart with no identifying text at all is not something anybody can
    // search for, and it would render as a blank row. Dropped before its id is
    // claimed, so it can't push a real duplicate onto a `#2` suffix.
    if (!song.name && !song.artist) {
      nameless++
      continue
    }

    // Duplicate charts of the same song share a hash — YARG flags them
    // `IsDuplicate` and keeps both. Keep both here too, but keep the ids unique
    // so React has something stable to key rows on.
    if (seenIds.has(song.id)) {
      let suffix = 2
      while (seenIds.has(`${song.id}#${suffix}`)) suffix++
      song.id = `${song.id}#${suffix}`
    }
    seenIds.add(song.id)

    songs.push(song)
  }

  if (nameless > 0) {
    warnings.push(`${nameless} chart(s) had no title or artist and were left out of the list.`)
  }

  return { songs, warnings }
}

/**
 * Read and parse YARG's song cache for the given data directory.
 *
 * Every failure is a warning on an empty library rather than a throw: the
 * server has to come up regardless, and the tray and the terminal both read
 * these strings back to the user.
 */
export async function loadLibraryFromCache(yargDataDir: string): Promise<SongLibrary> {
  if (!yargDataDir) {
    return emptyLibrary(['No YARG data directory configured. Set yargDataDir in settings.json.'])
  }

  const path = songCachePath(yargDataDir)

  let generatedAt: number | null = null
  try {
    generatedAt = (await stat(path)).mtimeMs
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return emptyLibrary([
        `No song cache at ${path}. Run a song scan in YARG, then reload.`,
      ])
    }
    return emptyLibrary([`Could not read the song cache at ${path}: ${String(error)}.`])
  }

  let entries: readonly CacheSong[]
  try {
    entries = (await readSongCache(path)).songs
  } catch (error) {
    // A version this reader has not been checked against is the one failure
    // worth spelling out, because it is temporary and has a known shape: the
    // app is a YARG update ahead of itself, and the fix is a code change here.
    if (error instanceof CacheFormatError) {
      return emptyLibrary([`YARG's song cache is in a layout this version cannot read. ${error.message}`])
    }
    return emptyLibrary([`Could not read the song cache at ${path}: ${String(error)}.`])
  }

  const { songs, warnings } = buildLibrarySongs(entries)

  const meta: LibraryMeta = {
    source: 'cache',
    generatedAt,
    count: songs.length,
    warnings,
  }

  return { songs, facets: buildFacets(songs), meta }
}
