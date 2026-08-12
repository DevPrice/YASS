/**
 * Genrelizer: turning the genre a charter wrote into one you can sort by.
 *
 * A library of four thousand charts written by four thousand people contains
 * `Alt Rock`, `Alternative Rock`, `alt-rock`, `CLassic Rock` and `Classicrock`,
 * and every one of them is a separate row in a genre filter. YARG solves this
 * with Genrelizer — a crowdsourced set of mappings from the names people
 * actually write to the closed list of genres it sorts by, with the specific
 * name preserved as a subgenre. `12-Bar Blues` becomes `Blues > 12-Bar Blues`.
 *
 * We have to do it ourselves because of *when* YARG does it. `CacheHandler.RunScan`
 * writes `songcache.bin` first, and `SongContainer.RunRefresh` genrelizes the
 * in-memory entries afterwards — so the file this app reads has only ever held
 * the raw values. This is a port of `Assets/Script/Song/Genrelizer.cs`.
 *
 * ## Where the data comes from
 *
 * Not from us. YARG downloads the Genrelizer repository into its own install
 * directory on startup, and this reads the copy already sitting there. The
 * alternative was vendoring the repo as a submodule, which would have meant
 * carrying a second copy that drifts from the one the game is actually using —
 * and the whole point of the previous commit was to stop keeping our own
 * description of things YARG already publishes.
 *
 * The cost is that the mappings are not where anything else we read lives.
 * `yargDataDir` is Unity's `persistentDataPath`; these are in
 * `StreamingAssets`, under the *installation*, and no path derives from the
 * other. So they have to be found rather than resolved — see `findMappingsDir`
 * — and when they cannot be, genres stay exactly as authored. The library still
 * loads; the genre filter is just messier, which is what it looked like before
 * any of this existed.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { BROAD_GENRES, BROAD_OTHER } from './genrelizer.broad.js'
import { MAGMA_PAIRS } from './genrelizer.magma.js'

/**
 * YARG's `GenrelizerMode`, as stored in its own `settings.json`.
 *
 * The player chooses this in game, and this app has no business overriding it:
 * somebody who turned normalization off did so because they want to see what
 * their charts actually say.
 *
 * `overgenrelize` is the third setting and the least obvious — it collapses the
 * official genres into thirteen broad headings and drops subgenres entirely.
 */
export type GenrelizerMode = 'off' | 'genrelize' | 'overgenrelize'

const MODES: readonly GenrelizerMode[] = ['off', 'genrelize', 'overgenrelize']

/**
 * Read the player's setting out of YARG's data directory.
 *
 * Defaults to `genrelize`, which is YARG's own default, whenever the file is
 * missing or says something unexpected — the same rule `readSongFolders` uses
 * for the same file.
 */
export async function readGenrelizerMode(yargDataDir: string): Promise<GenrelizerMode> {
  if (!yargDataDir) return 'genrelize'

  try {
    const raw: unknown = JSON.parse(await readFile(join(yargDataDir, 'settings.json'), 'utf8'))
    const value = (raw as { Genrelizer?: unknown })?.Genrelizer
    if (typeof value === 'number' && MODES[value] !== undefined) return MODES[value]!
  } catch {
    // No settings file, or not readable. YARG's default it is.
  }

  return 'genrelize'
}

/** What a lookup produces: an official genre, and the detail it came with. */
export interface GenreMapping {
  genre: string
  subgenre: string | null
}

/**
 * The alias table, plus the pieces of it the resolver needs to name things.
 *
 * `byAlias` is every way anyone has thought to write a genre or subgenre,
 * lowercased — about 7,300 keys from 73 genres and ~1,450 subgenres. `display`
 * maps an official genre's lowercase form back to its cased spelling, which is
 * how the Magma table's lowercase constants become `Death/Black Metal`.
 */
export interface GenreTable {
  byAlias: ReadonlyMap<string, GenreMapping>
  display: ReadonlyMap<string, string>
  /** Where it was read from, for the log line and the tray. */
  source: string
}

/** YARG's own fallbacks. Both are localization values in `en-US.json`. */
const UNKNOWN_GENRE = 'Unknown Genre'
const OTHER = 'Other'

