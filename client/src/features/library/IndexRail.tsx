/**
 * The jump rail: a scrubbable index down the outer edge of the song list.
 *
 * Four thousand songs have exactly one gesture through them — the flick — and a
 * flick answers "further down", never "at the M's". This is the second gesture.
 * Drag a thumb down the strip and the list follows mark for mark, with a
 * callout under the finger naming wherever you currently are.
 *
 * **The marks are evenly spaced, not proportional.** This is an index, not a
 * minimap: `M` sits at the middle of the rail whether the M's are forty songs
 * or four hundred, so the reach is learnable and stays learned. Proportional
 * spacing is the honest map of the scroll and it is the wrong instrument —
 * it would give a source with six songs a two-pixel target, and a target you
 * cannot hit is not on the index at all.
 *
 * **What the marks are is `indexing.ts`'s question, not this file's.** Letters
 * under the alphabetical sorts, decades under year, YARG's own difficulty names
 * under difficulty, the source badges themselves under source. All this knows
 * is that a mark has a glyph that fits a 38px strip and a label that does not.
 *
 * **A 38px strip cannot give 26 marks a 44px target, and does not try to.** The
 * touch answer here is not a bigger button, it is that the gesture is
 * correctable without lifting: the pointer is captured on contact, so a thumb
 * that lands on `N` slides to `M` and the list follows, with the callout saying
 * which one is live the whole way. A mis-tap costs a few millimetres rather
 * than a tap, a wait, and a second tap. Discrete precision is what the keyboard
 * path is for, and it has one.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import { cx } from '../../ui'
import type { IndexMark } from './indexing'

/**
 * How much room a mark needs before it is drawn as itself.
 *
 * Below its budget a mark still exists and is still reachable — it just draws
 * as a tick and lets its neighbours carry the labelling, which is how every
 * index of this shape has worked since the phone book. Icons need more room
 * than text because they are square and text is 10px tall.
 *
 * `TICK` is the floor for the mark existing at all. Nothing in a real library
 * comes near it: the largest set here is one mark per source, and the library
 * this was built against has 26 of them.
 */
const PITCH_TEXT = 15
const PITCH_ICON = 20
const PITCH_TICK = 5

/** Above this, a mark has room to be set larger. See `roomy`. */
const PITCH_ROOMY = 40

/**
 * How long the rail trusts its own jump over what the scroll position says.
 *
 * The lit mark is read back off the scroll offset, which means it arrives via a
 * scroll event and a re-render of a virtualized list several thousand rows
 * long. On a desktop that round trip is invisible. On a phone scrubbing at
 * 120Hz it is not: each move sets a new scroll offset before the last one has
 * been read back, the renders queue, and the notch settles a full mark behind
 * the finger — the rail saying `N` while `O` is under the thumb.
 *
 * There is nothing to measure here, though. The rail *knows* which mark it just
 * jumped to; asking the DOM where that landed is asking a question it already
 * has the answer to. So a jump asserts its own mark and the readback takes over
 * once things are quiet. Bounded by time rather than by "when the scroll
 * agrees", because a jump near the end of the list never fully arrives — the
 * last screenful cannot be scrolled to the top — and a commitment waiting for
 * agreement that cannot come would stick forever.
 */
const SETTLE_MS = 400

/**
 * The accent fill under the finger, and the only colour that can carry text.
 *
 * Same recipe as `Button`'s accent tone, for the same measured reason: white on
 * this fill composites to 2.90:1 over near-black, and Night on it is 6.88:1.
 * See the note on `BUTTON_TONES`.
 */
const TOUCH_FILL = 'color-mix(in srgb, var(--yarg-vivid-sky-blue) 75%, transparent)'

/**
 * The lane down the rail's outer edge that belongs to the notch alone.
 *
 * Every slot reserves it whether or not it is the lit one, which is the whole
 * trick: the notch had been drawn hard against a glyph that was already filling
 * a 34px strip, so `0–9` plus a marker read as a pipe character glued to the
 * label. Given a column of its own, the notch is a marker beside the rail's
 * contents rather than a stroke inside them — and because the lane is always
 * there, glyphs sit on the same centre line whether they are lit or not.
 */
const NOTCH_LANE = 6

