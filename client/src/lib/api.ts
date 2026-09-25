/**
 * API client.
 *
 * All URLs are relative so the app works identically on localhost, on a LAN IP,
 * and behind a reverse proxy on a custom domain.
 */

import type { NowPlaying, SetlistEditError, SongLibrary } from '@shared/types'
import { mockArtUrl } from '../mock/art'

/**
 * True only in the published demo build (`vite build --mode mock`).
 *
 * Defined as a literal by `vite.config.ts`, so in every other build this is
 * `false` at compile time and each branch below it — plus the import above and
 * everything it reaches — is removed from the bundle rather than shipped and
 * skipped. See `mock/index.ts`.
 *
 * The art routes are the one part of the API that a `fetch` shim cannot cover:
 * these URLs end up in `<img src>` and in a CSS `background-image`, neither of
 * which goes through `fetch`. So the demo answers them here, at the same seam
 * that decides every other URL in the app.
 */
const DEMO = typeof import.meta.env === 'object' && import.meta.env.VITE_MOCK === true

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
}

export function fetchLibrary(): Promise<SongLibrary> {
  return getJson<SongLibrary>('/api/songs')
}

// `POST /api/songs/reload` deliberately has no client binding. The server
// watches the CSV and reloads itself, and the endpoint is host-only — it
// exists for the tray process, not for a browser.

export function fetchNowPlaying(): Promise<NowPlaying> {
  return getJson<NowPlaying>('/api/now-playing')
}

// --- Setlist edits -----------------------------------------------------------
//
// Only possible while the host runs the YARG Setlist Bridge plugin; check
// `Setlist.editable` before offering any of them. Each resolves once YARG has
// taken or refused the edit. The changed setlist itself arrives over the event
// stream, so a caller never merges a response into what it shows.
//
// Pass the `version` of the setlist you were looking at with anything that
// depends on positions; if it has changed since, the edit fails with `conflict`.

export type SetlistEditOutcome = { ok: true } | { ok: false; error: SetlistEditError }

async function sendSetlistEdit(method: string, path: string, body?: unknown): Promise<SetlistEditOutcome> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // The server itself is unreachable, which to the person tapping is the same
    // as YARG being unreachable.
    return { ok: false, error: 'unavailable' }
  }

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: SetlistEditError } | null
  if (response.ok && payload?.ok) return { ok: true }
  return { ok: false, error: payload?.error ?? 'failed' }
}

const versionQuery = (version?: number) => (version === undefined ? '' : `?version=${version}`)

/** Add a song, at the end or at `index`. */
export function addToSetlist(hash: string, options: { index?: number; version?: number } = {}) {
  return sendSetlistEdit('POST', '/api/setlist/songs', { hash, ...options })
}

/** Move a song so it ends up at `index`. */
export function moveInSetlist(hash: string, index: number, version?: number) {
  return sendSetlistEdit('PUT', `/api/setlist/songs/${hash}/position`, { index, version })
}

export function removeFromSetlist(hash: string, version?: number) {
  return sendSetlistEdit('DELETE', `/api/setlist/songs/${hash}${versionQuery(version)}`)
}

/** Remove every song that can be removed: all of them before a show, the unplayed ones during it. */
export function clearSetlist(version?: number) {
  return sendSetlistEdit('DELETE', `/api/setlist/songs${versionQuery(version)}`)
}

// No binding for `/api/settings` or `/api/capabilities`, on purpose.
//
// This app is opened by a room full of guests, and configuration is not
// something they should be able to find, let alone reach — the host-only check
// on those routes was the last line of that argument rather than the whole of
// it. The endpoints stay for the tray process, which is where configuration is
// going. Until it exists, the host edits settings.json or sets the environment
// variables; both are in the README.

/**
 * Album art URL for the current song.
 *
 * The `v` cache-buster is the song hash: the server serves a single
 * `/api/art/current`, so without it the browser would show the previous song's
 * art from cache when the song changes.
 */
export function currentArtUrl(hash: string | null): string {
  if (DEMO) return mockArtUrl(hash)

  return `/api/art/current?v=${encodeURIComponent(hash ?? 'none')}`
}

/**
 * Album art for any song in the library.
 *
 * `sm` is a 256px thumbnail for the list; `lg` is 640px for the detail plate.
 * Unlike `currentArtUrl` these need no cache-buster — the hash is *in* the URL,
 * so every song has its own and the server marks them immutable.
 *
 * Only call this when `song.hasArt`. It 404s harmlessly otherwise, but a list
 * of four thousand rows asking for four thousand missing images is four
 * thousand requests to learn something the payload already said.
 */
export function artUrl(hash: string, size: 'sm' | 'lg' = 'sm'): string {
  // One SVG for both sizes: it is vector, so the 256px list thumbnail and the
  // 640px detail plate are the same bytes at two scales.
  if (DEMO) return mockArtUrl(hash)

  return `/api/art/${encodeURIComponent(hash)}?size=${size}`
}

/** About thirty seconds of a song. See `lib/usePreview.ts`. */
export function previewUrl(hash: string): string {
  return `/api/preview/${encodeURIComponent(hash)}`
}
