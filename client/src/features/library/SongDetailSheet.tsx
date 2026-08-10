/**
 * The song detail as a bottom sheet, for every width narrower than two panes.
 *
 * A native `<dialog>` opened with `showModal()`, not a hand-built overlay. That
 * one choice buys the focus trap, the Escape key, inertness of everything
 * behind it, and the top layer — four things this file would otherwise have to
 * implement and get subtly wrong. What is left here is the part the platform
 * has no opinion about: where the sheet sits, how it arrives, and how a thumb
 * throws it away.
 *
 * It rises from the bottom because that is the edge a hand can reach, and it
 * stops at 80% so the now-playing banner and a couple of song rows stay visible
 * above it — you can see what you are choosing between, and where you were.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { cx } from '../../ui'
import { useMediaQuery } from '../../lib/useMediaQuery'

/** How far down the sheet has to be thrown before letting go dismisses it. */
const DISMISS_DISTANCE = 90

/** Long enough to read as movement, short enough that nobody waits for it. */
const EXIT_MS = 200

export function SongDetailSheet({
  label,
  onClose,
  children,
}: {
  /** Names the dialog. The song's title, so a screen reader says what opened. */
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  /** Where the sheet is vertically: false until it has risen, then `drag` px. */
  const [entered, setEntered] = useState(reducedMotion)
  const [leaving, setLeaving] = useState(false)
  const [drag, setDrag] = useState(0)

  /** Non-null while a finger is down on the header. */
  const dragOrigin = useRef<number | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return

    dialog.showModal()

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

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // A mouse drags nothing. Pulling a sheet down is a touch gesture, and
    // binding it to the mouse would turn a stray click-and-wobble on the header
    // into a dismissal.
    if (event.pointerType === 'mouse') return

    dragOrigin.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragOrigin.current === null) return

    // Downward only. A sheet that follows a finger upward would imply it can go
    // full-screen, and it cannot.
    setDrag(Math.max(0, event.clientY - dragOrigin.current))
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
        'hidden max-h-[80svh] w-full max-w-none flex-col overflow-hidden open:flex',
        // 80% of a short screen is not a sheet, it is a letterbox. Where there
        // is no height to spare, the sheet takes nearly all of it and the list
        // behind gives up the two rows it was holding.
        '[@media(max-height:500px)]:max-h-[94svh]',
        'm-0 mt-auto bg-surface-card p-0 text-content',
        // Below two panes is not only phones: a 1000px window and a phone held
        // sideways both land here, and a sheet spanning the whole of either is
        // a banner, not a sheet. It stops growing and centres instead.
        'sm:mx-auto sm:max-w-[520px]',
        'backdrop:bg-[rgba(1,4,10,0.72)]',
      )}
      style={{
        borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
        border: 'none',
        // The same lit rule the filter sheet uses, for the same reason: every
        // surface in this palette is within 1.15:1 of every other, so a card
        // stroke would leave no visible edge between the sheet and the rows.
        borderTop: 'var(--stroke) solid rgba(69,216,254,0.5)',
        transform: `translateY(${offset})`,
        transition:
          reducedMotion || dragOrigin.current !== null
            ? 'none'
            : `transform ${EXIT_MS}ms var(--ease-standard)`,
      }}
    >
      <header
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative flex shrink-0 touch-none items-center justify-end px-[15px] pt-[14px] pb-[5px]"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-[7px] left-1/2 h-[4px] w-[44px] -translate-x-1/2 rounded-full bg-[var(--yarg-dark-6)]"
        />
        <button
          type="button"
          onClick={dismiss}
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
        )}
      >
        {children}
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
