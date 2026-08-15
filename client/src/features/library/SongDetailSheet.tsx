/**
 * The song detail as a sheet, for every width narrower than two panes.
 *
 * A native `<dialog>` opened with `showModal()`, not a hand-built overlay. That
 * one choice buys the focus trap, the Escape key, inertness of everything
 * behind it, and the top layer — four things this file would otherwise have to
 * implement and get subtly wrong. What is left here is the part the platform
 * has no opinion about: which edge the sheet sits against, how it arrives, and
 * how a thumb throws it away.
 *
 * ## It comes in from whichever edge the screen has room against
 *
 * Upright, that is the bottom: the edge a hand can reach, stopping at 80% so
 * the now-playing banner and a couple of song rows stay visible above it — you
 * can see what you are choosing between, and where you were.
 *
 * Sideways, the bottom edge is the wrong one and the whole gesture inverts. A
 * sheet rising into a 390px screen is a letterbox: at 80% it was 312px holding
 * a 180px cover, and the parts grid — the one thing the surface exists to
 * answer — sat below the fold on every song. So on a `short` screen the sheet
 * comes in from the **inline-end edge** at full height instead, about half the
 * width, and the list stays legible beside it. That is the same master-detail
 * the two-pane layout is, arriving as a dialog because at these widths there is
 * not room for both to be permanent — and it costs no new interaction, because
 * selecting a song is still the only gesture there is.
 *
 * Everything follows the edge: the transform axis, the drag axis, the corner
 * radii, the lit rule, and the grab, which moves rather than merely rotating.
 *
 * **The grab is the edge, not a mark near it.** A bottom sheet's header *is*
 * the edge you pull — the handle sits in it because the two are the same 375px
 * of screen. A side sheet's edge is its whole 390px leading side, and a handle
 * left in the header was a 44px tick in the top corner, five pixels from the
 * lit rule and marking a twelfth of the edge it claimed to be a grip on: it
 * read as a rendering artifact glued to the border. So the side sheet grows a
 * rail down that edge which owns the gesture and carries the pill at its
 * centre, and the header keeps neither. The affordance and the hit area become
 * one object, and the pill sits where the hand is going anyway.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { cx } from '../../ui'
import { SHORT_QUERY, useMediaQuery } from '../../lib/useMediaQuery'

/** How far the sheet has to be thrown before letting go dismisses it. */
const DISMISS_DISTANCE = 90

/** Long enough to read as movement, short enough that nobody waits for it. */
const EXIT_MS = 200

