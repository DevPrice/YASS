/**
 * Finding, fetching and running ffmpeg.
 *
 * ffmpeg does every pixel and every sample this app touches: it resizes 1.16 GB
 * of album art down to thumbnails, and it mixes seven stems into a 30-second
 * preview. Using it rather than a native image library is not only about
 * audio — `server/tsup.config.ts` bundles the server to a single ESM file with
 * `noExternal` set to match everything, so a native addon like `sharp` was
 * never an option.
 *
 * ## It is fetched, not bundled
 *
 * Every static Windows ffmpeg build is around 100 MB. Shipping one inside
 * `YASS.exe` would roughly double it, for a feature that degrades gracefully
 * when it is missing. So it is downloaded once, into the app's own directory,
 * verified against a pinned SHA-256, and cached forever. That needs the
 * internet exactly once, at setup — not at party time.
 *
 * Resolution order, cheapest and most explicit first:
 *
 *  1. `YASS_FFMPEG` — an absolute path, for anyone who wants to choose.
 *  2. `%LOCALAPPDATA%\yass\bin\ffmpeg.exe` — what we fetched last time.
 *  3. `PATH` — a system install, which most developers already have.
 *
 * When none resolve, the media features stay dark: `hasArt` and `hasPreview`
 * come back false and the client draws exactly what it drew before any of this
 * existed. Nothing errors, and nothing half-works.
 *
 * ## The fetch is Windows-only, and the rest of this file is not
 *
 * Only step 2 is: the pinned artifact below is a Windows build, and installing
 * it anywhere else would leave a PE executable named `ffmpeg` sitting in the
 * app's own directory, found by step 2 on every subsequent run and failing to
 * execute every time. So `fetchFfmpeg` refuses, and Linux and macOS resolve
 * through `YASS_FFMPEG` or `PATH` — where a package manager has almost
 * certainly already put one, and where the answer is one command rather than a
 * 110 MB download. Everything else here — resolution, running it, the timeout
 * — is the same code on every platform.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'

import { managedBinDir } from '../core/paths.js'

const inflateRawAsync = promisify(inflateRaw)

/**
 * The build we fetch, pinned by release tag *and* by digest.
 *
 * A dated, versioned tag rather than a rolling `latest`, because a moving URL
 * cannot be pinned to a hash — and an unverified hash is worse than none, since
 * it reads as a guarantee. Both values were taken from the actual artifact.
 *
 * This is the "essentials" build: it carries `ffmpeg.exe`, `ffprobe.exe` and
 * `ffplay.exe`, and we extract only the first. 110 MB down the wire for a
 * ~100 MB executable is what a static ffmpeg costs; there is no small one.
 */
const DOWNLOAD = {
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip',
  sha256: 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec',
  /** The one entry we want out of the archive. */
  entry: 'ffmpeg-8.1.2-essentials_build/bin/ffmpeg.exe',
  /** Approximate download size, for the tray to say so before starting. */
  bytes: 109_728_040,
} as const

export type FfmpegSource = 'env' | 'managed' | 'path'

export interface FfmpegInfo {
  path: string
  source: FfmpegSource
}

const executableName = (name: string): string =>
  process.platform === 'win32' ? `${name}.exe` : name

/**
 * Whether this platform has a build to fetch.
 *
 * Asked by the API so the popover can offer the download where it exists and
 * say where to get ffmpeg where it doesn't, rather than presenting a button
 * that always fails.
 */
export function canFetchFfmpeg(): boolean {
  return process.platform === 'win32'
}

/** What to tell somebody who has no ffmpeg and no download to offer them. */
export const FFMPEG_INSTALL_HINT =
  'Install ffmpeg with your package manager — `apt install ffmpeg`, `dnf install ffmpeg`, `brew install ffmpeg` — or point YASS_FFMPEG at one.'

/** Where a fetched ffmpeg lives. */
export function managedFfmpegPath(): string {
  return join(managedBinDir(), executableName('ffmpeg'))
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Search `PATH` for an executable, honouring `PATHEXT` on Windows. */
async function findOnPath(name: string): Promise<string | null> {
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE').split(';').filter(Boolean)
      : ['']

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, name + extension)
      if (await isExecutableFile(candidate)) return candidate
    }
  }

  return null
}

/**
 * Locate ffmpeg, or null.
 *
 * Not memoized: the answer changes the moment a fetch completes, and the tray
 * can trigger that at any time. The cost is a handful of `stat` calls, and the
 * callers that run it per-song hold onto the result themselves.
 */
export async function resolveFfmpeg(): Promise<FfmpegInfo | null> {
  const configured = process.env.YASS_FFMPEG
  if (configured && (await isExecutableFile(configured))) {
    return { path: configured, source: 'env' }
  }

  const managed = managedFfmpegPath()
  if (await isExecutableFile(managed)) return { path: managed, source: 'managed' }

  const onPath = await findOnPath('ffmpeg')
  if (onPath !== null) return { path: onPath, source: 'path' }

  return null
}

export interface RunOptions {
  /** Bytes to write to stdin — raw RGBA, for the DXT path. */
  input?: Buffer
  /**
   * Hard limit on one invocation.
   *
   * Every input is on a network share that can disappear mid-read, which turns
   * a 0.7 s mix into a process that never exits. A bound here is what keeps a
   * dropped `N:` drive from leaking ffmpeg processes for the life of the app.
   */
  timeoutMs?: number
}

