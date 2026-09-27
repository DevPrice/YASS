/**
 * Finding and fetching cloudflared, which carries the tunnel.
 *
 * Same shape as `media/ffmpeg.ts`, and deliberately so: fetched on request into
 * the app's own directory, verified against a pinned SHA-256, and cached
 * forever. The tunnel is optional, and most hosts only ever use the LAN
 * address, so nobody downloads 40–55 MB for it until they ask.
 *
 * Resolution order, cheapest and most explicit first:
 *
 *  1. `YASS_CLOUDFLARED` — an absolute path, for anyone who wants to choose.
 *  2. `<app cache>/bin/cloudflared[.exe]` — what we fetched last time.
 *  3. `PATH` — a system install (`winget`, `brew`, a distribution package).
 *
 * ## Unlike ffmpeg, Linux gets a download too
 *
 * ffmpeg refuses to fetch outside Windows because the only pinned build is a
 * Windows one. Cloudflare publishes a bare, static executable per platform —
 * no archive to unpack — so pinning the x64 Linux build is one more row in the
 * table below rather than a second code path. Everything the table doesn't
 * name (macOS, ARM) is told where to get one instead of being offered a button
 * that cannot work.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

import {
  executableName,
  findOnPath,
  installExecutable,
  isExecutableFile,
} from '../core/executables.js'
import { managedBinDir } from '../core/paths.js'

/**
 * The builds we fetch, pinned by release tag *and* by digest.
 *
 * Versioned URLs rather than `/releases/latest/download/…`, because a moving
 * URL cannot be pinned to a hash. The digests are the ones GitHub records for
 * the release assets, and match the checksum list in the release notes.
 */
const VERSION = '2026.9.3'

const DOWNLOADS: Partial<Record<string, { asset: string; sha256: string; bytes: number }>> = {
  'win32-x64': {
    asset: 'cloudflared-windows-amd64.exe',
    sha256: 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2',
    bytes: 55_366_080,
  },
  'linux-x64': {
    asset: 'cloudflared-linux-amd64',
    sha256: '77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2',
    bytes: 40_122_749,
  },
}

function download() {
  return DOWNLOADS[`${process.platform}-${process.arch}`] ?? null
}

/** What to tell somebody who has no cloudflared and no download to offer them. */
export const CLOUDFLARED_INSTALL_HINT =
  'Install cloudflared — `brew install cloudflared`, or a package from Cloudflare — or point YASS_CLOUDFLARED at one.'

export type CloudflaredSource = 'env' | 'managed' | 'path'

export interface CloudflaredInfo {
  path: string
  source: CloudflaredSource
}

/** Whether this platform has a build to fetch. */
export function canFetchCloudflared(): boolean {
  return download() !== null
}

/** Approximate download size, for the tray to say so before starting. */
export function cloudflaredDownloadBytes(): number | null {
  return download()?.bytes ?? null
}

/** Where a fetched cloudflared lives. */
export function managedCloudflaredPath(): string {
  return join(managedBinDir(), executableName('cloudflared'))
}

/**
 * Locate cloudflared, or null.
 *
 * Not memoized, for the same reason as ffmpeg: the answer changes the moment a
 * fetch completes, and it is asked about rarely.
 */
export async function resolveCloudflared(): Promise<CloudflaredInfo | null> {
  const configured = process.env.YASS_CLOUDFLARED
  if (configured && (await isExecutableFile(configured))) {
    return { path: configured, source: 'env' }
  }

  const managed = managedCloudflaredPath()
  if (await isExecutableFile(managed)) return { path: managed, source: 'managed' }

  const onPath = await findOnPath('cloudflared')
  if (onPath !== null) return { path: onPath, source: 'path' }

  return null
}

/**
 * Download, verify and install cloudflared.
 *
 * The digest is checked before anything is written, so a tampered or truncated
 * download never reaches a path the app will later execute.
 */
export async function fetchCloudflared(): Promise<string> {
  const build = download()
  if (build === null) {
    throw new Error(
      `No cloudflared build is pinned for ${process.platform}-${process.arch}. ${CLOUDFLARED_INSTALL_HINT}`,
    )
  }

  const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${build.asset}`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Could not download cloudflared: ${response.status} ${response.statusText}`)
  }

  const binary = Buffer.from(await response.arrayBuffer())

  const digest = createHash('sha256').update(binary).digest('hex')
  if (digest !== build.sha256) {
    throw new Error(
      `cloudflared download failed verification: expected ${build.sha256}, got ${digest}`,
    )
  }

  const destination = managedCloudflaredPath()
  await installExecutable(destination, binary)

  return destination
}