/** `_handleReggaeSkaSpecialCase` — the one place an artist decides a genre. */
const REGGAE_ARTISTS = new Set(['UB40', 'Zing Experience'])
const REGGAE_SKA_ALIASES = new Set(['reggae/ska', 'reggaeska'])

interface RawSubgenre {
  prefixes?: string[]
  suffixes?: string[]
  substitutions?: Record<string, string[]>
}

interface RawGenreFile extends RawSubgenre {
  name: string
  subgenres?: Record<string, RawSubgenre>
}

/**
 * Replace every occurrence of `find` with `replace`, ignoring case.
 *
 * `String.prototype.replaceAll` cannot do case-insensitive matching without a
 * regular expression, and building one would mean escaping substitution keys
 * that legitimately contain `.`, `+`, `(` and `&`. This scans instead.
 */
function replaceAllInsensitive(input: string, find: string, replace: string): string {
  if (find === '') return input

  const haystack = input.toLowerCase()
  const needle = find.toLowerCase()

  let result = ''
  let at = 0

  for (;;) {
    const found = haystack.indexOf(needle, at)
    if (found < 0) return result + input.slice(at)

    result += input.slice(at, found) + replace
    at = found + needle.length
  }
}

/**
 * Every spelling one name should answer to.
 *
 * Two mechanisms, applied in that order. **Substitutions** are a power set, not
 * a product: each entry is a substring and the alternatives to swap in, and
 * every *combination* of those swaps — including applying none of them — is a
 * result. So `hardcore → hard core|hard-core` alongside `polka → pulka|půlka`
 * yields nine spellings of `Hardcore Polka`, without anyone listing nine.
 * **Affixes** then decorate each of those with every suffix, every prefix, and
 * every pairing of the two.
 *
 * Ported from `_getAllKeys`. The combinatorics are the reason a 7-line mapping
 * file can define 45 ways to write one genre.
 */
export function expandAliases(
  original: string,
  prefixes: readonly string[] = [],
  suffixes: readonly string[] = [],
  substitutions: Readonly<Record<string, readonly string[]>> = {},
): string[] {
  let sets: Array<Array<readonly [string, string]>> = [[]]

  for (const [find, replacements] of Object.entries(substitutions)) {
    const added: Array<Array<readonly [string, string]>> = []
    for (const set of sets) {
      for (const replacement of replacements) {
        added.push([...set, [find, replacement] as const])
      }
    }
    sets = [...sets, ...added]
  }

  const results: string[] = []

  for (const set of sets) {
    let value = original
    for (const [find, replacement] of set) {
      value = replaceAllInsensitive(value, find, replacement)
    }

    results.push(value)

    for (const suffix of suffixes) {
      results.push(value + suffix)
      for (const prefix of prefixes) results.push(prefix + value + suffix)
    }

    for (const prefix of prefixes) results.push(prefix + value)
  }

  return results
}

/**
 * Build the alias table from parsed mapping files.
 *
 * A genre's own aliases map to itself with no subgenre; each subgenre's aliases
 * map to the parent genre *and* the subgenre's standardized spelling. Later
 * files never overwrite earlier keys — YARG logs a collision and keeps the
 * first, and doing anything else would make the result depend on directory
 * order.
 */
export function buildGenreTable(files: readonly RawGenreFile[], source: string): GenreTable {
  const byAlias = new Map<string, GenreMapping>()
  const display = new Map<string, string>()

  const add = (alias: string, mapping: GenreMapping): void => {
    const key = alias.toLowerCase()
    if (!byAlias.has(key)) byAlias.set(key, mapping)
  }

  for (const file of files) {
    if (!file?.name) continue

    display.set(file.name.toLowerCase(), file.name)

    const asGenre: GenreMapping = { genre: file.name, subgenre: null }
    for (const alias of expandAliases(file.name, file.prefixes, file.suffixes, file.substitutions)) {
      add(alias, asGenre)
    }

    for (const [subgenre, data] of Object.entries(file.subgenres ?? {})) {
      // English only. The `localizations` block exists for other languages and
      // the property name is implicitly the en-US value, so it is skipped
      // rather than read.
      const mapping: GenreMapping = { genre: file.name, subgenre }
      for (const alias of expandAliases(subgenre, data.prefixes, data.suffixes, data.substitutions)) {
        add(alias, mapping)
      }
    }
  }

  return { byAlias, display, source }
}

