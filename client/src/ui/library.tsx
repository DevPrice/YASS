/**
 * Display pieces that turn a `Song`'s raw fields into the design system's art.
 *
 * These live outside `features/` because both the song list and the
 * now-playing banner need them, and neither owns the other.
 */

import type { CSSProperties, ReactNode } from 'react'

import type { InstrumentGroup, InstrumentKey, Song } from '@shared/types'
import { INSTRUMENT_GROUPS, INSTRUMENTS } from '@shared/types'

import { GROUP_ART, INSTRUMENT_ART } from '../design/assets'
import { artistCredit, formatVocalParts } from '../lib/format'
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

/**
 * The vocals glyph, which is the only one that counts.
 *
 * The design system draws one microphone, two, or three, and YARG's export says
 * which — `Vocal Parts` is `0` instrumental, `1` solo, `2`–`3` harmonies. The
 * app used to answer that in words, in a `vocal parts: 3-part harmony` row of
 * the detail pane and a `vocals Solo vocals` stat in the banner, while drawing
 * a solo microphone next to both. The picture says it in the place the eye is
 * already looking, and the rows are gone.
 *
 * Falls back to the solo glyph rather than throwing if an export ever carries a
 * count nothing was drawn for. A song with four vocal parts should show a
 * microphone, not a broken image.
 */
function vocalsArt(parts: number): string {
  if (parts >= 3) return INSTRUMENT_ART['vocals-3harmony'] ?? GROUP_ART.vocals
  if (parts === 2) return INSTRUMENT_ART['vocals-2harmony'] ?? GROUP_ART.vocals

  return GROUP_ART.vocals
}

/** The glyph for a family, which is a fixed answer for four of the five. */
function groupArt(group: InstrumentGroup, song: Song): string {
  return group === 'vocals' ? vocalsArt(song.vocalParts) : GROUP_ART[group]
}

/**
 * What to call a part out loud.
 *
 * The harmony count is drawn and nowhere written, so this is the only place it
 * survives for anything that cannot see the glyph — which makes it load-bearing
 * rather than decorative. Parenthesised rather than comma'd because both
 * callers put this inside a list of other parts.
 *
 * Through `formatVocalParts` rather than interpolating a count, so the words
 * are still the ones the detail pane used to print. That function is why it
 * outlived the row it was written for.
 */