export function SongDetailSheet({
  label,
  leading,
  onClose,
  children,
}: {
  /** Names the dialog. The song's title, so a screen reader says what opened. */
  label: string
  /**
   * The left end of the header, opposite the close button.
   *
   * One slot rather than a named prop for the one thing in it, because the
   * sheet has no business knowing about previews — what it owns is a header
   * with a grab handle in the middle, a way out on the right, and room on the
   * left. See `features/preview/PreviewSound.tsx` for what fills it and why
   * that is where the sound control lives on a phone.
   */
  leading?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  /**
   * Which edge this sheet belongs to — see the file header.
   *
   * A media query rather than a class because three things here are not CSS:
   * which axis a finger is dragging along, which sign counts as "away", and
   * which transform the entrance and the exit interpolate. A `short:` variant
   * could move the box and would leave the gesture pointing at the old edge.
   */
  const side = useMediaQuery(SHORT_QUERY)

  /** Where the sheet is along its own axis: false until it has arrived. */
  const [entered, setEntered] = useState(reducedMotion)
  const [leaving, setLeaving] = useState(false)
  const [drag, setDrag] = useState(0)

  /** Non-null while a finger is down on the header. */
  const dragOrigin = useRef<number | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return

    dialog.showModal()

    /*
     * Focus the way out, rather than whatever happens to come first.
     *
     * `showModal` runs the dialog focusing steps, which take the first focusable
     * descendant — and the header now has a sound toggle to the left of the
     * close button. That put the opening focus ring around a preference on
     * every song anybody tapped. React's `autoFocus` cannot fix it: it calls
     * `focus()` on mount instead of setting the attribute the dialog algorithm
     * looks for, so it has already happened by the time this runs.
     */
    closeRef.current?.focus()

    // Two frames, not one: the first commits the off-screen transform, the
    // second is the earliest one that can transition away from it. Collapsing
    // this to a single frame makes the sheet appear already in place.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))

    return () => {
      cancelAnimationFrame(frame)
      dialog.close()
    }
  }, [])

  /**
   * Leave the way we arrived.
   *
   * The sheet unmounts when the selection clears, so the exit has to run first
   * and call back — otherwise a sheet that was dragged halfway down would
   * vanish from wherever the finger left it.
   */
  const dismiss = useCallback(() => {
    if (reducedMotion) {
      onClose()
      return
    }

    setLeaving(true)
    window.setTimeout(onClose, EXIT_MS)
  }, [onClose, reducedMotion])

  /** The coordinate the drag runs along: down from a bottom sheet, out from a side one. */
  const axis = (event: ReactPointerEvent<HTMLElement>) => (side ? event.clientX : event.clientY)

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // A mouse drags nothing. Throwing a sheet away is a touch gesture, and
    // binding it to the mouse would turn a stray click-and-wobble on the header
    // into a dismissal.
    if (event.pointerType === 'mouse') return

    dragOrigin.current = axis(event)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragOrigin.current === null) return

    // Away from the screen only. A sheet that followed a finger back inward
    // would imply it can grow, and it cannot — it is already at the size it
    // gets. Which direction "away" is depends on the edge it came from.
    setDrag(Math.max(0, axis(event) - dragOrigin.current))
  }

  const endDrag = () => {
    if (dragOrigin.current === null) return
    dragOrigin.current = null

    if (drag > DISMISS_DISTANCE) {
      dismiss()
    } else {
      setDrag(0)
    }
  }

  const offset = leaving || !entered ? '100%' : `${drag}px`

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      // Escape reaches the dialog as `cancel`. Taking it here means the key
      // gets the same exit as the drag and the close button, instead of
      // snapping the sheet out of existence.
      onCancel={(event) => {
        event.preventDefault()
        dismiss()
      }}
      // `::backdrop` cannot be clicked, but a click that lands on the dialog
      // box itself did not land on its contents — the contents fill it.
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss()
      }}
      className={cx(
        // `hidden open:flex` rather than a bare `flex`: an author rule beats
        // the UA's `dialog:not([open]) { display: none }` outright, so a plain
        // display utility would paint the sheet for the frame before
        // `showModal()` runs.
        'hidden flex-col overflow-hidden bg-surface-card p-0 text-content open:flex',
        'm-0 backdrop:bg-[rgba(1,4,10,0.72)]',
        // The bottom sheet: full width against the bottom edge, stopping at 80%.
        // `--app-vh` rather than a bare `80svh`: see `lib/viewportHeight.ts` for
        // the iOS 16 bug that makes `svh` alone unsafe here, and `100svh` is
        // this rule's own fallback for the one frame before that script runs.
        'tall:mt-auto tall:max-h-[calc(var(--app-vh,100svh)*0.8)] tall:w-full tall:max-w-none',
        // Below two panes is not only phones: a 1000px window upright lands
        // here too, and a sheet spanning the whole of one is a banner, not a
        // sheet. It stops growing and centres instead.
        'tall:sm:mx-auto tall:sm:max-w-[520px]',
        /*
         * The side sheet: the full height of a screen that has none to spare,
         * against the edge, at a width that leaves the list readable.
         *
         * `clamp` rather than a fixed width because the screens that land here
         * run from 568px to 1023px across. Half of an 844px phone is 439px,
         * which holds the parts grid at full size with the list keeping 405px
         * beside it — enough for the cover, the title and the artist on every
         * row. The 320px floor is what a 568px screen can spare; the 460px cap
         * is where the detail stops needing more and the list starts.
         */
        'short:ml-auto short:h-full short:max-h-none short:w-[clamp(320px,52%,460px)]',
        // The grab rail beside the sheet's column rather than above it.
        'short:flex-row',
        // Clear of the display cutout on the side the sheet is against. The
        // backdrop still runs under it, so the inset reads as the sheet sitting
        // beside the notch rather than as a gap at the edge of the screen.
        'short:mr-[env(safe-area-inset-right)]',
      )}
      style={{
        border: 'none',
        /*
         * Rounded on the two corners facing into the screen, square on the two
         * against the edge — the sheet is a panel that has slid in from
         * somewhere, not a card floating on the glass.
         *
         * The lit rule goes on the same edge as the radii, and it is the one
         * the filter sheet uses for the same measured reason: every surface in
         * this palette is within 1.15:1 of every other, so a card stroke would
         * leave no visible seam between the sheet and the rows behind it.
         */
        ...(side
          ? {
              borderRadius: 'var(--radius-lg) 0 0 var(--radius-lg)',
              borderLeft: 'var(--stroke) solid rgba(69,216,254,0.5)',
              transform: `translateX(${offset})`,
            }
          : {
              borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
              borderTop: 'var(--stroke) solid rgba(69,216,254,0.5)',
              transform: `translateY(${offset})`,
            }),
        transition:
          reducedMotion || dragOrigin.current !== null
            ? 'none'
            : `transform ${EXIT_MS}ms var(--ease-standard)`,
      }}
    >
      {/*
       * The side sheet's grab: the whole leading edge, carrying the pill in the
       * middle of it. See the file header for why this is a rail and not a mark
       * in the corner.
       *
       * 24px wide because that is what centres a 4px pill 10px clear of the lit
       * rule — the two are both vertical lines on the same edge, and at the 5px
       * the header version left between them they read as one smudged border. A
       * 24×390 hit area is also six times the 44px floor in the axis that
       * matters, on the gesture a thumb makes without looking.
       */}
      {side ? (
        <div
          aria-hidden
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="flex w-[24px] shrink-0 touch-none items-center justify-center"
        >
          <span className="h-[44px] w-[4px] rounded-full bg-[var(--yarg-dark-6)]" />
        </div>
      ) : null}

      {/*
       * The sheet's own column, so the rail can sit beside it.
       *
       * A wrapper in both modes rather than one in the side case: the dialog is
       * a row with two children when it has a rail and a column with one when it
       * does not, and either way this is the box the header and the scroller
       * stack in. Making it conditional would be two different trees for one
       * arrangement, which is the thing this file keeps not doing.
       */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={cx(
            'relative flex shrink-0 touch-none items-center justify-end px-[15px] pt-[14px] pb-[5px]',
            // 13px back off the top of a 390px screen. The close button keeps its
            // 44px either way — that is a target, not decoration.
            'short:pt-[5px] short:pb-0 short:pl-0',
          )}
        >
          {/*
           * The bottom sheet's handle, centred on the edge it is pulled from.
           *
           * Only there: the side sheet's rail above carries its own, and a second
           * pill up here would mark an edge that does not move.
           */}
          <span
            aria-hidden
            className={cx(
              'pointer-events-none absolute rounded-full bg-[var(--yarg-dark-6)]',
              'top-[7px] left-1/2 h-[4px] w-[44px] -translate-x-1/2',
              'short:hidden',
            )}
          />
          {/*
           * `mr-auto` on the slot rather than `justify-between` on the header:
           * what goes in here is hidden at the width where the helper bar takes
           * the job over, and a header justifying between one remaining child and
           * nothing would walk the close button to the left edge.
           */}
          {leading ? <span className="mr-auto">{leading}</span> : null}
          <button
            type="button"
            onClick={dismiss}
            ref={closeRef}
            aria-label="Close song details"
            className="yarg-focusable flex size-[44px] cursor-pointer items-center justify-center text-content-muted transition-colors duration-160 hover:text-white"
          >
            <CloseIcon />
          </button>
        </header>

        <div
          className={cx(
            'scrollbar-slim min-h-0 flex-1 overflow-y-auto overscroll-contain',
            // Home-indicator clearance, never less than the plate's own padding.
            'pb-[max(25px,env(safe-area-inset-bottom))]',
            // Under a side sheet the indicator is a short bar at the bottom of a
            // 390px column, and 25px of the little height there is would be spent
            // clearing something 21px tall. The bar's own inset is enough.
            'short:pb-[max(15px,env(safe-area-inset-bottom))]',
          )}
        >
          {children}
        </div>
      </div>
    </dialog>
  )
}

/** Drawn, at the same stroke as the sort chevron. */
function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M1 1L13 13M13 1L1 13"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}