/** `(magma genre, magma subgenre)` → what to use instead. */
const MAGMA = new Map<string, { genre: string; subgenre: string | null }>(
  MAGMA_PAIRS.map(([genre, subgenre, outGenre, outSubgenre]) => [
    `${genre.toLowerCase()} ${subgenre.toLowerCase()}`,
    { genre: outGenre, subgenre: outSubgenre },
  ]),
)

/**
 * .NET's `TextInfo.ToTitleCase`, near enough.
 *
 * Used only on subgenres falling through to `Other`, where the raw text is
 * being kept but tidied. The behaviour worth reproducing is the exception: a
 * word that is *entirely* uppercase is treated as an acronym and left alone, so
 * `EDM` survives as `EDM` rather than becoming `Edm`. Everything else is
 * normalized to leading capital, rest lowercase, which is what collapses
 * `HARD rock` and `hard Rock` onto one value.
 */
export function titleCase(input: string): string {
  return input.trim().replace(/[\p{L}\p{N}']+/gu, (word) => {
    if (word.length > 1 && word === word.toUpperCase()) return word
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  })
}

export class Genrelizer {
  #table: GenreTable
  #mode: GenrelizerMode

  constructor(table: GenreTable, mode: GenrelizerMode = 'genrelize') {
    this.#table = table
    this.#mode = mode
  }

  get source(): string {
    return this.#table.source
  }

  get mode(): GenrelizerMode {
    return this.#mode
  }

  get aliasCount(): number {
    return this.#table.byAlias.size
  }

