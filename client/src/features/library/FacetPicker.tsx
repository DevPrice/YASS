/**
 * An open facet: 27 sources, 57 genres, no ceiling.
 *
 * Split out of `Filters.tsx` for the same reason `IndexRail` is not inside
 * `SongList` — it is a complete control with its own search, its own expansion
 * state and its own option row, and the panel that hosts it should read as a
 * list of dimensions rather than as the implementation of two of them.
 */

import { useMemo, useState } from 'react'

import type { FacetCount } from '@shared/types'
import { ChevronRight, TextField, cx } from '../../ui'
import { foldForSearch } from '../../lib/format'

/**
 * Cap the rows one picker draws at once.
 *
 * A safety net rather than a limit anyone meets: the largest open set in a real
 * library is 57 genres, and the search field above the list is the actual
 * answer for anything bigger. The list says so when it truncates rather than
 * quietly showing a prefix — a picker that silently drops the source you are
 * looking for is worse than one that admits it did.
 */
const MAX_FACET_OPTIONS = 200

/** Past this many options, a set is big enough to want searching. */
const SEARCHABLE_AT = 12

/**
 * An open set: 27 sources, 57 genres, no ceiling.
 *
 * Collapsed by default, because two 220px lists open inside a sheet capped at
 * 55vh is a phone showing filters and no songs. The closed row is not a stub
 * either — it carries the count of what is selected, which is the thing the
 * panel is being reopened to find out.
 *
 * Rows rather than chips once a set is this big. A chip cloud is scanned by
 * shape and works beautifully at eight values; at 57 it is a wall of ragged
 * rectangles with no alignment to run an eye down. Rows give every option the
 * same left edge, put the counts in a tabular column, and let the source badges
 * line up as a strip of pictures — which is how anybody actually finds
 * *Guitar Hero III* in a list.
 */
