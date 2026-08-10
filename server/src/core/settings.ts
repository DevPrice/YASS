/**
 * Settings load/save.
 *
 * Settings live outside the project directory (per-OS config dir) so a packaged
 * build behaves the same as a dev run. Every field can also be overridden by an
 * environment variable, which is what the eventual tray executable and any
 * container/service wrapper will use.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { Settings, SettingsView } from '@shared/types.js'
import {
  appConfigDir,
  currentSongJsonPath,
  defaultYargDataDir,
  settingsFilePath,
} from './paths.js'

const DEFAULT_PORT = 4321

/** Poll rate for `currentSong.json`. The file only changes at song start, pause,
 *  and scene transitions, so 1-2 Hz is ample; 1 Hz keeps idle cost negligible. */
const DEFAULT_POLL_INTERVAL_MS = 1000

const MIN_POLL_INTERVAL_MS = 250
const MAX_POLL_INTERVAL_MS = 10_000

export function defaultSettings(): Settings {
  const yargDataDir = defaultYargDataDir('release')

  return {
    yargDataDir,
    // No sensible default: the CSV is wherever the user chose to save it in
    // YARG's native file dialog. Empty means "not configured yet".
    songListCsvPath: '',
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    // LAN-accessible by default — this is meant to be reached from phones and
    // through a reverse proxy.
    host: '0.0.0.0',
    port: DEFAULT_PORT,
  }
}

function clampPollInterval(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, Math.round(n)))
}

function clampPort(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback
  return n
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** Merge a raw parsed object over defaults, coercing and clamping as we go. */
export function normalizeSettings(raw: unknown): Settings {
  const defaults = defaultSettings()
  if (!raw || typeof raw !== 'object') return defaults

  const input = raw as Record<string, unknown>

  return {
    yargDataDir: asString(input.yargDataDir, defaults.yargDataDir),
    songListCsvPath: asString(input.songListCsvPath, defaults.songListCsvPath),
    pollIntervalMs: clampPollInterval(input.pollIntervalMs, defaults.pollIntervalMs),
    host: asString(input.host, defaults.host),
    port: clampPort(input.port, defaults.port),
  }
}

/** Environment overrides win over the settings file. */
function applyEnvOverrides(settings: Settings): Settings {
  const env = process.env

  return {
    yargDataDir: env.YASS_YARG_DATA_DIR ?? settings.yargDataDir,
    songListCsvPath: env.YASS_SONG_LIST_CSV ?? settings.songListCsvPath,
    pollIntervalMs: env.YASS_POLL_INTERVAL_MS
      ? clampPollInterval(env.YASS_POLL_INTERVAL_MS, settings.pollIntervalMs)
      : settings.pollIntervalMs,
    host: env.YASS_HOST ?? settings.host,
    port: env.YASS_PORT ? clampPort(env.YASS_PORT, settings.port) : settings.port,
  }
}

export async function loadSettings(): Promise<Settings> {
  const path = settingsFilePath()

  let stored: unknown = null
  try {
    stored = JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    // A missing file is the normal first-run case. Anything else (corrupt JSON,
    // permissions) falls back to defaults rather than refusing to start — the
    // settings screen is how the user fixes it.
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn(`[settings] could not read ${path}, using defaults:`, err)
    }
  }

  return applyEnvOverrides(normalizeSettings(stored))
}

/**
 * Persist settings via write-to-temp + rename, so an interrupted write can't
 * leave a truncated settings file behind.
 */
export async function saveSettings(settings: Settings): Promise<Settings> {
  const normalized = normalizeSettings(settings)
  const path = settingsFilePath()

  await mkdir(dirname(path), { recursive: true })

  const tempPath = join(appConfigDir(), `settings.${process.pid}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  await rename(tempPath, path)

  // Env overrides still win for the running process, so report what's in effect.
  return applyEnvOverrides(normalized)
}

/** Settings plus the existence checks the settings UI needs to flag misconfiguration. */
export function describeSettings(settings: Settings): SettingsView {
  return {
    settings,
    defaultYargDataDir: defaultYargDataDir('release'),
    status: {
      yargDataDirExists: settings.yargDataDir !== '' && existsSync(settings.yargDataDir),
      currentSongJsonExists:
        settings.yargDataDir !== '' && existsSync(currentSongJsonPath(settings.yargDataDir)),
      songListCsvExists: settings.songListCsvPath !== '' && existsSync(settings.songListCsvPath),
    },
  }
}
