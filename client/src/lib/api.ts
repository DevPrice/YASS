/**
 * API client.
 *
 * All URLs are relative so the app works identically on localhost, on a LAN IP,
 * and behind a reverse proxy on a custom domain.
 */

import type { NowPlaying, Settings, SettingsView, SongLibrary } from '@shared/types'

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

export async function reloadLibrary(): Promise<SongLibrary> {
  const response = await fetch('/api/songs/reload', { method: 'POST' })
  if (!response.ok) throw new Error(`Reload failed: ${response.status}`)
  return (await response.json()) as SongLibrary
}

export function fetchNowPlaying(): Promise<NowPlaying> {
  return getJson<NowPlaying>('/api/now-playing')
}

/** What this client is allowed to do. Settings are host-only. */
export interface Capabilities {
  settings: boolean
}

export function fetchCapabilities(): Promise<Capabilities> {
  return getJson<Capabilities>('/api/capabilities')
}

export function fetchSettings(): Promise<SettingsView> {
  return getJson<SettingsView>('/api/settings')
}

export async function saveSettings(patch: Partial<Settings>): Promise<SettingsView> {
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}) as { error?: string })
    throw new Error(detail.error ?? `Save failed: ${response.status}`)
  }

  return (await response.json()) as SettingsView
}

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
