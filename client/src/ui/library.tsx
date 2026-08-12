/**
 * Display pieces that turn a `Song`'s raw fields into the design system's art.
 *
 * These live outside `features/` because both the song list and the
 * now-playing banner need them, and neither owns the other.
 */

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import type { InstrumentGroup, Song } from '@shared/types'
import { INSTRUMENT_GROUPS, INSTRUMENTS } from '@shared/types'

import { GROUP_ART, INSTRUMENT_ART } from '../design/assets'
import { artUrl } from '../lib/api'
import type { DifficultyLens } from '../lib/difficulty'
import { LENS_LABELS, groupTier, lensTier } from '../lib/difficulty'
import { artistCredit, formatVocalParts, titleCredit } from '../lib/format'
import { resolveSource } from '../lib/sources'
import type { PreviewStatus } from '../lib/usePreview'
import { Button, cx } from './index'

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
/**
 * A song's cover, at the size the list needs it.
 *
 * The picture that identifies a *record*, which is why it leads a row: at a
 * glance across a table it is the fastest thing on screen to recognise, faster
 * than a title you have to read.
 *
 * `loading="lazy"` and `decoding="async"` are not optional at this scale. The
 * list is virtualized so only ~17 rows exist at once, but scrolling four
 * thousand songs still walks past every cover in the library, and a synchronous
 * decode on the main thread is a stutter per row on a phone.
 *
 * **When it fails, it disappears.** A song whose art the server promised and
 * then could not deliver — a chart that moved, a share that dropped — renders
 * nothing rather than a broken-image glyph or a grey square, so the row falls
 * back to exactly the layout it had before any of this existed.
 */
export function AlbumThumb({
  song,
  size,
  className,
}: {
  song: Song
  size: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (!song.hasArt || song.hash === null || failed) return null

  return (
    <img
      src={artUrl(song.hash, 'sm')}
      // Decorative: the title and artist sit directly beside it, and a screen
      // reader announcing "Rumours album cover" before every row title is
      // noise in a list somebody is moving through one song at a time.
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cx('shrink-0 object-cover', className)}
      // Not a token: this is an image slot, and the system's card radius is
      // for surfaces. A cover is a square with its corners eased, matching the
      // detail plate directly.
      style={{ borderRadius: 'var(--radius-sm)', background: 'var(--yarg-surface-sunken)' }}
    />
  )
}

/**
 * A speaker, with waves or with a cross through it.
 *
 * Drawn rather than imported because the design system has no audio glyph — its
 * icon set is instruments and gamepad buttons, which is what a game menu needs.
 * The cone is filled and everything hung off it is stroked, so the two states
 * differ in the mark beside the speaker rather than in the speaker itself.
 */
function SpeakerGlyph({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden className="shrink-0">
      <path
        fill="currentColor"
        d="M4 9h3.6L12.4 5.1A.75.75 0 0 1 13.6 5.7v12.6a.75.75 0 0 1-1.2.6L7.6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z"
      />
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {muted ? (
          <>
            <path d="M17 9.5l5 5" />
            <path d="M22 9.5l-5 5" />
          </>
        ) : (
          <>
            <path d="M16.8 9.2a4 4 0 0 1 0 5.6" />
            <path d="M19.6 6.8a7.5 7.5 0 0 1 0 10.4" />
          </>
        )}
      </g>
    </svg>
  )
}

/**
 * Whether previews make a sound.
 *
 * The only preview control in the app. There is no per-song play button: a
 * preview follows the selection and loops for as long as that song is the one
 * being looked at, so the only decision left to a person is whether they want
 * to hear it at all — and that is a property of the room, not of the song.
 *
 * **Labelled with the verb, not the state.** `aria-pressed` on an unlabelled
 * speaker would be the compact version and it would put the one question that
 * matters — is this thing about to make noise in a quiet room — behind an icon
 * somebody has to interpret. The button says what the tap will do.
 *
 * Accent only while the sound is on, which is the same rule the rest of this
 * system uses for it: the accent marks the state that is doing something. Off,
 * it takes the neutral fill — **and it keeps the fill**, which is not a detail.
 * The quiet variant was the first cut and it made the muted state, which is the
 * state every device starts in, a line of white text with an icon: the only
 * affordance the feature has, drawn as if it were a caption. A control nobody
 * can tell is a control is a feature nobody finds.
 *
 * Nothing here is positioned over a cover. That was the first design, and a
 * disc on the artwork is exactly what album art is for looking at.
 */
