/**
 * Which columns the table draws, chosen from the table's own corner.
 *
 * **It lives in the one header cell that names no column.** Every row leads
 * with a 48px cover, so the sort header reserves 48px before `title` and leaves
 * it empty — there is no ordering to offer, since sorting by album art is not a
 * thing. That empty square is the exact place a control over *all* the columns
 * belongs: it costs the table no width, it is already aligned to the grid, and
 * a corner cell configuring the header it sits in is a pattern anybody who has
 * used a spreadsheet already knows. Anywhere else in the header would have
 * taken its width out of a column and left the labels no longer naming the
 * things beneath them.
 *
 * It exists only where the table does. Below 672px of list there is no header,
 * no columns, and one mark per row instead — that choice is a `row shows`
 * control in the compact sort panel, which is visible at exactly the widths
 * this is not.
 *
 * Chips rather than a checklist, because the filter panel is already a wall of
 * chips and a column is the same kind of thing: one of a closed set of seven,
 * on or off, everything visible at once, no scrolling and no search box.
 */

import { useEffect, useRef, useState } from 'react'

import { ToggleChip, cx } from '../../ui'
import type { DifficultyLens } from '../../lib/difficulty'
import type { ListView } from './columns'
import {
  DEFAULT_VIEW,
  OPTIONAL_COLUMNS,
  columnLabel,
  isCramped,
  isDefaultColumns,
  toggleColumn,
} from './columns'

/**
 * Names the columns that are on and cannot be drawn, in the reader's own
 * language. `Intl` rather than `join(', ')` so the last comma becomes an `and`
 * — and becomes whatever the reader's locale does instead.
 */
const NAMES = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' })

export function ColumnPicker({
  view,
  onChange,
  lens,
  listWidth,
}: {
  view: ListView
  onChange: (view: ListView) => void
  /** Only reaches the `diff` chip, which renames itself. See `columnLabel`. */
  lens: DifficultyLens
  /** The list's own width, which decides what the chosen columns can do. */
  listWidth: number
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  /**
   * A click anywhere else puts it away.
   *
   * `pointerdown` rather than `click`: a popover that waits for the button
   * release stays open under the finger through the whole gesture, and on a
   * touchscreen that reads as a control that ignored you. Registered only while
   * open, so the closed state costs nothing.
   */
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target) === true) return

      setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const cramped = OPTIONAL_COLUMNS.filter((column) => isCramped(view, column, listWidth))

  return (
    <div
      ref={rootRef}
      /*
       * Anchors the panel and gives it something to be measured from. The
       * header is a flex row, so this has to hold the cover slot's exact 48px
       * or every label below shifts left by the difference.
       */
      className="relative size-[48px] shrink-0"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return

        /*
         * Escape closes this and stops there. The app shell listens for the
         * same key on `window` and unwinds the whole view with it — closing the
         * open song, then clearing every filter — so a reflex that dismisses a
         * popover would otherwise also throw away the work the popover was
         * opened next to. Same reason `LensPicker` stops the arrow keys.
         */
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="column-picker"
        aria-haspopup="true"
        aria-label="Choose which columns the list shows"
        title="Columns"
        className={cx(
          'yarg-focusable flex size-full cursor-pointer items-center justify-center',
          'transition-opacity duration-160',
          // The header's own idiom for a control at rest and a control that is
          // doing something — the same pair every sort label wears.
          open ? 'text-white opacity-100' : 'text-content-header opacity-70 hover:opacity-100',
        )}
      >
        <ColumnsIcon />
      </button>

      {open ? (
        <div
          id="column-picker"
          role="group"
          aria-label="Columns"
          /*
           * Over the rows, not among them. The scroll container is a later
           * sibling with positioned content of its own, so without a stacking
           * order of its own this panel would paint underneath the songs it is
           * drawn on top of.
           */
          className="absolute top-full left-0 z-30 mt-[6px] flex w-[290px] flex-col gap-[10px] p-[15px]"
          style={{
            borderRadius: 'var(--radius-md)',
            /*
             * Sunken, which is the darkest surface in the palette — the same
             * choice the phone's filter sheet makes for the same reason. Every
             * surface here sits within 1.15:1 of every other, so a panel
             * floating over the rows has to be read by its edge rather than by
             * its fill, and the lit accent stroke says it is the thing that is
             * currently open.
             */
            background: 'var(--yarg-surface-sunken)',
            boxShadow: 'inset 0 0 0 var(--stroke) var(--accent-edge), var(--shadow-bar)',
          }}
        >
          <div className="flex items-center gap-[10px]">
            <span className="yarg-label text-[11px] text-count-muted">columns</span>
            {isDefaultColumns(view) ? null : (
              <button
                type="button"
                onClick={() => onChange({ ...view, columns: DEFAULT_VIEW.columns })}
                aria-label="Put the columns back to their defaults"
                className={cx(
                  'yarg-label yarg-focusable tap-target ml-auto shrink-0 cursor-pointer',
                  'text-[10px] text-accent hover:text-white',
                )}
              >
                reset
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-[8px]">
            {OPTIONAL_COLUMNS.map((column) => {
              const name = columnLabel(column, lens)

              return (
                <ToggleChip
                  key={column.id}
                  active={view.columns.has(column.id)}
                  onClick={() => onChange(toggleColumn(view, column.id))}
                  label={
                    view.columns.has(column.id)
                      ? `Hide the ${name} column`
                      : `Show the ${name} column`
                  }
                >
                  {name}
                </ToggleChip>
              )
            })}
          </div>

          {cramped.length > 0 ? (
            /*
             * Says the thing the chips cannot.
             *
             * A column can be switched on and still not be here, because the
             * table keeps a floor under each one — see `columns.ts`. Without
             * this line, turning on `album` at 980px does nothing visible and
             * the control reads as broken. Stated as what will happen rather
             * than as an error, because nothing is wrong: the setting is saved
             * and the column is waiting.
             */
            <p className="text-[12px] leading-snug text-content-faint">
              {NAMES.format(cramped.map((column) => columnLabel(column, lens)))}{' '}
              {cramped.length === 1 ? 'appears' : 'appear'} when the list gets wider.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Three columns, drawn at the same weight and with the same round caps as the
 * chevrons in `ui/index.tsx`.
 *
 * Strokes rather than filled rectangles so it inherits `currentColor` and moves
 * with the header label beside it, from 70% opacity at rest to full when this
 * is the thing that is open.
 */
function ColumnsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <path
        d="M3 2.75v10.5M8 2.75v10.5M13 2.75v10.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
