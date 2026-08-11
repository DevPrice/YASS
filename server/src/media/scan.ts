/**
 * The fallback: find every chart by walking the disk and hashing it ourselves.
 *
 * `cache.ts` is the fast path and will be the one that runs. This exists so
 * that a YARG update which changes `songcache.bin`'s layout costs a slow first
 * scan instead of costing the feature — the two produce the same `ChartRef`,
 * and nothing downstream can tell which ran.
 *
 * It is viable because YARG's song hash is not a private construction: it is
 * `SHA1(chart file bytes)`, over `notes.mid` / `notes.midi` / `notes.chart` /
 * `notes.txt` for loose and packaged ini charts, and over the `.mid` for a
 * console package. So we can compute the same identity from the same bytes.
 *
 * Where to look comes from YARG's own `settings.json` → `SongFolders`, which is
 * the same list the game scans.
 *
 * ## What this costs
 *
 * A full walk of a 4,000-song library over SMB is about 40 seconds, and the
 * hashing on top of it reads every chart file — tens of MB for loose charts,
 * and a block-chased extraction per CON. Minutes, not seconds. That is the
 * price of a format change, paid once, in the background.
 *
 * ## One known gap
 *
 * A CON song with an RBCON *update* or *upgrade* applied hashes as
 * `SHA1(mainMidi ++ updateMidi ++ upgradeMidi)` in YARG, and this computes only
 * the first term. Those songs get no `ChartRef` from the scanner and so no art
 * or preview. They are a small minority, the cache path resolves them
 * correctly, and the alternative is reimplementing the whole update-group
 * pipeline for a path that runs only when the cache is unreadable.
 */

import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { openConPackage, findConListing, isDirectory, type ConPackage } from './stfs.js'
import { findListing, openSngPackage } from './sng.js'
import { parseDta, findSongNode, getKeyed } from './dta.js'
import type { ChartRef } from './types.js'

/** In YARG's own preference order — the first one present is the chart. */
export const CHART_FILENAMES = ['notes.mid', 'notes.midi', 'notes.chart', 'notes.txt'] as const

const SNG_EXTENSIONS = new Set(['.sng', '.yargsong'])

/**
 * Directories that are never song folders.
 *
 * Not an optimisation so much as a correctness guard: `.git` in particular can
 * hold thousands of files, and a chart library kept under version control is
 * not unusual.
 */
const SKIP_DIRECTORIES = new Set(['.git', '.svn', 'node_modules', '$recycle.bin', 'system volume information'])

/** How deep to recurse before assuming the tree is pathological. */
const MAX_DEPTH = 12

const sha1 = (bytes: Buffer): string => createHash('sha1').update(bytes).digest('hex').toUpperCase()

/**
 * Read YARG's own settings for the folders it scans.
 *
 * Returns an empty list rather than throwing: a missing or unparsable
 * `settings.json` means we have nowhere to look, which the caller reports as an
 * empty index — the same state as a library nobody has pointed at yet.
 */
export async function readSongFolders(yargDataDir: string): Promise<string[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(yargDataDir, 'settings.json'), 'utf8'))
    const folders = (raw as { SongFolders?: unknown })?.SongFolders

    if (!Array.isArray(folders)) return []
    return folders.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
  } catch {
    return []
  }
}

/** Hash the first chart file present in a directory, or null if there is none. */
async function hashLooseChart(directory: string, names: Set<string>): Promise<string | null> {
  for (const candidate of CHART_FILENAMES) {
    if (!names.has(candidate)) continue

    try {
      return sha1(await readFile(join(directory, candidate)))
    } catch {
      return null
    }
  }

  return null
}

/** Open an SNG/`.yargsong` and hash the chart inside it. */
async function scanSngFile(path: string): Promise<ChartRef | null> {
  const pkg = await openSngPackage(path)
  if (pkg === null) return null

  try {
    const found = findListing(pkg, CHART_FILENAMES)
    if (found === null) return null

    return { hash: sha1(await pkg.readFile(found.listing)), format: 'Sng', path }
  } catch {
    return null
  } finally {
    await pkg.close()
  }
}

/**
 * Every `songs/<sub>/<sub>.mid` a package holds.
 *
 * Enumerating the file table rather than reading the DTA first, because the
 * table is the thing that says what actually exists — a DTA can name songs
 * whose files were stripped out of the package.
 */
function packagedSongs(pkg: ConPackage): string[] {
  const subs: string[] = []

  for (const listing of pkg.listings) {
    if (isDirectory(listing)) continue

    const match = /^songs\/([^/]+)\/\1\.mid$/i.exec(listing.name)
    if (match !== null) subs.push(match[1]!)
  }

  return subs
}

/**
 * Resolve a shortname to its `songs.dta` key.
 *
 * Usually they are the same string. When they are not, the DTA's
 * `(song (name "songs/<sub>/<sub>"))` is what ties the two together — see
 * `ChartRef.dtaName`.
 */
