/**
 * Loads YARG's CSV song-list export into an in-memory index.
 *
 * The CSV is a *snapshot*: YARG only writes it when the user picks
 * Settings → Export Songs List, so it goes stale as the library grows. We
 * surface the file's mtime as `generatedAt` so the UI can say so.
 *
 * This is deliberately the only place that knows about CSV. When YARG is patched
 * to publish its own song index, a sibling loader produces the same `SongLibrary`
 * and nothing downstream changes.
 */

import { readFile, stat } from 'node:fs/promises'

import type {
  FacetCount,
  InstrumentKey,
  LibraryMeta,
  Song,
  SongFacets,
  SongFormat,
  SongLibrary,
} from '@shared/types.js'
import { INSTRUMENTS } from '@shared/types.js'
import { indexHeaders, parseCsv } from './csv.js'
import { normalizeHash } from './hash.js'

/** YARG writes `-1` for an instrument that isn't charted. */
const DIFFICULTY_ABSENT = -1

/** `int.MaxValue` is YARG's "unset" sentinel for numeric metadata. */
const INT_MAX = 2147483647

const KNOWN_FORMATS = new Set<SongFormat>(['Ini', 'Sng', 'ExCON', 'CON'])

/** An empty library, used before a CSV is configured and on load failure. */
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
 * Parse `M:SS` into seconds.
 *
 * Minutes are neither zero-padded nor capped at 59 — a 75-minute chart is
 * written `75:00` — so this does not assume two-digit minutes.
 */
export function parseLength(raw: string | undefined): number | null {
  if (!raw) return null

  const match = /^(\d+):([0-5]?\d)$/.exec(raw.trim())
  if (!match) return null

  const minutes = Number(match[1])
  const seconds = Number(match[2])
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null

  return minutes * 60 + seconds
}

/**
 * Pull a usable year out of YARG's raw year string.
 *
 * The CSV carries `UnmodifiedYear`, so values like `1984 (remaster)` or `''`
 * are normal. We take the first 4-digit run and ignore the rest.
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

/** `-1` → absent (null); anything else clamps to a non-negative tier. */
export function parseDifficulty(raw: string | undefined): number | null {
  if (raw === undefined) return null

  const trimmed = raw.trim()
  if (trimmed === '') return null

  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  if (value === DIFFICULTY_ABSENT) return null
  if (value === INT_MAX) return null

  return Math.max(0, Math.trunc(value))
}

function parseFormat(raw: string | undefined): SongFormat {
  const trimmed = (raw ?? '').trim() as SongFormat
  return KNOWN_FORMATS.has(trimmed) ? trimmed : 'Unknown'
}

function parseBool(raw: string | undefined): boolean {
  // C# `bool.ToString()` yields `True`/`False`.
  return (raw ?? '').trim().toLowerCase() === 'true'
}