export function PreviewSoundToggle({
  muted,
  status,
  onToggle,
  className,
}: {
  muted: boolean
  status: PreviewStatus
  onToggle: () => void
  className?: string
}) {
  /*
   * A cold preview is generated on the spot, which takes about a second — the
   * one wait in this feature anybody notices. The pulse is the whole report:
   * a spinner for one second is a flash of anxiety, and the button has already
   * said what it is doing.
   */
  const starting = !muted && status === 'loading'

  return (
    <Button
      tone={muted ? 'neutral' : 'accent'}
      aria-busy={starting || undefined}
      onClick={onToggle}
      icon={
        <span className={cx('flex', starting && 'animate-pulse')}>
          <SpeakerGlyph muted={muted} />
        </span>
      }
      className={className}
    >
      {muted ? 'play previews' : 'mute previews'}
    </Button>
  )
}

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
 * The song's name, and the asides that qualify it set quieter than it is.
 *
 * Two things get attached to a title in a YARG library and neither is part of
 * the name: who guests on the recording, and which recording it is.
 * `Love the Way You Lie (feat. Rihanna)`, `Tom Sawyer (Original Version)`. At
 * the title's own 22px semibold white they read as half the name — and in the
 * one column four thousand rows are scanned by, that is 40% of the headline
 * spent on the part nobody is looking for. `titleCredit` has already done the
 * reading, including pulling a credit out of the *artist* field when that is
 * where the library put it. This decides only how loud the result is.
 *
 * Emits no wrapper, for the same reason `ArtistName` doesn't: five housings set
 * their own size, colour, direction and truncation on the element around this,
 * and a `<span>` here would be one more layer for `truncate` to reach through.
 */
