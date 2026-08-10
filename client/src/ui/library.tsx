/**
 * Display pieces that turn a `Song`'s raw fields into the design system's art.
 *
 * These live outside `features/` because both the song list and the
 * now-playing banner need them, and neither owns the other.
 */

import type { InstrumentGroup, Song } from '@shared/types'
import { INSTRUMENT_GROUPS, INSTRUMENTS } from '@shared/types'

import { GROUP_ART } from '../design/assets'
import { resolveSource } from '../lib/sources'
import { cx } from './index'

const GROUP_LABELS: Record<InstrumentGroup, string> = {
  guitar: 'Guitar',
  bass: 'Bass',
  drums: 'Drums',
  keys: 'Keys',
  vocals: 'Vocals',
}

/** `InstrumentKey` → its family, built once from the shared instrument table. */
const GROUP_OF = new Map<string, InstrumentGroup>(
  INSTRUMENTS.map((instrument) => [instrument.key, instrument.group]),
)

/** Which instrument groups this chart actually has parts for. */
function chartedGroups(song: Song): Set<InstrumentGroup> {
  const present = new Set<InstrumentGroup>()

  for (const [key, tier] of Object.entries(song.difficulties)) {
    if (tier === null) continue
    const group = GROUP_OF.get(key)
    if (group !== undefined) present.add(group)
  }

  return present
}

/**
 * The source a chart came from, as YARG draws it.
 *
 * The CSV writes an internal id — `rb3dlc`, `gh2`, `RB4` — which is what the
 * list used to render verbatim. `resolveSource` turns that into the name and
 * icon from YARG's own OpenSource registry.
 */
export function SourceBadge({
  source,
  size = 20,
  showName = true,
  className,
}: {
  source: string
  size?: number
  /** False in tight columns where the icon alone has to carry it. */
  showName?: boolean
  className?: string
}) {
  const resolved = resolveSource(source)

  return (
    <span
      className={cx('flex min-w-0 items-center gap-[8px]', className)}
      // The icon repeats the name when both are shown, so the title only
      // earns its place as the tooltip for an icon standing alone.
      title={showName ? undefined : resolved.name}
    >
      {resolved.iconUrl !== null ? (
        <img
          src={resolved.iconUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="shrink-0 object-contain"
          style={{ width: size, height: size }}
        />
      ) : null}
      {showName ? (
        <span className="truncate text-[13px] text-content-muted">{resolved.name}</span>
      ) : (
        <span className="sr-only">{resolved.name}</span>
      )}
    </span>
  )
}

/**
 * Which instruments this chart covers.
 *
 * The library carries a difficulty for all twenty instrument keys and showed
 * none of them, so "can the four of us play this" was answerable only by
 * setting a filter and watching rows disappear. Five glyphs answer it in place.
 *
 * Absent parts stay in the layout rather than collapsing — a row of five slots
 * in a fixed order is scannable down a column, and a row that reflows per song
 * is not.
 */
export function InstrumentStrip({
  song,
  size = 18,
  className,
}: {
  song: Song
  size?: number
  className?: string
}) {
  const present = chartedGroups(song)
  const names = INSTRUMENT_GROUPS.filter((group) => present.has(group)).map(
    (group) => GROUP_LABELS[group],
  )

  return (
    <span
      className={cx('flex shrink-0 items-center gap-[6px]', className)}
      role="img"
      aria-label={names.length === 0 ? 'No charted parts' : `Parts: ${names.join(', ')}`}
    >
      {INSTRUMENT_GROUPS.map((group) => (
        <img
          key={group}
          src={GROUP_ART[group]}
          alt=""
          aria-hidden
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className={cx(
            'shrink-0 object-contain transition-opacity duration-160',
            present.has(group) ? 'opacity-100' : 'opacity-20',
          )}
          style={{ width: size, height: size }}
        />
      ))}
    </span>
  )
}
