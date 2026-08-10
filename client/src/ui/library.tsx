/**
 * Display pieces that turn a `Song`'s raw fields into the design system's art.
 *
 * These live outside `features/` because both the song list and the
 * now-playing banner need them, and neither owns the other.
 */

import type { InstrumentGroup, InstrumentKey, Song } from '@shared/types'
import { INSTRUMENT_GROUPS, INSTRUMENTS } from '@shared/types'

import { GROUP_ART } from '../design/assets'
import { artistCredit } from '../lib/format'
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
  nameClassName,
}: {
  source: string
  size?: number
  /** False in tight columns where the icon alone has to carry it. */
  showName?: boolean
  className?: string
  /**
   * Overrides the name's own styling.
   *
   * The muted default is right in a table column, where the source is one of
   * nine things competing and the least urgent of them. It is wrong in the
   * detail view's fact list, where it is the answer to a question somebody
   * asked and every other answer is set in plain white.
   */
  nameClassName?: string
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
        // Replaces the default rather than appending to it. Two utilities for
        // the same property both land in the stylesheet and *its* order
        // decides, not this string's — so passing `text-content` alongside
        // `text-content-muted` left the source name grey while every other
        // value beside it was white.
        <span className={cx('truncate', nameClassName ?? 'text-[13px] text-content-muted')}>
          {resolved.name}
        </span>
      ) : (
        <span className="sr-only">{resolved.name}</span>
      )}
    </span>
  )
}

/**
 * The artist, said the way a karaoke book says it.
 *
 * Half a real library is somebody else's recording, and the app used to file
 * that under a `recording: Cover version` line at the bottom of the detail
 * pane — a fact you had to open a song and read to the end to learn, written
 * in the game's word for it. It belongs on the name it qualifies, everywhere
 * the name appears: `as made famous by Fleetwood Mac` is the same sentence in
 * a row, a banner and a pane.
 *
 * Emits no wrapper. The five places that show an artist each set their own
 * size, colour and truncation on the element around it, and a `<span>` here
 * would be one more thing for `truncate` to have to reach through.
 */
export function ArtistName({
  song,
  credit = 'inline',
}: {
  song: { artist: string; isMaster: boolean }
  /**
   * How the preamble is set.
   *
   * `inline` is the sentence, for the places built to hold one: the detail
   * pane, the banner, the art plate. `label` is YARG's own treatment of it in
   * the song browser — see `CoverCredit` — and belongs in the list, where the
   * artist is a column rather than a line of prose.
   */
  credit?: 'inline' | 'label'
}) {
  const { name, madeFamousBy } = artistCredit(song)

  if (credit === 'label') {
    /*
     * `min-h` is the height of the two-line credit, held whether or not there
     * is one. The phone row stacks title over artist, so an artist line that
     * grew for covers lifted its title 2px against every original around it —
     * small, and visible as a wobble down the one column being scanned.
     */
    return (
      <span className="flex min-h-[1.32em] min-w-0 items-center gap-[0.5em]">
        {madeFamousBy ? <CoverCredit /> : null}
        {/*
         * `<bdi>` here rather than `dir="auto"` on the cell: the cell now holds
         * the English preamble too, and auto-direction reads the first strong
         * character it finds, which would be the `a` of `as`. Isolating the
         * name gives Hebrew and Arabic artists their own direction back.
         */}
        <bdi className="min-w-0 truncate-tight">{name}</bdi>
      </span>
    )
  }

  // The bare name, unchanged: every housing sets `dir="auto"`, which reads the
  // first strong character of its own text, and returning anything wrapped here
  // would take that reading away from Hebrew and Arabic artists.
  if (!madeFamousBy) return <>{name}</>

  return (
    <>
      {/*
       * Upright and quiet against the italic name: this is the frame around the
       * credit, not part of it, and at full weight it out-shouted the artist in
       * a 4,000-row column where the artist is what you scan for.
       */}
      <span className="text-[0.82em] font-normal text-content-muted not-italic">
        as made famous by{' '}
      </span>
      {/*
       * `<bdi>`, because the English preamble has now decided the line is
       * left-to-right, and an RTL name dropped into it unisolated drags the
       * neighbouring punctuation around with it. This gives the name its own
       * direction back without touching the line's.
       */}
      <bdi>{name}</bdi>
    </>
  )
}

/**
 * The credit as YARG sets it in its own song browser: two short lines of small
 * italic capitals, ragged left, tucked against the artist's name.
 *
 * Two lines is what makes it affordable. Set as one line the phrase is 17
 * characters of leading text in a column that has ~200px for the artist, and
 * it was taking more of that column than the name it introduces. Broken over
 * `AS MADE / FAMOUS BY` it costs the width of its longer half.
 *
 * It sits in the flow rather than above the line, and the row centres it
 * against the name — so the names still share one baseline all the way down
 * the column, which is what a scanning eye is following.
 *
 * Sized in `em` so one component serves an 18px table cell and a 14px phone
 * row. Capitals come from CSS, not from the text, so a screen reader still
 * reads the words rather than spelling them.
 */