export function SongTitle({
  song,
  notes = 'inline',
}: {
  song: { name: string; artist: string }
  /**
   * Where the asides go.
   *
   * `inline` trails them on the title's own line, sized in `em` so one rule
   * serves a 22px table cell, a 17px phone row and a 22px banner. That is every
   * surface that has one line and has to truncate.
   *
   * `block` drops them underneath, and belongs only to the detail pane — the
   * one surface with room to spare and the one that refuses to truncate
   * anything, on the grounds that a long title is unreadable everywhere else.
   * Given a line of their own they stop competing with the title for width,
   * which is what the pane can afford and a row cannot.
   */
  notes?: 'inline' | 'block'
}) {
  const { title, featuring, version } = titleCredit(song)

  // Credit first, then the version note — the order a sleeve prints them in.
  const aside = [featuring, version].filter((note) => note !== null).join(' ')

  if (aside === '') return <>{title}</>

  /*
   * `<bdi>` around the aside, not `dir` on it.
   *
   * Every housing sets `dir="auto"`, which reads the first strong character of
   * the whole string — so a Hebrew title stays right-to-left, and an unisolated
   * `(feat. …)` dropped into it would have its brackets flipped around it.
   * Isolating the aside gives it its own reading without overruling the
   * title's, which is the same trade `ArtistName` makes for an RTL name inside
   * an English preamble.
   */
  if (notes === 'block') {
    return (
      <>
        {title}
        {/* 5px, against the 10px the pane puts between its own lines — so this
            reads as attached to the title above it rather than as the first of
            the three quieter lines below. */}
        <bdi className="mt-[5px] block text-[15px] leading-tight font-normal text-content-muted">
          {aside}
        </bdi>
      </>
    )
  }

  return (
    <>
      {title}{' '}
      {/* Down a step in size, all the way down in weight, and off white. Three
          moves rather than one because the title beside it is 22px semibold in
          pure white, and a single step off that still reads as part of the
          name — which is the thing this exists to stop. */}
      <bdi className="text-[0.82em] font-normal text-content-muted">{aside}</bdi>
    </>
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
 * The row's difficulty, wearing the same ring every part wears — around
 * whichever mark the lens is pointed at.
 *
 * **The song list is the only thing that renders this.** It was on three
 * surfaces and lost two of them for the same reason: the detail pane shows all
 * five per-part rings, which is what a summary summarises, and the banner is
 * a strip that says what is playing rather than a place anybody chooses from.
 * A row is where a summary earns its keep — one slot for difficulty, four
 * thousand rows to scan.
 *
 * **The mark in the middle is what makes the lens legible at all.** On a phone
 * row there is no column header, so the glyph is the only thing saying what the
 * ring is counting — and once that can be a drum kit rather than YARG's BAND
 * mark, it is the difference between "this song is a 5" and "the drums on this
 * song are a 2". The five instrument glyphs and the band mark are the same kind
 * of object drawn in the same disc-inside-a-ring style (see `design/README.md`
 * for where the band one came from), so swapping between them changes the
 * subject without changing the shape.
 *
 * A glyph in the middle also puts an over-6 tier on the badge at the bottom
 * edge rather than in the centre, which is the same place the parts grid puts
 * it. `DifficultyRing` decides that from the presence of children, so the two
 * agree without either of them being told.
 *
 * Zero is left as zero rather than reinterpreted. `Song` documents that `0` can
 * mean "present but untiered" as well as "trivial", and 205 of the 4,168 songs
 * in the library this was built against carry it — too many to silently relabel
 * on a guess. Deciding what YARG actually means needs the exporter, not this
 * component; the `title` says so for anything with a pointer.
 */
export function LensDifficulty({
  song,
  lens,
  size = 32,
}: {
  song: Song
  lens: DifficultyLens
  size?: number | string
}) {
  const tier = lensTier(song, lens)
  const art = lens === 'band' ? (INSTRUMENT_ART['band'] ?? '') : groupArt(lens, song)

  /*
   * "Band difficulty unrated" and "no drums charted" are different facts, and
   * the sentence has to be the one that is true — an instrument lens over a
   * song that never had that part is reporting an absence, not a missing
   * rating. Same distinction `unratedLabel` draws for the filter chip.
   */
  const name = lens === 'band' ? 'Band difficulty' : `${LENS_LABELS[lens]} difficulty`
  const absent = lens === 'band' ? 'Band difficulty unrated' : `No ${LENS_LABELS[lens].toLowerCase()} part`

  return (
    <span
      className="inline-flex items-center"
      title={tier === 0 ? 'Difficulty 0 — YARG also writes 0 for untiered charts' : undefined}
    >
      {/*
       * The exact tier, for anything that cannot see a ring. It is the only
       * place the number survives now, which is the reason it is a sentence and
       * not a digit.
       */}
      <span className="sr-only">{tier === null ? absent : `${name} ${tier}`}</span>
      <DifficultyRing tier={tier} size={size}>
        <img
          src={art}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          // Dimmed when unrated, which is the same thing a dim instrument means
          // in the parts grid: the ring has nothing to report.
          className={cx('size-full object-contain', tier === null ? 'opacity-20' : null)}
        />
      </DifficultyRing>
    </span>
  )
}

/**
 * Whether any part the grid draws is tiered 0.
 *
 * The caveat about what `0` means used to hang off band difficulty, which was
 * the number the detail pane led with. The pane doesn't show band difficulty
 * any more, but it still shows five per-part tiers and any of them can be 0
 * with exactly the same ambiguity — so the sentence follows the zeros rather
 * than the field it was written for.
 */
export function hasUntieredPart(song: Song): boolean {
  return INSTRUMENT_GROUPS.some((group) => groupTier(song, group) === 0)
}