function parseCount(raw: string | undefined): number {
  const value = Number((raw ?? '').trim())
  if (!Number.isFinite(value) || value === INT_MAX) return 0
  return Math.max(0, Math.trunc(value))
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
 * Build a stable id for a song with no usable hash.
 *
 * Hash-less rows shouldn't collide with each other, so the row index is folded
 * in — these ids are only meaningful within a single load, which is fine
 * because they can't join against `currentSong.json` anyway.
 */
function syntheticId(song: Omit<Song, 'id'>, rowIndex: number): string {
  const key = [song.artist, song.name, song.album, song.charter].join('\u0000')
  return `row:${rowIndex}:${key}`
}

export interface ParseCsvLibraryResult {
  songs: Song[]
  warnings: string[]
}

/** Parse CSV text into songs. Exported separately so it can be tested without a file. */
export function parseCsvLibrary(text: string): ParseCsvLibraryResult {
  const warnings: string[] = []
  const rows = parseCsv(text)

  if (rows.length === 0) {
    return { songs: [], warnings: ['The CSV export is empty.'] }
  }

  const headers = indexHeaders(rows[0]!)
  const columnCount = rows[0]!.length

  const at = (row: readonly string[], header: string): string | undefined => {
    const index = headers.get(header.toLowerCase())
    return index === undefined ? undefined : row[index]
  }

  // Fail loudly on the two columns everything else keys off, but keep going —
  // a partially usable library beats a blank screen.
  for (const required of ['Name', 'Artist']) {
    if (!headers.has(required.toLowerCase())) {
      warnings.push(`CSV is missing the "${required}" column; rows may render blank.`)
    }
  }
  if (!headers.has('hash')) {
    warnings.push('CSV has no "Hash" column, so now-playing cannot be matched to the library.')
  }

  const songs: Song[] = []
  const seenIds = new Set<string>()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!

    if (row.length !== columnCount) {
      warnings.push(`Row ${i + 1} has ${row.length} columns, expected ${columnCount}; skipped.`)
      continue
    }

    const difficulties = {} as Record<InstrumentKey, number | null>
    for (const instrument of INSTRUMENTS) {
      difficulties[instrument.key] = parseDifficulty(at(row, instrument.csvHeader))
    }

    const rawYear = (at(row, 'Year') ?? '').trim()
    const hash = normalizeHash(at(row, 'Hash'))

    const partial: Omit<Song, 'id'> = {
      hash,
      // The CSV export already strips rich text, so no stripping is needed here.
      name: (at(row, 'Name') ?? '').trim(),
      artist: (at(row, 'Artist') ?? '').trim(),
      album: (at(row, 'Album') ?? '').trim(),
      genre: (at(row, 'Genre') ?? '').trim(),
      subgenre: (at(row, 'Subgenre') ?? '').trim(),
      charter: (at(row, 'Charter') ?? '').trim(),
      playlist: (at(row, 'Playlist') ?? '').trim(),
      source: (at(row, 'Source') ?? '').trim(),
      year: rawYear,
      yearNumber: parseYear(rawYear),
      lengthSeconds: parseLength(at(row, 'Length')),
      isMaster: parseBool(at(row, 'Master')),
      ageRating: (at(row, 'Age Rating') ?? '').trim(),
      vocalParts: parseCount(at(row, 'Vocal Parts')),
      difficulties,
      bandDifficulty: parseDifficulty(at(row, 'Band Difficulty')),
      format: parseFormat(at(row, 'Format')),
      // The CSV has no column that could answer these — it carries no paths at
      // all. `AppState` stamps them from the chart index once the library is
      // loaded; until then, every song looks like it has no media, which is
      // exactly what the app showed before the index existed.
      hasArt: false,
      hasPreview: false,
    }

    // Skip rows that carry no identifying text at all.
    if (!partial.name && !partial.artist) continue

    let id = hash ?? syntheticId(partial, i)

    // Duplicate charts of the same song share a hash (YARG flags them with
    // `IsDuplicate`). Keep both rows but keep ids unique for React keys.
    if (seenIds.has(id)) {
      let suffix = 2
      while (seenIds.has(`${id}#${suffix}`)) suffix++
      id = `${id}#${suffix}`
    }
    seenIds.add(id)

    songs.push({ id, ...partial })
  }

  return { songs, warnings }
}

/** Read and parse the configured CSV export. */
export async function loadLibraryFromCsv(csvPath: string): Promise<SongLibrary> {
  if (!csvPath) {
    // This is read off the terminal the server is running in, not in a browser
    // — there is no settings screen to send anyone to.
    return emptyLibrary([
      'No song list configured. Set songListCsvPath in settings.json, or YASS_SONG_LIST_CSV.',
    ])
  }

  let text: string
  let generatedAt: number | null = null

  try {
    // Decode as UTF-8 — song metadata is heavily non-ASCII. `parseCsv` strips a BOM.
    text = await readFile(csvPath, 'utf8')
    generatedAt = (await stat(csvPath)).mtimeMs
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const reason = code === 'ENOENT' ? 'file not found' : String(err)
    return emptyLibrary([`Could not read the song list at ${csvPath}: ${reason}.`])
  }

  const { songs, warnings } = parseCsvLibrary(text)

  const meta: LibraryMeta = {
    source: 'csv',
    generatedAt,
    count: songs.length,
    warnings,
  }

  return { songs, facets: buildFacets(songs), meta }
}
