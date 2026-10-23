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
  if (!yargDataDir) return DEFAULT_YARG_SETTINGS

  let text: string
  try {
    text = await readFile(yargSettingsPath(yargDataDir), 'utf8')
  } catch {
    return DEFAULT_YARG_SETTINGS
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return previous ?? DEFAULT_YARG_SETTINGS
  }

  if (typeof raw !== 'object' || raw === null) return DEFAULT_YARG_SETTINGS
  const { Genrelizer, CensorMatureContent } = raw as Record<string, unknown>

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