  /** An official genre's cased spelling, or `Other` if it is not one. */
  #display(genre: string): string {
    return this.#table.display.get(genre.toLowerCase()) ?? OTHER
  }

  #lookup(raw: string): GenreMapping | undefined {
    return this.#table.byAlias.get(raw.toLowerCase())
  }

  /**
   * Resolve a raw genre and subgenre into the pair YARG would show.
   *
   * `artist` is consulted for exactly one case — see `#reggaeSka`.
   */
  resolve(rawGenre: string, rawSubgenre: string, artist: string): GenreMapping {
    const resolved = this.#resolve(rawGenre, rawSubgenre, artist)
    if (this.#mode !== 'overgenrelize') return resolved

    // Applied on top of a normal resolve, exactly as `GenrelizeAll` does it:
    // the broad heading is chosen from the *official* genre, so a chart has to
    // be recognised before it can be filed under one. The subgenre goes, which
    // is the point — this mode is for somebody who wants twelve rows in the
    // filter, not four hundred.
    return {
      genre: BROAD_GENRES.get(resolved.genre.toLowerCase()) ?? BROAD_OTHER,
      subgenre: null,
    }
  }

  #resolve(rawGenre: string, rawSubgenre: string, artist: string): GenreMapping {
    const genre = rawGenre.trim()
    const subgenre = rawSubgenre.trim()

    if (genre === '') {
      if (subgenre === '') return { genre: UNKNOWN_GENRE, subgenre: null }
      // Only a subgenre, which no chart is supposed to do. Read it as the genre.
      return this.#lone(subgenre, artist)
    }

    if (subgenre === '') return this.#lone(genre, artist)

    return this.#pair(genre, subgenre, artist)
  }

  /**
   * One value, standing for both.
   *
   * The interesting part is the fallbacks. A genre containing a slash is
   * usually either a list (`Hard Rock/Heavy Metal`) or one genre wearing
   * adjectives (`Melodic/Neoclassical Metal`). For a list, the first item is
   * the best single answer; for the adjectives, the noun at the end is. So the
   * text before the first slash is tried, then the text after the last — which
   * between them cover both shapes. Commas only ever form the first shape.
   */
  #lone(raw: string, artist: string): GenreMapping {
    if (REGGAE_SKA_ALIASES.has(raw.toLowerCase())) return this.#reggaeSka(artist)

    const direct = this.#lookup(raw)
    if (direct) return direct

    if (raw.includes('/')) {
      const beforeFirst = raw.slice(0, raw.indexOf('/')).trimEnd()
      const asList = this.#lookup(beforeFirst)
      if (asList) return asList

      const afterLast = raw.slice(raw.lastIndexOf('/') + 1).trimStart()
      const asAdjectives = this.#lookup(afterLast)
      if (asAdjectives) return asAdjectives
    }

    if (raw.includes(',')) {
      const beforeFirst = raw.slice(0, raw.indexOf(',')).trimEnd()
      const asList = this.#lookup(beforeFirst)
      if (asList) return asList
    }

    // Nothing recognised it. Keep what the charter wrote, tidied, underneath
    // the one genre that admits it does not know.
    return { genre: OTHER, subgenre: titleCase(raw) }
  }

  /**
   * Both values present, which is the case the mappings were designed around.
   *
   * The charter's genre is treated as authoritative and the subgenre only fills
   * in detail — except when the genre resolves to `Other`, at which point the
   * subgenre is the only real information left and gets promoted.
   */
  #pair(rawGenre: string, rawSubgenre: string, artist: string): GenreMapping {
    if (REGGAE_SKA_ALIASES.has(rawGenre.toLowerCase()) && rawSubgenre.toLowerCase() === 'other') {
      return this.#reggaeSka(artist)
    }

    const magma = MAGMA.get(`${rawGenre.toLowerCase()} ${rawSubgenre.toLowerCase()}`)
    if (magma) return this.#magma(magma.genre, magma.subgenre)

    // Saying the same thing twice is saying it once.
    if (rawGenre === rawSubgenre) return this.#lone(rawGenre, artist)

    // Only the genre half of the genre's own lookup is wanted: if the charter
    // put a subgenre in the genre field, the parent genre is still the best
    // guess, but the subgenre they *did* provide wins over the one implied.
    const genre = this.#lone(rawGenre, artist).genre
    const fromSubgenre = this.#lone(rawSubgenre, artist)

    let subgenre: string | null
    if (fromSubgenre.subgenre) {
      subgenre = fromSubgenre.subgenre
    } else {
      // The subgenre field named a full genre — `Heavy Metal > Metalcore`. Its
      // standardized spelling is the subgenre, unless that is what the genre
      // already says.
      subgenre = fromSubgenre.genre === genre ? null : fromSubgenre.genre
    }

    if (genre === OTHER) {
      const promoted = fromSubgenre.genre
      return { genre: promoted, subgenre: promoted === subgenre ? null : subgenre }
    }

    return { genre, subgenre }
  }

  /** A telltale Magma pair, already decided; only the spelling is left. */
  #magma(genre: string, subgenre: string | null): GenreMapping {
    if (subgenre === null) return { genre: this.#display(genre), subgenre: null }

    // Belt and braces: the hardcoded subgenres should all be known already.
    const known = this.#lookup(subgenre)
    return {
      genre: this.#display(genre),
      subgenre: known ? known.subgenre : titleCase(subgenre),
    }
  }

  /**
   * `Reggae/Ska` is two genres in a trenchcoat, and Magma offered no way to
   * pick one. Ska is far and away the more common in practice, so it wins
   * unless the artist is one of the handful YARG names.
   */
  #reggaeSka(artist: string): GenreMapping {
    const reggae = REGGAE_ARTISTS.has(artist) || artist.includes('Bob Marley')
    return { genre: this.#display(reggae ? 'reggae' : 'ska'), subgenre: null }
  }
}

/** Where a platform's `SpecialFolder.LocalApplicationData` points. */
function localAppDataDir(): string {
  const home = homedir()

  switch (process.platform) {
    case 'win32':
      return process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    case 'darwin':
      return join(home, 'Library', 'Application Support')
    default:
      return process.env.XDG_DATA_HOME ?? join(home, '.local', 'share')
  }
}

/**
 * Where a YARG install keeps `StreamingAssets`, relative to the install folder.
 *
 * Two shapes because a Unity player is laid out differently on macOS, where the
 * whole thing is inside an app bundle.
 */
