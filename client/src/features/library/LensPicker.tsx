/**
 * The difficulty lens: which part every number on the list is about.
 *
 * Its own file, beside `FacetPicker`, for the reason `IndexRail` is beside
 * `SongList` — this is a complete control with roving focus, radiogroup
 * semantics and a keyboard contract to keep, and none of that belongs inline in
 * the panel that happens to host it.
 *
 * What the lens *means* lives in `lib/difficulty.ts`; this only draws it.
 */

import { useRef } from 'react'

import { GROUP_ART, INSTRUMENT_ART } from '../../design/assets'
import type { DifficultyLens } from '../../lib/difficulty'
import { DIFFICULTY_LENSES, LENS_LABELS } from '../../lib/difficulty'
import { cx } from '../../ui'

/**
 * Which part every difficulty on this surface is about.
 *
 * Pictures rather than words, and that is not decoration — these six glyphs are
 * already the app's instrument vocabulary. They are what the parts column draws
 * on every row, what sits inside all five rings in the detail pane, and now
 * what sits inside the ring in the `diff` column. Somebody who has scrolled this
 * library for thirty seconds has been taught this alphabet whether or not they
 * noticed, so the control that switches between them can be the alphabet itself.
 *
 * The names are not lost: the section heading beside this reads the selected
 * one, every pill carries it as its accessible name and its tooltip, and the
 * token row spells it out once it is off the default.
 *
 * Six 44px pills come to 284px with their gaps, which fits one row on the
 * narrowest phone this app supports — the reason to draw pictures rather than
 * `Guitar Bass Drums Keys Vocals` wrapping to three lines above the chips they
 * qualify.
 *
 * **A radiogroup, not six toggle buttons.** Exactly one is always chosen, which
 * `aria-pressed` cannot say. The arrow keys walk it, and the handler stops them
 * before they reach the app shell — which walks the *song selection* with the
 * same two keys wherever focus happens to be.
 */
export function LensPicker({
  value,
  onChange,
}: {
  value: DifficultyLens
  onChange: (lens: DifficultyLens) => void
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const move = (from: number, step: number) => {
    // Wraps, which is what a radiogroup does and what six pills in a ring want.
    const next = (from + step + DIFFICULTY_LENSES.length) % DIFFICULTY_LENSES.length
    const lens = DIFFICULTY_LENSES[next]
    if (lens === undefined) return

    onChange(lens)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Show difficulty for"
      className="flex flex-wrap gap-[8px]"
      onKeyDown={(event) => {
        const index = DIFFICULTY_LENSES.indexOf(value)
        const step =
          event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? -1
              : null

        if (step === null) return

        event.preventDefault()
        // The app shell walks the song selection with these same two keys. Both
        // readings are right where they apply and only one applies in here.
        event.stopPropagation()
        move(index, step)
      }}
    >
      {DIFFICULTY_LENSES.map((lens, index) => {
        const active = lens === value
        const art = lens === 'band' ? (INSTRUMENT_ART['band'] ?? '') : GROUP_ART[lens]

        return (
          <button
            key={lens}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // One tab stop for the group, landing on the chosen pill; arrows
            // walk from there. The same roving pattern the jump rail uses.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(lens)}
            title={`${LENS_LABELS[lens]} difficulty`}
            aria-label={`Show ${LENS_LABELS[lens]} difficulty`}
            className={cx(
              'yarg-focusable flex size-[44px] shrink-0 cursor-pointer items-center justify-center',
              'transition-[background,box-shadow] duration-160',
              // Inactive glyphs sit back without disappearing — dimmer than the
              // chosen one, brighter than the 20% the parts strip uses for a
              // part that isn't there, because none of these is absent.
              active ? '[&_img]:opacity-100' : '[&_img]:opacity-45 hover:[&_img]:opacity-100',
            )}
            style={{
              borderRadius: 'var(--radius-pill)',
              background: active ? 'var(--accent-tint)' : 'transparent',
              boxShadow: `inset 0 0 0 var(--stroke) ${
                active ? 'var(--accent-edge)' : 'var(--color-border-strong)'
              }`,
            }}
          >
            <img
              src={art}
              alt=""
              aria-hidden
              width={26}
              height={26}
              loading="lazy"
              decoding="async"
              className="shrink-0 object-contain transition-opacity duration-160"
              style={{ width: 26, height: 26 }}
            />
          </button>
        )
      })}
    </div>
  )
}