function CoverCredit() {
  return (
    <span
      className={cx(
        'shrink-0 text-right text-[0.56em] leading-[1.16] font-semibold tracking-[0.04em] uppercase',
        'text-content-muted',
      )}
    >
      as made
      <br />
      famous by
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

/**
 * The instrument a player is actually handed for each family.
 *
 * A group's difficulty is not one number — `guitar` spans 5-fret, 6-fret and
 * two Pro Guitar charts, and Pro Guitar routinely tiers three above the
 * standard one. Reporting the hardest would tell a guitarist a song is a 6 when
 * the chart they'll play is a 3; reporting the easiest would do the reverse. So
 * each family reports its standard chart, which is the one that gets picked
 * unless somebody has brought a special controller.
 */
const PRIMARY_KEY: Record<InstrumentGroup, InstrumentKey> = {
  guitar: 'guitar5',
  bass: 'bass5',
  drums: 'drums4',
  keys: 'keys',
  vocals: 'vocals',
}

/** The standard chart's tier, or the first alternate charted, or null. */
function groupTier(song: Song, group: InstrumentGroup): number | null {
  const primary = song.difficulties[PRIMARY_KEY[group]]
  if (primary !== null) return primary

  // Pro-only charts exist. A song with Pro Drums and no 4-lane still has drums,
  // and saying "no drums" because the standard chart is missing would be worse
  // than quoting the chart that does exist.
  for (const instrument of INSTRUMENTS) {
    if (instrument.group !== group) continue

    const tier = song.difficulties[instrument.key]
    if (tier !== null) return tier
  }

  return null
}

/**
 * What each family plays, and how hard.
 *
 * The list row can only afford a lit-or-dim glyph: it answers "does this have
 * drums". The wire has always carried the rest — twenty per-instrument tiers
 * per song, used as a filter predicate and displayed nowhere — and this is the
 * one surface with room for it. A band asks "how hard are the drums", and until
 * now the app could not answer.
 *
 * Absent parts hold their slot rather than collapsing, so five songs read as a
 * matrix rather than five differently-shaped rows.
 */
export function PartsGrid({ song }: { song: Song }) {
  return (
    <ul className="grid grid-cols-5 gap-[10px]">
      {INSTRUMENT_GROUPS.map((group) => {
        const tier = groupTier(song, group)
        const label = GROUP_LABELS[group]

        return (
          <li
            key={group}
            aria-label={tier === null ? `${label}, not charted` : `${label}, difficulty ${tier}`}
            className="flex flex-col items-center gap-[8px]"
          >
            <img
              src={GROUP_ART[group]}
              alt=""
              aria-hidden
              width={32}
              height={32}
              loading="lazy"
              decoding="async"
              className={cx('size-[32px] object-contain', tier === null ? 'opacity-20' : null)}
            />
            <span aria-hidden className="yarg-label text-[10px] text-count-muted">
              {label}
            </span>
            <span
              aria-hidden
              className={cx(
                'font-numeric text-[17px] font-semibold tabular-nums',
                tier === null ? 'text-content-faint' : 'text-count',
              )}
            >
              {tier === null ? '—' : tier}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Band difficulty in the design's rounded capsule.
 *
 * Zero is left as a number rather than reinterpreted. `Song` documents that `0`
 * can mean "present but untiered" as well as "trivial", and 205 of the 4,168
 * songs in the library this was built against carry it — too many to silently
 * relabel on a guess. Deciding what YARG actually means needs the exporter, not
 * this component; the detail view says so in words, where a phone can read it.
 */
export function DifficultyCapsule({ tier, size = 32 }: { tier: number | null; size?: number }) {
  const rated = tier !== null

  /*
   * One footprint for every value, rated or not.
   *
   * The unrated case used to be a bare dash with no capsule and no padding —
   * a third of the width of the pill beside it — so a phone row with an
   * untiered chart pulled its whole metadata line sideways. The two states
   * are the same box now and differ only in fill and colour.
   *
   * `tabular-nums` and `w-[1ch]` are what hold the rest of it still: Inter's
   * proportional figures give 1 and 4 different advances, and the em dash is
   * wider than either. Fixing the character cell to one digit makes all eight
   * possible values the same width, and the dash simply overhangs its cell
   * into padding that has 13px to spare.
   */
  return (
    <span
      title={
        tier === 0 ? 'Difficulty 0 — YARG also writes 0 for untiered charts' : undefined
      }
      className={cx(
        'font-numeric inline-flex items-center justify-center px-[13px]',
        'text-[16px] font-semibold tabular-nums',
        rated ? 'text-white' : 'text-content-faint',
      )}
      style={{
        height: size,
        borderRadius: 'var(--radius-round)',
        background: rated ? 'var(--yarg-surface-sunken)' : undefined,
      }}
    >
      <span className="sr-only">{rated ? 'Band difficulty ' : 'Difficulty unrated'}</span>
      {rated ? (
        <span className="inline-block w-[1ch] text-center">{tier}</span>
      ) : (
        <span aria-hidden className="inline-block w-[1ch] text-center">
          —
        </span>
      )}
    </span>
  )
}
