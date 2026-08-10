/**
 * API client.
 *
 * All URLs are relative so the app works identically on localhost, on a LAN IP,
 * and behind a reverse proxy on a custom domain.
 */

import type { NowPlaying, SongLibrary } from '@shared/types'

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
  return `/api/art/current?v=${encodeURIComponent(hash ?? 'none')}`
}
