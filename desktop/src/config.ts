/**
 * Reading and writing configuration, from a process that isn't the server.
 *
 * There are two ways to reach the settings file and the rule for choosing is
 * "one writer at a time":
 *
 *   server up   → `PUT /api/settings` over loopback. The server writes the
 *                 file and applies the change live, so a guest already
 *                 browsing on their phone sees the new song list appear
 *                 without a reconnect.
 *   server down → write the file here, with the server's own
 *                 `saveStoredSettings`.
 *
 * The two are mutually exclusive by construction, so there is no lock to get
 * wrong — and both run the same `normalizeSettings`, because both are the
 * server's code. This module reuses those modules rather than reimplementing
 * validation; that is the whole reason the `@server/*` path alias exists.
 */

import type { Settings, SettingsView } from '@shared/types.js'
import {
  applyEnvOverrides,
  describeSettings,
  loadStoredSettings,
  saveStoredSettings,
} from '@server/core/settings.js'

/** Loopback requests should be instant; anything slower is a hung server. */
const REQUEST_TIMEOUT_MS = 2500

/**
 * For the two requests that legitimately take a while.
 *
 * Rebuilding the chart index can mean scanning the whole library off a network
 * share. The instant-or-hung rule above is right for reading settings and wrong
 * for work the user explicitly asked for and is watching a spinner for.
 */
const LONG_REQUEST_TIMEOUT_MS = 5 * 60_000

/**
 * The fields the popover is allowed to set.
 *
 * The renderer is our own code behind a sandbox and a context bridge, but a
 * patch is still untrusted input by the time it reaches here — and an
 * allowlist is two lines. Values are clamped afterwards by `normalizeSettings`
 * on whichever path does the writing.
 */
const EDITABLE: ReadonlyArray<keyof Settings> = [
  'yargDataDir',
  'pollIntervalMs',
  'host',
  'port',
]

export function sanitizePatch(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== 'object') return {}

  const input = raw as Record<string, unknown>
  const patch: Partial<Settings> = {}

  for (const key of EDITABLE) {
    if (!(key in input)) continue
    // Assigning through the union needs the cast; `normalizeSettings` is what
    // actually decides whether the value is usable.
    ;(patch as Record<string, unknown>)[key] = input[key]
  }

  return patch
}

/** The settings view computed here, for when there is no server to ask. */
export async function readLocalSettingsView(): Promise<SettingsView> {
  return describeSettings(applyEnvOverrides(await loadStoredSettings()))
}

/**
 * A loopback call to the server's own API, or null if it didn't work.
 *
 * Failure is not distinguished by kind on purpose: a refused connection
 * (server down) and a 404 (the host-only guard refusing a request that didn't
 * arrive on loopback) both mean the same thing to every caller — "not
 * available this way, use the other path".
 */
export async function apiJson<T>(
  url: string,
  init?: RequestInit & {
    /** Override the default, or `null` to wait as long as it takes. */
    timeoutMs?: number | null
  },
): Promise<T | null> {
  const { timeoutMs, ...rest } = init ?? {}
  const budget = timeoutMs === undefined ? REQUEST_TIMEOUT_MS : timeoutMs

  try {
    const response = await fetch(url, {
      ...rest,
      ...(budget === null ? {} : { signal: AbortSignal.timeout(budget) }),
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/**
 * The settings as they are actually in force.
 *
 * Asks the server when there is one, because its answer is computed by the
 * process whose environment and filesystem access are the ones that matter.
 */
export async function readSettingsView(origin: string | null): Promise<SettingsView> {
  if (origin) {
    const view = await apiJson<SettingsView>(`${origin}/api/settings`)
    if (view) return view
  }

  return readLocalSettingsView()
}

export interface SaveResult {
  view: SettingsView
  /** True when the running server took the change and applied it live. */
  applied: boolean
}

export async function saveSettings(
  patch: Partial<Settings>,
  origin: string | null,
): Promise<SaveResult> {
  if (origin) {
    const view = await apiJson<SettingsView>(`${origin}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })

    if (view) return { view, applied: true }
  }

  // The patch merges onto the *stored* values, never the effective ones — same
  // rule the server follows, so a `YASS_PORT=…` in force during this run isn't
  // written into the file behind the user's back.
  const stored = await loadStoredSettings()
  const saved = await saveStoredSettings({ ...stored, ...patch })

  return { view: describeSettings(applyEnvOverrides(saved)), applied: false }
}

/** Ask the server to tell every connected browser to reload itself. */
export async function reloadClients(origin: string | null): Promise<boolean> {
  if (!origin) return false

  const result = await apiJson<{ ok: boolean }>(`${origin}/api/clients/reload`, {
    method: 'POST',
  })

  return result?.ok === true
}

/**
 * Ask the server to rebuild the chart index.
 *
 * Rebuilding from `songcache.bin` is milliseconds, but the fallback is a walk
 * of the whole library over a network share — minutes. So this uses the long
 * timeout, and even then the server may still be scanning when it answers; the
 * popover's poll is what eventually shows the new count.
 */
export async function rebuildMediaIndex(origin: string | null): Promise<boolean> {
  if (!origin) return false

  return (
    (await apiJson<unknown>(`${origin}/api/media/reindex`, {
      method: 'POST',
      timeoutMs: LONG_REQUEST_TIMEOUT_MS,
    })) !== null
  )
}

/**
 * Ask the server to download ffmpeg.
 *
 * No timeout at all. It is a 110 MB download over whatever connection the host
 * has, and a request that gives up after two minutes would abandon a download
 * that is still running perfectly well in the server process — leaving the
 * popover saying it failed while the file quietly finishes arriving.
 */
export async function installFfmpeg(origin: string | null): Promise<boolean> {
  if (!origin) return false

  const result = await apiJson<{ ok: boolean }>(`${origin}/api/media/ffmpeg`, {
    method: 'POST',
    timeoutMs: null,
  })

  return result?.ok === true
}