function resolveDtaName(document: ReturnType<typeof parseDta>, subName: string): string {
  if (findSongNode(document, subName) !== null) return subName

  for (const node of document) {
    if (!Array.isArray(node) || typeof node[0] !== 'string') continue

    const song = getKeyed(node, 'song')
    if (song === null) continue

    const name = getKeyed(song, 'name')?.[1]
    if (typeof name === 'string' && name.toLowerCase().endsWith(`/${subName.toLowerCase()}`)) {
      return node[0]
    }
  }

  return subName
}

/** Open a CON package and produce one ref per song inside it. */
async function scanConFile(path: string): Promise<ChartRef[]> {
  let pkg: ConPackage | null = null

  try {
    pkg = await openConPackage(path)
    if (pkg === null) return []

    let document: ReturnType<typeof parseDta> = []
    const dta = findConListing(pkg, 'songs/songs.dta')
    if (dta !== null) {
      document = parseDta((await pkg.read(dta)).toString('utf8'))
    }

    const refs: ChartRef[] = []
    for (const subName of packagedSongs(pkg)) {
      const midi = findConListing(pkg, `songs/${subName}/${subName}.mid`)
      if (midi === null) continue

      try {
        refs.push({
          hash: sha1(await pkg.read(midi)),
          format: 'CON',
          path,
          subName,
          dtaName: resolveDtaName(document, subName),
        })
      } catch {
        // A package we can open but cannot extract from. Skip the song, keep
        // the others — packages hold up to a few dozen.
      }
    }

    return refs
  } catch {
    return []
  } finally {
    await pkg?.close()
  }
}

/**
 * An unpacked console package: a directory laid out the way a CON is inside.
 *
 * Recognised by `songs/songs.dta` on disk, which is what YARG keys on too.
 */
async function scanExConDirectory(directory: string): Promise<ChartRef[]> {
  let document: ReturnType<typeof parseDta> = []
  try {
    document = parseDta(await readFile(join(directory, 'songs', 'songs.dta'), 'utf8'))
  } catch {
    return []
  }

  let subNames: string[]
  try {
    subNames = (await readdir(join(directory, 'songs'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }

  const refs: ChartRef[] = []
  for (const subName of subNames) {
    try {
      const midi = await readFile(join(directory, 'songs', subName, `${subName}.mid`))
      refs.push({
        hash: sha1(midi),
        format: 'ExCON',
        path: directory,
        subName,
        dtaName: resolveDtaName(document, subName),
      })
    } catch {
      // No `.mid` under that name — not a song folder.
    }
  }

  return refs
}

export interface ScanOptions {
  /** Called per chart found, so a long scan can report progress. */
  onProgress?: (found: number) => void
  /** Checked between directories, so a rescan can supersede one in flight. */
  signal?: AbortSignal
}

/**
 * Walk one song folder, collecting refs.
 *
 * Depth-first and sequential rather than parallel. The library lives on a
 * network share; twenty concurrent directory listings over SMB is slower than
 * one, and this runs in the background of a server that is also answering
 * requests.
 */
async function walk(
  directory: string,
  depth: number,
  into: ChartRef[],
  options: ScanOptions,
): Promise<void> {
  if (depth > MAX_DEPTH) return
  options.signal?.throwIfAborted()

  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    // Unreadable directory, or a share that went away mid-walk.
    return
  }

  const names = new Set(entries.map((entry) => entry.name.toLowerCase()))

  // A directory holding a chart file is a song, and does not contain more.
  const looseHash = await hashLooseChart(directory, names)
  if (looseHash !== null) {
    into.push({ hash: looseHash, format: 'Ini', path: directory })
    options.onProgress?.(into.length)
    return
  }

  if (names.has('songs')) {
    const excon = await scanExConDirectory(directory)
    if (excon.length > 0) {
      into.push(...excon)
      options.onProgress?.(into.length)
      return
    }
  }

  for (const entry of entries) {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue
      await walk(path, depth + 1, into, options)
      continue
    }

    if (!entry.isFile()) continue

    const extension = extname(entry.name).toLowerCase()

    if (SNG_EXTENSIONS.has(extension)) {
      const ref = await scanSngFile(path)
      if (ref !== null) {
        into.push(ref)
        options.onProgress?.(into.length)
      }
      continue
    }

    /*
     * A CON has no extension, so anything extension-less and large enough gets
     * its first four bytes read. `openConPackage` returns null for a
     * non-package, which makes "is this a CON" a cheap question with an honest
     * answer — and the size floor keeps us from opening every stray `.DS_Store`
     * and `Thumbs.db` in the library.
     */
    if (extension === '') {
      try {
        // Below the first data block a package cannot hold anything.
        if ((await stat(path)).size < 0xc000) continue
      } catch {
        continue
      }

      const refs = await scanConFile(path)
      if (refs.length > 0) {
        into.push(...refs)
        options.onProgress?.(into.length)
      }
    }
  }
}

/**
 * Scan every folder YARG is configured to scan.
 *
 * Duplicate hashes are kept as-is — deduplication is the index's job, and it
 * applies the same first-writer-wins rule the CSV join already uses.
 */
export async function scanSongFolders(
  yargDataDir: string,
  options: ScanOptions = {},
): Promise<ChartRef[]> {
  const refs: ChartRef[] = []

  for (const folder of await readSongFolders(yargDataDir)) {
    await walk(folder, 0, refs, options)
  }

  return refs
}