function partName(group: InstrumentGroup, song: Song): string {
  const label = GROUP_LABELS[group]
  if (group !== 'vocals' || song.vocalParts < 2) return label

  return `${label} (${formatVocalParts(song.vocalParts)})`
}

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
  const names = INSTRUMENT_GROUPS.filter((group) => present.has(group)).map((group) =>
    partName(group, song),
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
          src={groupArt(group, song)}
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
 * Six notches, because six is where the scale stops.
 *
 * A tier is `0`–`6` and the game draws it as a broken ring around the part it
 * belongs to — see `design/assets/difficulty/`, which ships one PNG per value.
 * Those rings are not used here: they are a fixed size and a fixed colour, they
 * cost a request each, and there are only 24 of them for a field the CSV does
 * not actually bound. Drawn instead, from the same proportions.
 */
const NOTCHES = 6

/**
 * The ring, in numbers.
 *
 * Everything is stated against a 100×100 `viewBox`, so one component serves a
 * 26px stat in the banner and a 42px cell in the parts grid without a second
 * set of values. The proportions are measured off the design system's own
 * rings, which are 500×500: a stroke 9% of the diameter, and about 16° of air
 * between one notch and the next.
 */
const RING_RADIUS = 45
const RING_STROKE = 9
/**
 * 13°, not the 16° traced off the art. The PNGs are drawn at 500px and read at
 * 42; at that size their spacing let the ring fall apart into six separate
 * marks, and the notches have to read as one broken circle for the count to
 * mean anything. Each gap is ~1px tighter here.
 */
const RING_GAP_DEGREES = 13

const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** One notch and the gap that follows it — a sixth of the way round. */
const NOTCH_SLOT = RING_CIRCUMFERENCE / NOTCHES
const NOTCH_GAP = (RING_CIRCUMFERENCE * RING_GAP_DEGREES) / 360
/**
 * Round caps hang half a stroke past each end of a dash, so the dash is cut a
 * full stroke short and the caps hand the length back. Drawn without that
 * subtraction every notch overruns its slot by 9 units and the gaps close up.
 */
const NOTCH_DASH = NOTCH_SLOT - NOTCH_GAP - RING_STROKE

/**
 * Everything the ring's text marks share.
 *
 * Both of them are SVG `<text>` in the ring's own viewBox, which is what lets
 * them size with the ring at any width with no CSS arithmetic and no custom
 * property to keep in step. That is not a stylistic preference: the first
 * version sized them from a `--ring-size` variable inside a `calc()`, and a
 * percentage in a `font-size` resolves against inherited type rather than
 * against the box — so the moment the ring became fluid, `min(72px, 100%)`
 * drew its numeral from 16px of body text. Stated in viewBox units the
 * question cannot come up.
 */
const RING_TEXT: {
  textAnchor: 'middle'
  dominantBaseline: 'central'
  style: CSSProperties
} = {
  textAnchor: 'middle',
  dominantBaseline: 'central',
  style: {
    fontFamily: 'var(--font-data)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
}

/**
 * What one notch is worth.
 *
 * **Unlit is drawn, not omitted.** A meter that only paints what it has lit is
 * a shape that changes with its value, and "three of six" is a comparison — the
 * track is what makes it one. It sits two rungs down the dark ramp, visible as
 * structure and never as a reading.
 *
 * **`null` drops to the bottom of the ramp**, because a part that is not charted
 * has to differ from a part tiered at 0 — and 0 lights nothing either, so the
 * lit notches cannot be what separates them. One rung apart was not enough: at
 * a glance the empty cell read as a meter sitting at zero rather than as a part
 * that isn't there. Two rungs down it barely lifts off the card, which is the
 * correct amount of presence for something that does not exist. The glyph
 * inside says the same thing at 20% opacity.
 *
 * **At 6 the whole ring turns red**, rather than the last notch alone. Six is
 * the ceiling, and the point of a ceiling is that it reads without counting. It
 * is also what makes the case above it legible — charts past 6 write their
 * number over this same full-red ring, so red means "at or past the top" in
 * both, and the numeral is what separates them.
 */
function notchFill(tier: number | null, index: number): string {
  if (tier === null) return 'var(--yarg-dark-4)'
  if (tier >= NOTCHES) return 'var(--color-danger)'

  return index < tier ? 'var(--yarg-white)' : 'var(--yarg-dark-6)'
}

/**
 * A tier as the game draws it: notches round a ring, and whatever the ring is
 * about in the middle of it.
 *
 * This replaced a numeral in three places. A number is exact and a ring is not,
 * which is the trade — but nobody reading a song list is doing arithmetic on
 * difficulty. They are asking "is this one hard", and a shape answers that
 * across a room and at a glance where `4` has to be read. The exact value stays
 * available to anything that needs it: it is in the accessible name.
 *
 * Purely decorative — the ring is `aria-hidden` and every caller names the
 * value in text of its own.
 */
export function DifficultyRing({
  tier,
  size = 32,
  children,
  className,
}: {
  tier: number | null
  /** Any CSS length. The ring is square and its contents scale with it. */
  size?: number | string
  /** What the ring is drawn around — an instrument glyph, a dash, nothing. */
  children?: ReactNode
  className?: string
}) {
  /*
   * Past the ceiling, the number itself.
   *
   * The ring counts to six and charts do go higher — the design system ships
   * rings as far as `21-plus`, and `parseDifficulty` clamps nothing above 0.
   * Rather than inventing a way to draw 9 on a six-notch meter, the ring maxes
   * out red and the value is written over it.
   */
  const overflow = tier !== null && tier > NOTCHES

  /*
   * Where the number goes depends on whether the middle is already spoken for.
   *
   * **Around a glyph it sits on the bottom edge**, white and outlined in black,
   * where the ring and the instrument meet. The first cut put it in the centre
   * and moved the glyph out of the way, which cost the cell the thing it is
   * actually scanned by: five parts read as five silhouettes, and a row of
   * numerals where the pictures were is five cells you have to read instead of
   * see. This adds the number without taking anything — the outline is what
   * buys it legibility over a white glyph and a red notch, in place of a plate
   * that would have to cut a hole in both.
   *
   * **On a bare ring it is simply centred.** Band difficulty has no glyph to
   * preserve, and the middle is the biggest, most legible place the number can
   * be — which matters, because that ring is drawn as small as 26px.
   */
  const badged = overflow && children !== null && children !== undefined

  return (
    <span
      aria-hidden
      className={cx('relative inline-flex shrink-0', className)}
      style={{
        width: size,
        // The ring gives way before its column does, whatever `size` asked for.
        maxWidth: '100%',
        aspectRatio: '1',
      }}
    >
      {/*
       * 74% of the ring, inside a hole that is 81% of the box.
       *
       * It was 62%, sized against art that was a bare disc filling its own box
       * edge to edge. The glyphs come from the design system's `Instruments`
       * frame now, where each one is a smaller disc inside its own thin ring
       * with a margin around it — so the same 62% drew an instrument about a
       * fifth smaller than the one it replaced. 70% puts the *instrument* back
       * past the size it used to read, and the two rings end up concentric,
       * which looks deliberate because it is. 74% was the first try and closed
       * the gap between them to a hairline, at which point the glyph's own ring
       * and the unlit notches started reading as one thick smudge.
       *
       * **Before the ring, not after.** The ring and the glyph never overlap,
       * so between those two the order is free — but the over-6 number is drawn
       * inside the ring's SVG and reaches up into the glyph's box, and the
       * instrument art is an opaque black disc. Painted second it took the tops
       * off the digits.
       */}
      <span className="absolute inset-[15%] flex items-center justify-center">{children}</span>
      <svg
        viewBox="0 0 100 100"
        fill="none"
        className="absolute inset-0 size-full"
        // The number below sits low enough that its stroke hangs past the
        // bottom of the box, and a browser's default on the outermost `<svg>`
        // is to clip at its own bounds.
        style={{ overflow: 'visible' }}
      >
        {/* -90° puts the first notch at twelve o'clock, so the ring fills
            clockwise from the top and the empty gap sits where the eye starts. */}
        <g transform="rotate(-90 50 50)">
          {Array.from({ length: NOTCHES }, (_, index) => (
            <circle
              key={index}
              cx="50"
              cy="50"
              r={RING_RADIUS}
              stroke={notchFill(tier, index)}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${NOTCH_DASH} ${RING_CIRCUMFERENCE - NOTCH_DASH}`}
              strokeDashoffset={-(index * NOTCH_SLOT + NOTCH_GAP / 2 + RING_STROKE / 2)}
            />
          ))}
        </g>
        {badged ? (
          /*
           * The number on the bottom edge, outlined rather than plated.
           *
           * `y=88` rather than dead centre on the arc at 95: this reads as a
           * number sitting low on the ring, and pushed to the centreline it
           * read as a number that had fallen off it.
           */
          <text
            {...RING_TEXT}
            x="50"
            y="88"
            fill="var(--yarg-white)"
            stroke="var(--yarg-dark-2)"
            /*
             * 16 units of stroke, half of which the fill paints back over — so
             * ~3.4px of black around each digit at the size the parts grid
             * draws this. Heavy on purpose: this is the outline a game puts on
             * a number over artwork, and at the 1.5px it started at the digits
             * were legible but looked like text that happened to land there
             * rather than a marker placed on the ring.
             *
             * `stroke-linejoin: round` matters at this weight. Mitred, the
             * corners of a `1` or a `2` throw spikes several units long.
             */
            strokeWidth="16"
            strokeLinejoin="round"
            style={{ ...RING_TEXT.style, paintOrder: 'stroke', fontSize: tier >= 10 ? 24 : 30 }}
          >
            {tier}
          </text>
        ) : null}
        {/*
         * The bare ring's middle: the number when it overflows the scale, an em
         * dash when the tier is unrated. Only ever reached with no glyph in the
         * way — band difficulty, which is the one ring nothing is drawn inside.
         */}
        {!badged && (overflow || tier === null) ? (
          <text
            {...RING_TEXT}
            x="50"
            y="50"
            fill={tier === null ? 'var(--color-content-faint)' : 'var(--yarg-white)'}
            style={{
              ...RING_TEXT.style,
              // Two digits step down: at 44 a `21` spans most of the hole and
              // its shoulders sit on the notches either side.
              fontSize: tier !== null && tier >= 10 ? 36 : 44,
            }}
          >
            {tier === null ? '—' : tier}
          </text>
        ) : null}
      </svg>
    </span>
  )
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
 * A cell is one mark now, and it used to be three stacked things — picture,
 * word, number — that had to be read top to bottom before any of them meant
 * anything. The number became the ring drawn *around* the glyph, so the part
 * and its difficulty are one shape; then the word went too. `GUITAR` under a
 * picture of a guitar is a caption on a photograph of itself, and five of them
 * set in uppercase extrabold were the loudest type in a pane whose headline is
 * the song title. The names survive in the accessible name of each cell, which
 * is where they were doing real work all along.
 *
 * Absent parts hold their slot rather than collapsing, so five songs read as a
 * matrix rather than five differently-shaped rows — and with the labels gone
 * that fixed order is the only thing saying which cell is which, which makes it
 * load-bearing rather than tidy.
 */
export function PartsGrid({ song }: { song: Song }) {
  return (
    /*
     * Named for a screen reader, because nothing on screen names it any more.
     * The heading that used to sit over this — `PARTS`, in the design system's
     * uppercase label — is gone along with the five words under the glyphs.
     */
    <ul aria-label="Parts" className="grid grid-cols-5 gap-[10px]">
      {INSTRUMENT_GROUPS.map((group) => {
        const tier = groupTier(song, group)
        const name = partName(group, song)

        return (
          <li
            key={group}
            aria-label={tier === null ? `${name}, not charted` : `${name}, difficulty ${tier}`}
            className="flex justify-center"
          >
            {/*
             * As wide as the column gives it, up to 68px.
             *
             * It was a flat 42px, chosen against the narrowest cell this grid
             * ever gets — 47.5px, in the detail pane at a 1024px window — and
             * then drawn at 42px in every wider pane too, which left a third of
             * the column empty. This is the one surface with room for the parts
             * and the only thing on it that is drawn rather than set; it should
             * take the room. A 1440px window gives ~74px cells, so the cap is
             * what stops five rings from closing up their 10px gaps, and the
             * percentage is what keeps them inside a 1024px pane.
             *
             * Safe to state as a percentage only because nothing inside the
             * ring is sized in CSS any more — see `RING_TEXT`.
             */}
            <DifficultyRing tier={tier} size="min(68px, 100%)">
              <img
                src={groupArt(group, song)}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className={cx('size-full object-contain', tier === null ? 'opacity-20' : null)}
              />
            </DifficultyRing>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Band difficulty, wearing the same ring every part wears.
 *
 * One number stands for five, so it is drawn the same way they are — the row,
 * the banner and the detail header all show a ring, and a reader who has
 * learned to read one has learned to read all of them. There is no glyph in the
 * middle because there is no instrument: the ring is the whole mark.
 *
 * Zero is left as zero rather than reinterpreted. `Song` documents that `0` can
 * mean "present but untiered" as well as "trivial", and 205 of the 4,168 songs
 * in the library this was built against carry it — too many to silently relabel
 * on a guess. Deciding what YARG actually means needs the exporter, not this
 * component; the detail view says so in words, where a phone can read it.
 */
export function BandDifficulty({
  tier,
  size = 32,
}: {
  tier: number | null
  size?: number | string
}) {
  return (
    <span
      className="inline-flex items-center"
      title={tier === 0 ? 'Difficulty 0 — YARG also writes 0 for untiered charts' : undefined}
    >
      {/*
       * The exact tier, for anything that cannot see a ring. It is also the
       * only place the number survives now, which is the reason it is a
       * sentence and not a digit.
       */}
      <span className="sr-only">
        {tier === null ? 'Band difficulty unrated' : `Band difficulty ${tier}`}
      </span>
      {/*
       * No glyph, which is what tells the ring its middle is free — that is
       * where an unrated dash and an over-6 numeral go. An unrated ring is
       * already dimmer than an unlit one, but "dimmer" is a judgement you can
       * only make with something to compare against, and in a song row there
       * is nothing beside it. The dash says it outright.
       */}
      <DifficultyRing tier={tier} size={size} />
    </span>
  )
}
