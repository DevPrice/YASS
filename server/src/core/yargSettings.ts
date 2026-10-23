/**
 * The two of YARG's own settings that change what this app shows.
 *
 * `Genrelizer` decides how genres are normalized and `CensorMatureContent`
 * decides which age rating a clean-vocals chart carries and which audio its
 * preview is made from. Both are the player's choices, made in game, and this
 * app follows them rather than offering its own — there is deliberately no
 * YASS setting for either.
 *
 * Read from `<yargDataDir>/settings.json`, the same file `media/scan.ts` reads
 * `SongFolders` out of.
 *
 * ## Absent and unreadable are different answers
 *
 * A missing file or a missing key means YARG's defaults. That is the honest
 * reading for a build that predates a setting — release YARG has no
 * `CensorMatureContent` at all — and for an install that has never saved.
 *
 * A file that is present but does not parse is a different situation. YARG
 * saves with `File.WriteAllText`, which truncates before it writes, and the
 * settings watcher in `state.ts` wakes up precisely when that happens — so an
 * empty or half-written file is an expected sight, not a corrupt install. Reading
 * it as defaults would switch censorship *off* for as long as the write took
 * and push an uncensored library to every phone in the room. So a caller that
 * has a previous reading passes it in, and an unparseable file keeps it.
 */

import { readFile } from 'node:fs/promises'

import type { GenrelizerMode } from './genrelizer.js'
import { yargSettingsPath } from './paths.js'

export interface YargSettings {
  genrelizer: GenrelizerMode
  censorMatureContent: boolean
}

const GENRELIZER_MODES: readonly GenrelizerMode[] = ['off', 'genrelize', 'overgenrelize']

/** YARG's own defaults, which are also what a build without a setting behaves like. */
export const DEFAULT_YARG_SETTINGS: YargSettings = {
  genrelizer: 'genrelize',
  censorMatureContent: false,
}

export function sameYargSettings(a: YargSettings, b: YargSettings): boolean {
  return a.genrelizer === b.genrelizer && a.censorMatureContent === b.censorMatureContent
}

type SettingsFile =
  | { kind: 'missing' }
  | { kind: 'torn' }
  | { kind: 'read'; values: Record<string, unknown> }

async function readSettingsFile(yargDataDir: string): Promise<SettingsFile> {
  if (!yargDataDir) return { kind: 'missing' }

  let text: string
  try {
    text = await readFile(yargSettingsPath(yargDataDir), 'utf8')
  } catch {
    return { kind: 'missing' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'torn' }
  }

  return typeof raw === 'object' && raw !== null
    ? { kind: 'read', values: raw as Record<string, unknown> }
    : { kind: 'read', values: {} }
}

/**
 * Read the player's settings out of a YARG data directory.
 *
 * `previous` is what to keep when the file exists but cannot be parsed — see
 * the header. Without it, that case reads as the defaults too.
 */
export async function readYargSettings(
  yargDataDir: string,
  previous: YargSettings | null = null,
): Promise<YargSettings> {
  const file = await readSettingsFile(yargDataDir)
  if (file.kind === 'missing') return DEFAULT_YARG_SETTINGS
  if (file.kind === 'torn') return previous ?? DEFAULT_YARG_SETTINGS

  const { Genrelizer, CensorMatureContent } = file.values

  return {
    genrelizer:
      typeof Genrelizer === 'number' && GENRELIZER_MODES[Genrelizer] !== undefined
        ? GENRELIZER_MODES[Genrelizer]!
        : DEFAULT_YARG_SETTINGS.genrelizer,
    censorMatureContent:
      typeof CensorMatureContent === 'boolean'
        ? CensorMatureContent
        : DEFAULT_YARG_SETTINGS.censorMatureContent,
  }
}

/**
 * Where YARG's setlist socket should be, as far as `settings.json` knows.
 *
 * Read apart from `YargSettings` because it changes nothing about the library:
 * toggling the socket must reconnect, not reload four thousand songs.
 *
 * **This is a hint, not the truth.** YARG opens and closes the socket the moment
 * the toggle moves, but only writes the file when the settings menu closes, so
 * the reading can be behind in either direction. `setlistClient.ts` keeps
 * trying whatever this says and uses it only to explain a failure.
 */
export interface SetlistSocketSettings {
  /**
   * `absent` is a saved file without the key — YARG writes every setting it
   * has, so that build has no setlist socket. `unknown` is no file at all.
   */
  enabled: 'on' | 'off' | 'absent' | 'unknown'
  port: number
}

/** YARG's default, next to the Data Stream's 36107. */
export const DEFAULT_SETLIST_PORT = 36108

export async function readSetlistSocketSettings(
  yargDataDir: string,
  previous: SetlistSocketSettings | null = null,
): Promise<SetlistSocketSettings> {
  const file = await readSettingsFile(yargDataDir)
  if (file.kind === 'missing') return { enabled: 'unknown', port: DEFAULT_SETLIST_PORT }
  if (file.kind === 'torn') return previous ?? { enabled: 'unknown', port: DEFAULT_SETLIST_PORT }

  const { SetlistServerEnable, SetlistServerPort } = file.values

  return {
    enabled:
      typeof SetlistServerEnable === 'boolean' ? (SetlistServerEnable ? 'on' : 'off') : 'absent',
    port:
      Number.isInteger(SetlistServerPort) &&
      (SetlistServerPort as number) >= 1024 &&
      (SetlistServerPort as number) <= 65535
        ? (SetlistServerPort as number)
        : DEFAULT_SETLIST_PORT,
  }
}