export interface RunResult {
  code: number
  stdout: Buffer
  stderr: string
}

const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Run ffmpeg and collect its output.
 *
 * stdout is captured as bytes because some callers pipe an image out of it;
 * stderr is text, because it is only ever read by a human in a log line.
 */
export function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    const stdout: Buffer[] = []
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`ffmpeg timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`))
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      // Bounded: ffmpeg is chatty, and a stuck job should not grow without end.
      if (stderr.length < 16_384) stderr += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout: Buffer.concat(stdout), stderr })
    })

    if (options.input !== undefined) {
      // EPIPE is normal here: ffmpeg can decide it has enough input and close
      // the pipe before we finish writing, which is not an error.
      child.stdin.on('error', () => {})
      child.stdin.end(options.input)
    } else {
      child.stdin.end()
    }
  })
}

// --- Fetching ---------------------------------------------------------------

/**
 * Pull one entry out of a ZIP, without a dependency.
 *
 * Node has `zlib` but no archive reader, and the alternatives were both worse:
 * a package would have to survive `noExternal` bundling, and shelling out to
 * `Expand-Archive` would inflate all three ~100 MB executables to disk just to
 * delete two of them.
 *
 * Only what is needed to find one known name: locate the end-of-central-
 * directory record, walk the central directory, then inflate that entry's
 * local record. Store (0) and deflate (8) are the only methods real ZIPs use.
 */
export async function extractZipEntry(archive: Buffer, entryName: string): Promise<Buffer> {
  const EOCD_SIGNATURE = 0x06054b50
  const CENTRAL_SIGNATURE = 0x02014b50

  // The EOCD sits at the end, after a comment of up to 64 KB.
  let eocd = -1
  for (let at = archive.length - 22; at >= 0 && at >= archive.length - 22 - 0xffff; at--) {
    if (archive.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at
      break
    }
  }
  if (eocd === -1) throw new Error('not a ZIP archive: no end-of-central-directory record')

  const entryCount = archive.readUInt16LE(eocd + 10)
  let at = archive.readUInt32LE(eocd + 16)

  for (let i = 0; i < entryCount; i++) {
    if (archive.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error('ZIP central directory is malformed')
    }

    const method = archive.readUInt16LE(at + 10)
    const compressedSize = archive.readUInt32LE(at + 20)
    const nameLength = archive.readUInt16LE(at + 28)
    const extraLength = archive.readUInt16LE(at + 30)
    const commentLength = archive.readUInt16LE(at + 32)
    const localHeaderAt = archive.readUInt32LE(at + 42)
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength)

    if (name === entryName) {
      // The local header repeats the name and extra fields, with its own
      // lengths — which are allowed to differ from the central directory's.
      const localNameLength = archive.readUInt16LE(localHeaderAt + 26)
      const localExtraLength = archive.readUInt16LE(localHeaderAt + 28)
      const dataAt = localHeaderAt + 30 + localNameLength + localExtraLength
      const data = archive.subarray(dataAt, dataAt + compressedSize)

      if (method === 0) return Buffer.from(data)
      if (method === 8) return Buffer.from(await inflateRawAsync(data))
      throw new Error(`unsupported ZIP compression method ${method}`)
    }

    at += 46 + nameLength + extraLength + commentLength
  }

  throw new Error(`${entryName} is not in the archive`)
}

export interface FetchProgress {
  received: number
  total: number
}

/** What the tray needs to describe the download before starting it. */
export const FFMPEG_DOWNLOAD_BYTES = DOWNLOAD.bytes

/**
 * Download, verify and install ffmpeg.
 *
 * The digest is checked *before* anything is written to the destination, and
 * the executable is written to a temp name and renamed into place — so an
 * interrupted or tampered download can never leave a half-written or unverified
 * binary somewhere the app will later execute.
 */
export async function fetchFfmpeg(onProgress?: (progress: FetchProgress) => void): Promise<string> {
  if (!canFetchFfmpeg()) {
    throw new Error(`No ffmpeg build is bundled for ${process.platform}. ${FFMPEG_INSTALL_HINT}`)
  }

  const response = await fetch(DOWNLOAD.url, { redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(`Could not download ffmpeg: ${response.status} ${response.statusText}`)
  }

  const total = Number(response.headers.get('content-length') ?? DOWNLOAD.bytes)
  const chunks: Buffer[] = []
  let received = 0

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk)
    chunks.push(buffer)
    received += buffer.length
    onProgress?.({ received, total })
  }

  const archive = Buffer.concat(chunks)

  const digest = createHash('sha256').update(archive).digest('hex')
  if (digest !== DOWNLOAD.sha256) {
    throw new Error(
      `ffmpeg download failed verification: expected ${DOWNLOAD.sha256}, got ${digest}`,
    )
  }

  const binary = await extractZipEntry(archive, DOWNLOAD.entry)

  const destination = managedFfmpegPath()
  await mkdir(dirname(destination), { recursive: true })

  const temp = `${destination}.${process.pid}.tmp`
  await writeFile(temp, binary)
  try {
    // A no-op on Windows, and required everywhere else.
    await chmod(temp, 0o755)
    await rename(temp, destination)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }

  return destination
}
