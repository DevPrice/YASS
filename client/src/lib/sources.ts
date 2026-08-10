/**
 * Song sources: raw CSV id → display name and icon.
 *
 * The YARG CSV export writes the chart's internal source id, so the library
 * arrives full of strings like `rb3dlc`, `gh2` and `RB4`. YARG resolves those
 * through **OpenSource**, a public-domain registry it downloads at runtime;
 * YASS carries the same registry as the `vendor/opensource` submodule and
 * resolves them at build time instead.
 *
 * Build time matters. The song list still comes from the exported CSV and
 * nothing else — this module contributes no data, only the names and pictures
 * for ids the CSV already contains, and it is baked into the bundle by Vite. A
 * YASS install never reads the YARG folder or the network to render a badge.
 *
 * Coverage against a real 4,168-song library: 24 of 26 distinct sources
 * resolve, 85% of songs. The rest fall through to `OVERRIDES` and then to a
 * generic badge, so an unknown id degrades to a readable name rather than a
 * broken image.
 */

import baseIndex from '@opensource/base/index.json'
import extraIndex from '@opensource/extra/index.json'

interface RegistryEntry {
  /** Every spelling of this source that has appeared in a chart. */
  ids: string[]
  names: Record<string, string>
  icon: string
  type: string
}

export interface SongSource {
  /** Human-readable name, e.g. `Rock Band 3 DLC`. */
  name: string
  /** Icon URL, or null when the registry has an entry but we have no art. */
  iconUrl: string | null
  /** True when this is the fallback rather than a real registry hit. */
  unknown: boolean
}

/**
 * Sources the registry doesn't know yet.
 *
 * Upstream OpenSource has no Fortnite Festival entry, and it accounts for 618
 * songs in the library this was built against — too many to render as a raw
 * id. `Unknown Source` is a literal the exporter writes when a chart declares
 * nothing at all.
 *
 * Anything added here is a candidate for a PR to OpenSource; the point is to
 * stay a short list, not to grow a second registry.
 */
const OVERRIDES: Record<string, string> = {
  fnfestival: 'Fortnite Festival',
  'unknown source': 'Unknown Source',
}

/**
 * Icon files, keyed by the registry's `icon` slug.
 *
 * `base` is the official games, `extra` the charter groups and community
 * packs. Vite fingerprints each one, so they inherit the year-long immutable
 * cache the server puts on `/assets/`. They are only fetched when a row
 * actually renders one.
 */
const ICON_URLS: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...import.meta.glob('@opensource/base/icons/*.png', {
      eager: true,
      query: '?url',
      import: 'default',
    }),
    ...import.meta.glob('@opensource/extra/icons/*.png', {
      eager: true,
      query: '?url',
      import: 'default',
    }),
  }).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1).replace(/\.png$/, ''),
    url as string,
  ]),
)

/** Every id spelling, lowercased, pointing at its registry entry. */
const BY_ID = new Map<string, RegistryEntry>()

for (const entry of [...baseIndex.sources, ...extraIndex.sources] as RegistryEntry[]) {
  for (const id of entry.ids) {
    BY_ID.set(id.toLowerCase(), entry)
  }
}

/** Registry names are keyed by locale; en-US is the only one always present. */
function displayName(entry: RegistryEntry): string {
  return entry.names['en-US'] ?? Object.values(entry.names)[0] ?? entry.icon
}

const UNKNOWN: SongSource = {
  name: 'Unknown',
  iconUrl: ICON_URLS['generic'] ?? null,
  unknown: true,
}

const cache = new Map<string, SongSource>()

/**
 * Resolve a CSV source id.
 *
 * Ids are matched case-insensitively because the exporter is inconsistent
 * about it — the same library contains `rb3dlc` and `RB4`.
 */
export function resolveSource(raw: string): SongSource {
  const key = raw.trim().toLowerCase()
  if (key === '') return UNKNOWN

  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const entry = BY_ID.get(key)
  const override = OVERRIDES[key]

  const resolved: SongSource =
    entry !== undefined
      ? { name: displayName(entry), iconUrl: ICON_URLS[entry.icon] ?? null, unknown: false }
      : override !== undefined
        ? { name: override, iconUrl: UNKNOWN.iconUrl, unknown: false }
        : UNKNOWN

  cache.set(key, resolved)
  return resolved
}

/** Just the name, for places that have no room for a badge. */
export function sourceName(raw: string): string {
  return resolveSource(raw).name
}