export function FacetPicker({
  label,
  options,
  selected,
  onToggle,
  onClear,
  format = (raw: string) => raw,
  iconFor,
}: {
  label: string
  options: ReadonlyArray<FacetCount>
  selected: readonly string[]
  onToggle: (value: string) => void
  onClear: () => void
  format?: (raw: string) => string
  iconFor?: (raw: string) => string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')

  const searchable = options.length > SEARCHABLE_AT

  /**
   * Matched against the *displayed* name, not the raw value.
   *
   * Typing "rock band" has to find `rb3dlc`, because `Rock Band 3 DLC` is the
   * only name of that source anybody has ever seen. Folded, so "motorhead"
   * finds "Motörhead" here exactly as it does in the main search field.
   */
  const matches = useMemo(() => {
    const term = foldForSearch(query.trim())
    if (term === '') return options

    return options.filter((option) => foldForSearch(format(option.value)).includes(term))
  }, [options, query, format])

  const shown = matches.slice(0, MAX_FACET_OPTIONS)
  const summary = selected.length === 0 ? 'All' : `${selected.length} selected`

  return (
    <section className="flex flex-col gap-[10px]">
      <div className="flex min-w-0 items-center gap-[10px]">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className={cx(
            'yarg-label yarg-focusable flex min-w-0 flex-1 cursor-pointer items-center gap-[8px]',
            'text-[11px] text-count-muted transition-colors duration-160 hover:text-content',
            'pointer-coarse:min-h-[44px]',
          )}
        >
          <span className="truncate">{label}</span>
          {/*
           * A colour of its own rather than the label's faded.
           *
           * Everything in this panel is 10–11px and `--color-count-muted`
           * clears 4.5:1 on the app surface by a thin enough margin that any
           * alpha under it fails — at 70% this summary measured 2.87:1.
           * `content-faint` is the next rung up and reads as a different voice
           * rather than a dimmer one.
           */}
          <span className={cx('shrink-0', selected.length > 0 ? 'text-accent' : 'text-content-faint')}>
            {summary}
          </span>
          {/*
           * Points at the content it reveals: right when shut, down when open.
           *
           * Beside the summary rather than pushed to the far edge. The row is
           * full-width so the whole thing is a target, but the chevron is part
           * of the phrase `source — all — ▸`; parked 500px away at the end of a
           * grid column it read as an unrelated mark that had drifted off.
           */}
          <span
            aria-hidden
            className="shrink-0 transition-transform duration-160"
            style={{ rotate: expanded ? '90deg' : '0deg' }}
          >
            <ChevronRight />
          </span>
          {/* Eats the rest of the row so the target stays full-width. */}
          <span aria-hidden className="min-w-0 flex-1" />
        </button>

        {selected.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label} filter`}
            className="yarg-label yarg-focusable tap-target shrink-0 cursor-pointer text-[10px] text-accent hover:text-white"
          >
            clear
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div
          className="flex flex-col gap-[10px] p-[10px]"
          style={{
            borderRadius: 'var(--radius-md)',
            // The same sunken well the search field sits in, so the picker reads
            // as an inset area of the sheet rather than a card floating on it —
            // this palette has no room for a second raised surface.
            background: 'var(--yarg-surface-sunken)',
            boxShadow: 'inset 0 0 0 var(--stroke-hairline) var(--color-border-row)',
          }}
        >
          {searchable ? (
            <TextField
              type="search"
              inputMode="search"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              dir="auto"
              placeholder={`Filter ${label}s…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              leading={<SearchIcon />}
              aria-label={`Filter the ${label} list`}
            />
          ) : null}

          {shown.length === 0 ? (
            <p className="px-[5px] py-[10px] text-[13px] text-content-muted">
              Nothing here matches “{query.trim()}”.
            </p>
          ) : (
            <div
              // A group rather than a listbox: these are independent toggles and
              // a listbox would promise arrow-key traversal this doesn't have.
              role="group"
              aria-label={`${label} options`}
              className="scrollbar-slim flex max-h-[220px] flex-col overflow-y-auto"
            >
              {shown.map((option) => (
                <OptionRow
                  key={option.value}
                  label={format(option.value)}
                  count={option.count}
                  iconUrl={iconFor?.(option.value) ?? null}
                  checked={selected.includes(option.value)}
                  onToggle={() => onToggle(option.value)}
                />
              ))}
            </div>
          )}

          {matches.length > shown.length ? (
            <p className="px-[5px] text-[12px] text-content-faint">
              Showing {shown.length} of {matches.length.toLocaleString()}. Narrow it with the box
              above.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function OptionRow({
  label,
  count,
  iconUrl,
  checked,
  onToggle,
}: {
  label: string
  count: number
  iconUrl: string | null
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={cx(
        'yarg-focusable flex w-full cursor-pointer items-center gap-[10px] px-[5px] py-[7px]',
        'text-left transition-colors duration-160',
        'pointer-coarse:min-h-[44px]',
        checked ? 'text-white' : 'text-content-muted hover:text-content',
        // Inward, so a focused row's ring is not painted over by its neighbour.
        'focus-visible:[outline-offset:-2px]',
      )}
      style={{ borderRadius: 'var(--radius-sm)' }}
    >
      <CheckBox checked={checked} />
      {iconUrl !== null ? (
        <img
          src={iconUrl}
          alt=""
          aria-hidden
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
          className="shrink-0 object-contain"
          style={{ width: 20, height: 20 }}
        />
      ) : null}
      <span dir="auto" className="min-w-0 flex-1 truncate text-[14px]">
        {label}
      </span>
      {/* Right-aligned and tabular, so the counts read as a column of numbers
          rather than as trailing text on each name. */}
      <span className="font-numeric shrink-0 text-[12px] tabular-nums text-count-muted">
        {count.toLocaleString()}
      </span>
    </button>
  )
}

/**
 * The mark, drawn rather than borrowed from a font.
 *
 * `aria-hidden`: the row's own `aria-pressed` is what carries this state, and a
 * second announcement of it would be the same fact said twice.
 */
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className="flex size-[16px] shrink-0 items-center justify-center transition-colors duration-160"
      style={{
        borderRadius: 'var(--radius-sm)',
        background: checked ? 'var(--accent-fill)' : 'transparent',
        boxShadow: `inset 0 0 0 var(--stroke-hairline) ${
          checked ? 'var(--accent-edge)' : 'var(--color-border-strong)'
        }`,
      }}
    >
      {checked ? (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path
            d="M1 4L3.6 6.5L9 1"
            // Night rather than white: the fill is the accent at 75%, which
            // white crosses at 2.9:1 and Night at 6.9:1. Same measurement the
            // accent button tone is drawn from.
            stroke="var(--color-accent-content)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  )
}


function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