const STREAMING_ASSETS = [
  join('installation', 'YARG_Data', 'StreamingAssets'),
  join('installation', 'YARG.app', 'Contents', 'Resources', 'Data', 'StreamingAssets'),
]

/** What YARG names the folder it unzips the Genrelizer repository into. */
const GENRES_SUBPATH = join('genres', 'Genrelizer-master', 'mappings')

/**
 * Find the mappings YARG downloaded, or null.
 *
 * Searched rather than derived, because nothing this app already knows leads
 * here: the YARC Launcher installs each build into its own GUID-named folder,
 * and the settings file that would name them is not always written. So the
 * install root is listed and every candidate probed.
 *
 * `YASS_GENRE_MAPPINGS` overrides the search outright, which covers a Steam or
 * portable install and makes this testable without one.
 */
export async function findMappingsDir(): Promise<string | null> {
  const override = process.env.YASS_GENRE_MAPPINGS
  if (override) return (await isDirectory(override)) ? override : null

  const installs = join(localAppDataDir(), 'YARC', 'YARG Installs')

  let entries: string[]
  try {
    entries = await readdir(installs)
  } catch {
    return null
  }

  const found: Array<{ path: string; mtimeMs: number }> = []

  for (const entry of entries) {
    for (const layout of STREAMING_ASSETS) {
      const candidate = join(installs, entry, layout, GENRES_SUBPATH)
      try {
        const stats = await stat(candidate)
        if (stats.isDirectory()) found.push({ path: candidate, mtimeMs: stats.mtimeMs })
      } catch {
        // Not this one.
      }
    }
  }

  if (found.length === 0) return null

  // Several installs — stable and nightly, usually — each with their own copy.
  // They track the same repository, so the newest is as good an answer as
  // exists, and picking deterministically beats picking by directory order.
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return found[0]!.path
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Read and parse every mapping file in a directory.
 *
 * A file that will not parse is skipped rather than fatal — this is downloaded
 * third-party data, and one malformed genre is not worth losing the other
 * seventy-two over.
 */
export async function loadGenreTable(directory: string): Promise<GenreTable> {
  const names = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith('.json'))

  const files: RawGenreFile[] = []
  for (const name of names) {
    try {
      const text = await readFile(join(directory, name), 'utf8')
      // The files are UTF-8 and some carry a BOM, which `JSON.parse` refuses.
      files.push(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as RawGenreFile)
    } catch (error) {
      console.warn(`[genres] skipping ${name}: ${String(error)}`)
    }
  }

  return buildGenreTable(files, directory)
}

/**
 * The alias table for this process, or null when there is none to load.
 *
 * Cached, and the mode deliberately is not. Building the table is seventy-three
 * file reads and seven thousand keys, and YARG only re-downloads the mappings
 * when *it* starts — but the mode is one small JSON read, and a player who
 * changes the setting and rescans should see the difference on the reload that
 * follows rather than on a server restart.
 */
let cachedTable: Promise<GenreTable | null> | null = null

function table(): Promise<GenreTable | null> {
  cachedTable ??= findMappingsDir().then(async (directory) => {
    if (directory === null) {
      console.warn(
        '[genres] no Genrelizer mappings found; genres will read exactly as charted. ' +
          'Run YARG once online, or set YASS_GENRE_MAPPINGS.',
      )
      return null
    }

    const loaded = await loadGenreTable(directory)
    console.log(`[genres] ${loaded.byAlias.size} genre aliases from ${directory}`)
    return loaded
  })

  return cachedTable
}

/**
 * The resolver to build a library with, or null to leave genres as authored.
 *
 * Null for the two separate reasons genres go untouched: the player turned
 * normalization off in YARG, or the mappings are not on this machine. Both end
 * in the same place, and the caller does not have to care which.
 */
export async function genreResolver(yargDataDir: string): Promise<Genrelizer | null> {
  const mode = await readGenrelizerMode(yargDataDir)
  if (mode === 'off') return null

  const loaded = await table()
  return loaded === null ? null : new Genrelizer(loaded, mode)
}

/** Drop the cached table. For tests, which point at different fixtures. */
export function resetGenreTable(): void {
  cachedTable = null
}