/**
 * Air between a glyph and the seam the rail is drawn against.
 *
 * The notch lane is taken out of the right of every slot, and a glyph centred
 * in what is left sits that much closer to the left edge than the right — which
 * only shows up where a glyph nearly fills the strip. Measured on a 390px
 * phone, `30s` under the year sort and `3–5` under length are 25.8px and 25.1px
 * wide in a 28px slot, leaving 1.6px of air on the left against 6.6px on the
 * right: hard against the border, and visibly lopsided beside it.
 *
 * Held open on the left as well, and the rail widened by the same amount so the
 * glyph keeps every pixel it had. The capsule below is offset by both lanes for
 * the same reason, which keeps it concentric with the glyph at any width.
 */
const EDGE_PAD = 4

/** Half the accent — the app's "this control is live" edge. See `Disclosure`. */
const LIT_EDGE = 'color-mix(in srgb, var(--yarg-vivid-sky-blue) 50%, transparent)'

/**
 * The scrubber's tick.
 *
 * `vibrate` is Android and essentially nowhere else — iOS Safari has never
 * shipped it, and a desktop with no motor no-ops silently — so this is a
 * bonus on the devices that have it rather than something the interaction
 * depends on. Called only from the pointer path, which is a user gesture; the
 * API refuses outside one.
 */
function tick() {
  navigator.vibrate?.(3)
}

interface IndexRailProps {
  marks: readonly IndexMark[]
  /** The rendered item currently at the top of the list's viewport. */
  currentItem: number
  /** Scroll the list so this rendered item is at the top. */
  onJump: (itemIndex: number) => void
  /** What the marks divide — `artist`, `year`, `difficulty`. */
  sortLabel: string
}

export function IndexRail({ marks, currentItem, onJump, sortLabel }: IndexRailProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef<Array<HTMLButtonElement | null>>([])

  /**
   * The track's height, which decides how much each mark can draw.
   *
   * Measured rather than assumed because it is a flex child of the list's own
   * height: a phone in landscape, a desktop window dragged short, and the
   * filter sheet opening over the bottom of the list all change it, and each of
   * them changes how many labels fit.
   */
  const [height, setHeight] = useState(0)

  /**
   * The mark under the pointer, or null. Drives every lit state on the rail.
   *
   * Deliberately not "is the pointer down": on a mouse this is also the hover
   * preview, which is the whole reason a desktop reader can find out that the
   * `5` on the rail means `Nightmare` without committing to a jump first.
   */
  const [touched, setTouched] = useState<number | null>(null)

  /** Roving tab stop, once the keyboard has taken it off the scrolled position. */
  const [focused, setFocused] = useState<number | null>(null)

  /**
   * Whether the pointer is down, held in a ref because nothing renders from it.
   *
   * `pointermove` fires far faster than React commits, so a piece of state read
   * back inside the same gesture would lag the gesture. Everything visual comes
   * from `touched`, which is set on the same events and is allowed to lag by a
   * frame.
   */
  const scrubbing = useRef(false)

  /** The last mark jumped to, so a scrub across one mark scrolls once. */
  const jumped = useRef<number | null>(null)

  /** That same mark, held as the lit one while the scroll catches up. */
  const [pending, setPending] = useState<number | null>(null)
  const settleTimer = useRef<number | undefined>(undefined)

  // A new ordering is a new rail, and a commitment to a mark on the old one
  // means nothing. The cleanup also stops the timer on unmount.
  useEffect(() => {
    setPending(null)
    return () => window.clearTimeout(settleTimer.current)
  }, [marks])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (track === null) return

    const measure = () => setHeight(track.getBoundingClientRect().height)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  /**
   * The marks that get a slot.
   *
   * A safety net rather than a feature. Every ordering in the app tops out well
   * inside this — 28 letters, a dozen decades, eight intensities — but the
   * source and genre sorts index one mark per distinct value, and neither the
   * CSV nor OpenSource promises a ceiling. Sampling keeps a pathological
   * library from laying out four hundred sub-pixel slots; it costs reachability
   * for the marks it drops, which is the honest trade at a pitch where nothing
   * was reachable anyway.
   */
  const visible = useMemo(() => {
    if (height === 0) return marks

    const capacity = Math.max(1, Math.floor(height / PITCH_TICK))
    if (marks.length <= capacity) return marks

    const step = marks.length / capacity
    return Array.from({ length: capacity }, (_, index) => marks[Math.floor(index * step)]).filter(
      (mark): mark is IndexMark => mark !== undefined,
    )
  }, [marks, height])

  /**
   * Which mark the list is currently inside — the last one at or above the top
   * of the viewport.
   *
   * This is what makes the rail a readout and not just a control. Scrolling by
   * any means moves the lit mark, so the rail answers "where am I in four
   * thousand songs" continuously, which is a question the column headers above
   * the list have never been able to answer.
   */
  const scrolled = useMemo(() => {
    let found = 0
    for (let index = 0; index < visible.length; index += 1) {
      const mark = visible[index]
      if (mark === undefined || mark.index > currentItem) break
      found = index
    }

    return found
  }, [visible, currentItem])

  /**
   * The rail's own jump wins while it is still in flight; otherwise the scroll
   * position does. See `SETTLE_MS`.
   */
  const active = pending !== null && pending < visible.length ? pending : scrolled

  const pitch = visible.length === 0 ? 0 : height / visible.length
  const budget = visible.some((mark) => mark.glyph.kind === 'icon') ? PITCH_ICON : PITCH_TEXT
  /** Draw one mark in every `stride` as itself; the rest are ticks. */
  const stride = pitch >= budget || pitch === 0 ? 1 : Math.ceil(budget / pitch)

  /**
   * A rail with room to spare, which sets its type larger.
   *
   * The same rule as the stride above, running the other way. Length divides
   * into four marks and difficulty into eight, so their slots are 60 to 160px
   * tall — and 11px glyphs marooned in the middle of those read as a rail that
   * had failed to fill rather than one with four things to say. The alphabet
   * and the sources sit at 23px and stay where they are.
   */
  const roomy = pitch >= PITCH_ROOMY

  const jump = useCallback(
    (index: number, haptic: boolean) => {
      const mark = visible[index]
      if (mark === undefined) return

      setTouched(index)
      if (jumped.current === index) return

      jumped.current = index
      onJump(mark.index)
      if (haptic) tick()

      // Light it now rather than when the scroll reports back.
      setPending(index)
      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => setPending(null), SETTLE_MS)
    },
    [visible, onJump],
  )

  /**
   * Which mark a point on the rail means.
   *
   * Off the track's own box, so the padding above the first mark and below the
   * last resolve to those marks rather than to nothing — the two ends of an
   * index are the two places a thumb reaches for hardest, and they should be
   * the easiest things on it to hit.
   */
  const markAt = (clientY: number): number => {
    const track = trackRef.current
    if (track === null || visible.length === 0) return 0

    const box = track.getBoundingClientRect()
    const position = ((clientY - box.top) / box.height) * visible.length

    return Math.min(visible.length - 1, Math.max(0, Math.floor(position)))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    /*
     * Takes the gesture off the buttons underneath.
     *
     * Without this the same contact would also produce a click and move focus
     * to whichever slot the finger happened to land on first — which is
     * precisely the slot a scrub is about to correct away from. The buttons
     * stay for the keyboard, which reaches them by Tab rather than by touch.
     */
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    scrubbing.current = true
    jumped.current = null
    jump(markAt(event.clientY), true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const index = markAt(event.clientY)
    if (scrubbing.current) jump(index, true)
    else setTouched(index)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    scrubbing.current = false
    jumped.current = null

    // A mouse keeps the callout, because the pointer is still there and still
    // hovering something. A finger has no hover state to keep.
    if (event.pointerType !== 'mouse') setTouched(null)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const from = focused ?? active

    const target =
      event.key === 'ArrowDown'
        ? from + 1
        : event.key === 'ArrowUp'
          ? from - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? visible.length - 1
              : null

    if (target === null) return

    event.preventDefault()
    /*
     * The app shell walks the *selection* with these same two keys whenever a
     * song is selected, wherever focus happens to be. Both readings are right
     * where they apply, and only one of them applies inside the rail — so this
     * one takes the press rather than letting it do two things at once.
     */
    event.stopPropagation()

    const index = Math.min(visible.length - 1, Math.max(0, target))
    jumped.current = null
    jump(index, false)
    slotsRef.current[index]?.focus()
  }

  const touchedMark = touched === null ? null : (visible[touched] ?? null)
  const engaged = touchedMark !== null

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={`Jump through the list by ${sortLabel}`}
      className={cx(
        // A glyph's worth of strip plus both lanes — 10px of the numbers below.
        'flex w-[38px] shrink-0 flex-col py-[10px] select-none @2xl/list:w-[44px]',
        // The strip owns the gesture outright: a drag down it must scrub rather
        // than scroll the list behind it or pull the page down to refresh.
        'touch-none transition-colors duration-160',
        engaged ? 'bg-surface-sunken' : 'bg-surface-app',
      )}
      style={{
        // Every surface in this palette sits within 1.15:1 of every other, so
        // the seam between the rail and the rows is drawn rather than implied —
        // the same rule the detail pane's edge and the row rules follow. It
        // lights when the rail does, which is how the filter sheet says the
        // same thing.
        borderLeft: `var(--stroke-hairline) solid ${
          engaged ? LIT_EDGE : 'var(--color-border-row)'
        }`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => {
        if (!scrubbing.current) setTouched(null)
      }}
      /*
       * Focus leaving the rail — not one slot handing off to the next.
       *
       * A keyboard jump raises the callout too, because arrowing down the
       * difficulty rail should say `Moderate` rather than leaving a bare `3` to
       * be interpreted. There is no pointer to leave, so losing focus is what
       * has to take it back down; hung on the slots themselves that fired on
       * every arrow press, and each keystroke cleared the callout it had just
       * raised. `relatedTarget` is where focus is going, and while that is
       * still inside the rail nothing has been left.
       */
      onBlur={(event) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return

        setFocused(null)
        if (!scrubbing.current) setTouched(null)
      }}
      onKeyDown={handleKeyDown}
    >
      <div ref={trackRef} className="relative flex min-h-0 flex-1 flex-col">
        {visible.map((mark, index) => {
          const isActive = index === active
          const isTouched = index === touched
          // The lit mark always draws itself, whatever the stride — the one
          // thing on the rail that must never be a nameless tick is the one
          // saying where you are.
          const drawn = isActive || index % stride === 0

          return (
            <button
              key={mark.key}
              ref={(node) => {
                slotsRef.current[index] = node
              }}
              type="button"
              // One tab stop for the whole rail, landing on wherever the list
              // currently is; arrows walk from there. The same roving pattern
              // the rows use, and for the same reason — 26 tab stops between
              // the library and whatever follows it is a tunnel.
              tabIndex={index === (focused ?? active) ? 0 : -1}
              // "The current location within a container" is exactly what this
              // is, and it is the one `aria-current` value that says so.
              aria-current={isActive ? 'location' : undefined}
              aria-label={`Jump to ${mark.label}`}
              onClick={() => {
                jumped.current = null
                jump(index, false)
              }}
              // Cleared by the rail's own `onBlur`, which is the only place
              // that can tell "moved to the next mark" from "left".
              onFocus={() => setFocused(index)}
              className={cx(
                'relative flex cursor-pointer items-center justify-center',
                'transition-colors duration-90',
                isTouched
                  ? 'text-accent-content'
                  : isActive
                    ? 'text-accent'
                    : 'text-content-faint hover:text-content',
                // Inward: the ring is drawn on the slot's own edge, and a slot
                // pushing it outward would paint over its neighbours.
                'yarg-focusable focus-visible:[outline-offset:-2px]',
              )}
              style={{
                // Equal share of the track, which is the whole spacing model.
                flex: '1 1 0',
                minHeight: 0,
                // Both lanes, held open on every slot whether or not it is lit,
                // so glyphs share one centre line down the rail.
                paddingLeft: `${EDGE_PAD}px`,
                paddingRight: `${NOTCH_LANE}px`,
              }}
            >
              {/*
               * The fill under the finger is its own box rather than a
               * background on the slot, because a slot is however tall the
               * track divided by the marks makes it: 23px under 28 letters and
               * 158px under four length buckets. Painted on the slot itself,
               * the second of those was a cyan brick twice the height of a song
               * row. Capped, it is the same mark at every density.
               */}
              {isTouched ? (
                <span
                  aria-hidden
                  className="absolute top-1/2 rounded-full"
                  style={{
                    // Inset from each lane by the same 1px, which is what makes
                    // the capsule concentric with the glyph: its centre works
                    // out to `(width + EDGE_PAD - NOTCH_LANE) / 2` either way.
                    left: EDGE_PAD - 1,
                    right: NOTCH_LANE - 1,
                    height: 'min(24px, calc(100% - 2px))',
                    translate: '0 -50%',
                    background: TOUCH_FILL,
                  }}
                />
              ) : null}

              {/*
               * Where the list is, marked on the outer edge — the side the eye
               * is already on when it tracks a scrollbar.
               *
               * It stays lit under the finger, where it coincides with the
               * fill: every move during a scrub commits its jump, so "where I
               * am" and "where I would land" are the same mark, and the two
               * marks agreeing is the confirmation that the list went where it
               * was sent. They only part company when the list is scrolled by
               * some other means, which is when the notch is doing its own job.
               */}
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute top-1/2 rounded-full bg-accent"
                  style={{
                    right: 0,
                    width: 3,
                    height: 'min(20px, calc(100% - 4px))',
                    translate: '0 -50%',
                  }}
                />
              ) : null}

              <span className="relative">
                {drawn ? <Glyph glyph={mark.glyph} roomy={roomy} /> : <Tick />}
              </span>
            </button>
          )
        })}

        {/*
         * The callout, and the reason the glyphs are allowed to be terse.
         *
         * A rail slot has room for `5` and never for `Nightmare`; this is where
         * the other half of every mark lives. It sits to the left of the rail
         * because on a phone the rail itself is under a thumb — a callout on
         * the far side of the finger is a callout nobody reads.
         *
         * `aria-hidden`, because it repeats the accessible name of the slot it
         * is describing, and that slot is the thing actually being operated.
         */}
        {touchedMark !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute right-full z-20 mr-[12px] whitespace-nowrap"
            style={{
              // Clamped off its own half-height, so the first and last marks
              // put their callout beside the rail rather than half of it above
              // the sort header.
              top: `clamp(26px, ${((touched ?? 0) + 0.5) * (100 / visible.length)}%, calc(100% - 26px))`,
              translate: '0 -50%',
            }}
          >
            {/*
             * Set at 18px, which is larger than anything else in the app's
             * chrome and is the point. This is a heads-up readout during a
             * gesture, not a tooltip: it is read at speed, off-axis, by
             * somebody whose thumb is moving, and it has to win against a
             * screen full of song titles behind it. At the 14px it started at
             * it read as a stray chip that had come loose from the toolbar.
             *
             * `min-w` so `M` and `Rock Band 3 DLC` are the same object at
             * different lengths rather than a circle and a bar.
             */}
            <span
              className={cx(
                'yarg-label block min-w-[76px] bg-surface-sunken text-center',
                'px-[18px] py-[12px] text-[18px] text-white',
              )}
              style={{
                borderRadius: 'var(--radius-pill)',
                boxShadow: `inset 0 0 0 var(--stroke) ${LIT_EDGE}`,
              }}
            >
              {touchedMark.label}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Glyph({ glyph, roomy }: { glyph: IndexMark['glyph']; roomy: boolean }) {
  if (glyph.kind === 'icon') {
    const size = roomy ? 22 : 18
    return (
      <img
        src={glyph.src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <span
      className={cx(
        'leading-none',
        // Inter for the scales, Red Hat Display for the lettering — the app's
        // own division. A rail of decades set in the uppercase display face
        // read as lettering that happened to be digits; tabular Inter reads as
        // a ruler, which is what a decade or a tier is.
        glyph.numeric
          ? cx('font-numeric font-semibold tabular-nums', roomy ? 'text-[14px]' : 'text-[11px]')
          : cx('yarg-label', roomy ? 'text-[15px]' : 'text-[11px] @2xl/list:text-[12px]'),
      )}
    >
      {glyph.text}
    </span>
  )
}

/**
 * A mark with no room to name itself. Still a target, still in the sequence.
 *
 * At full strength in the slot's own colour rather than dimmed under it: the
 * ticks are what say the rail is continuous between the letters it could
 * afford, and a decimated rail whose gaps look empty is a rail that appears to
 * have nine destinations when it has twenty-eight.
 */
function Tick() {
  return <span aria-hidden className="h-[2px] w-[7px] rounded-full bg-current" />
}
