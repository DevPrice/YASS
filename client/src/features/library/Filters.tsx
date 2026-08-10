/**
 * Search, sort and filter controls.
 *
 * One component, two placements. On a desktop this is a toolbar under the
 * header, which is where a mouse expects it. Below `md` the whole cluster moves
 * to the bottom of the screen with `order-last`, because the top 200px of a
 * phone held one-handed is the part a thumb can't reach — and this app is read
 * by guests standing up, on their own phones, mid-party.
 *
 * Two consequences of that move, both deliberate:
 *
 *   - **The DOM order doesn't change.** Controls still precede results, which
 *     is the sequence a screen reader and a keyboard want. Only the visual
 *     position flips, via `order-last` and `flex-col-reverse`.
 *   - **The expanded panel overlays the list rather than displacing it.** As a
 *     flex sibling it took 459px and squeezed the list to two visible rows; as
 *     an overlay the list keeps its full height and simply sits behind. You can
 *     still watch rows and the count respond while you narrow.
 *
 * Sorting is here too, but only while the table header isn't showing. That is a
 * *container* query, not a viewport one: the list shares the window with the
 * detail pane from `lg` up, so a 1024px desktop leaves it 696px — narrow enough
 * that the table header is gone. Asking the viewport would have hidden these
 * chips at exactly the width where they became the only sort control on screen,
 * which is how the app lost sorting on phones the first time.
 */

import { useEffect, useState } from 'react'
import type { ReactNode, Ref } from 'react'

import type { InstrumentGroup, SongFacets } from '@shared/types'
import { INSTRUMENT_GROUPS } from '@shared/types'
import { Button, RandomIcon, Select, SortArrow, TextField, ToggleChip, cx } from '../../ui'
import { sourceName } from '../../lib/sources'
import type { Filters } from './filtering'
import type { SortDirection, SortKey } from './filtering'
import { EMPTY_FILTERS, hasActiveFilters, panelFilterCount } from './filtering'

/** Cap facet dropdowns so a library with thousands of charters stays usable. */
const MAX_FACET_OPTIONS = 200

/** Which disclosure is open. Only one at a time — the phone has no room for two. */
export type OpenPanel = 'none' | 'filters' | 'sort'

const INSTRUMENT_LABELS: Record<InstrumentGroup, string> = {
  guitar: 'Guitar',
  bass: 'Bass',
  drums: 'Drums',
  keys: 'Keys',
  vocals: 'Vocals',
}

/**
 * The orderings a room actually asks for, and nothing else.
 *
 * The table sorts on eight columns because the columns are right there and cost
 * nothing. Reproducing all eight as chips would be porting a desktop metaphor
 * onto a device that never asked for it — these five answer "who's this by",
 * "what's it called", "is it old", "can we play it", and "how long till the next
 * one", which is the whole conversation. Album, genre, charter and source are
 * the four that never come up as an *ordering*; they come up as a filter, which
 * the panel below already does, and as a fact about one song, which the detail
 * view now shows.
 */
const COMPACT_SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'artist', label: 'Artist' },
  { key: 'name', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'bandDifficulty', label: 'Difficulty' },
  { key: 'length', label: 'Length' },
]

const SORT_LABELS: Partial<Record<SortKey, string>> = Object.fromEntries(
  COMPACT_SORTS.map(({ key, label }) => [key, label]),
)

interface FiltersPanelProps {
  filters: Filters
  onChange: (filters: Filters) => void
  facets: SongFacets
  resultCount: number
  totalCount: number
  sortKey: SortKey
  sortDirection: SortDirection
  onSort: (key: SortKey) => void
  /** Jump to a random song in the current results. */
  onRandom: () => void
  /** Owned by the app shell so Escape can close a panel before clearing filters. */
  open: OpenPanel
  onOpenChange: (panel: OpenPanel) => void
  /** Lets the `/` shortcut in the helper bar focus the search field. */
  searchRef?: Ref<HTMLInputElement>
}

export function FiltersPanel({
  filters,
  onChange,
  facets,
  resultCount,
  totalCount,
  sortKey,
  sortDirection,
  onSort,
  onRandom,
  open,
  onOpenChange,
  searchRef,
}: FiltersPanelProps) {
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    onChange({ ...filters, [key]: value })
  }

  const toggleInstrument = (group: InstrumentGroup) => {
    const active = filters.instruments.includes(group)
    update(
      'instruments',
      active ? filters.instruments.filter((g) => g !== group) : [...filters.instruments, group],
    )
  }

  /** Facet dropdowns are single-select for now; '' means "no filter". */
  const singleSelect = (key: 'sources' | 'genres' | 'formats', value: string) => {
    update(key, value === '' ? [] : [value])
  }

  const toggle = (panel: Exclude<OpenPanel, 'none'>) => {
    onOpenChange(open === panel ? 'none' : panel)
  }

  const active = hasActiveFilters(filters)
  const panelCount = panelFilterCount(filters)
  const sortLabel = SORT_LABELS[sortKey] ?? 'Sort'

  return (
    <div
      className={cx(
        'flex shrink-0 flex-wrap items-center gap-x-[10px] gap-y-[15px]',
        'bg-surface-app px-[25px] py-[15px]',
        // Below md: the bottom bar. `relative` anchors the overlay panels and
        // `order-last` moves it under the list without touching DOM order.
        'max-md:relative max-md:z-20 max-md:order-last max-md:px-[15px]',
        'max-md:shadow-[var(--shadow-bar)]',
        // Home-indicator clearance, never less than the normal padding.
        'max-md:pb-[max(15px,env(safe-area-inset-bottom))]',
      )}
    >
      {/*
       * One wrapping row, reordered per breakpoint rather than duplicated.
       *
       *   desktop   [ search ····· random  filters  count clear ]
       *
       *   phone     [ count ················ clear  sort  filters ]
       *             [ search ···························· random  ]
       *
       * Search gets the full width on a phone because typing is the common
       * case and sharing the row left it 144px wide — the placeholder cut off
       * mid-word at "Search title, artis".
       */}
      {/*
       * `role="search"` sits on the wrapper, not the input — on the input it
       * would replace the `searchbox` role rather than add a landmark.
       */}
      <div
        role="search"
        className={cx(
          'order-4 flex basis-full items-center gap-[10px] md:order-1 md:min-w-0 md:flex-1 md:basis-0',
          // Past 1024px of list, the field stops growing and the controls go to
          // the far edge instead. A search input is a target, not a canvas —
          // stretched to 1,100px on a wide monitor it was the single clearest
          // tell that this layout had been designed for a phone and then pulled
          // apart.
          '@5xl/list:max-w-[620px]',
        )}
      >
        <TextField
          className="min-w-0 flex-1"
          inputRef={searchRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          // Song and band names are not English prose. Left on, iOS retitles
          // half the library as you type.
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search title, artist, charter…"
          value={filters.search}
          onChange={(event) => update('search', event.target.value)}
          leading={<SearchIcon />}
          aria-label="Search songs"
        />

        {/*
         * Rides with search rather than the sort/filter pair, because it is not
         * a way of narrowing the list — it's the answer to "just pick one",
         * which is the most common thing anyone actually says in the room.
         *
         * Icon-only: at 390px the labelled version left the search field too
         * narrow to show its own placeholder, and the shuffle glyph is the one
         * control here that reads without a word attached.
         */}
        <Button
          className="shrink-0 px-[14px] @4xl/list:px-[20px]"
          icon={<RandomIcon />}
          onClick={onRandom}
          disabled={resultCount === 0}
          title="Pick a random song"
          aria-label="Pick a random song from the current results"
        >
          {/* The label is bought back the moment the list can spare 900px. */}
          <span className="hidden @4xl/list:inline">random</span>
        </Button>
      </div>

      {/* Sorting is the table header's job wherever the table exists. */}
      <Button
        className="order-2 shrink-0 max-md:px-[14px] md:order-2 @2xl/list:hidden"
        tone={open === 'sort' ? 'accent' : 'neutral'}
        onClick={() => toggle('sort')}
        aria-expanded={open === 'sort'}
        aria-label={`Sort, currently ${sortLabel} ${
          sortDirection === 'asc' ? 'ascending' : 'descending'
        }`}
      >
        sort
        <SortArrow direction={sortDirection} />
      </Button>

      <Button
        className="order-3 shrink-0 max-md:px-[14px] md:order-2 @5xl/list:ml-auto"
        tone={open === 'filters' ? 'accent' : 'neutral'}
        onClick={() => toggle('filters')}
        aria-expanded={open === 'filters'}
      >
        filters
        {panelCount > 0 ? (
          <span className="font-numeric text-[12px] tabular-nums">{panelCount}</span>
        ) : null}
      </Button>

      {/*
       * Numbers are shown, not described: bright count, dim unit.
       *
       * On a phone this owns the top line of the bar and pushes `clear` to the
       * far edge. On a desktop it joins the toolbar's one row instead of taking
       * a second — the count sat alone on a line of its own, which cost 77px of
       * height on every screen, which is a whole song row.
       */}
      <div className="order-1 flex min-w-0 flex-1 items-center justify-between gap-[15px] md:order-3 md:flex-none md:basis-auto md:justify-end">
        {/*
         * The visible count is not the live region.
         *
         * It used to be, and `filterSongs` runs on every keystroke — so typing
         * "beatles" queued seven announcements, each one interrupting the last,
         * and none of them the answer. The announcement is debounced separately
         * below; this stays silent.
         */}
        <span className="font-numeric flex items-baseline gap-[5px] text-[15px]">
          <span className="font-bold text-count">{resultCount.toLocaleString()}</span>
          {resultCount !== totalCount ? (
            <span className="text-count-muted">of {totalCount.toLocaleString()}</span>
          ) : null}
          <span className="text-count-muted uppercase">
            {resultCount === 1 ? 'song' : 'songs'}
          </span>
        </span>

        <ResultAnnouncer count={resultCount} total={totalCount} />

        {active ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            // 11px of text, so the hit area is grown to 44px behind it rather
            // than the label being inflated. Nothing sits close enough to clash.
            className="yarg-label yarg-focusable tap-target shrink-0 cursor-pointer text-[11px] text-accent hover:text-white"
          >
            clear
          </button>
        ) : null}
      </div>

      <Disclosure open={open === 'sort'} className="@2xl/list:hidden">
        <FieldLabel>sort by</FieldLabel>
        <div className="flex flex-wrap gap-[10px]">
          {COMPACT_SORTS.map(({ key, label }) => {
            const isActive = key === sortKey

            return (
              <ToggleChip
                key={key}
                active={isActive}
                onClick={() => onSort(key)}
                label={
                  isActive
                    ? `${label}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}. Tap to reverse`
                    : `Sort by ${label}`
                }
              >
                {label}
                {isActive ? <SortArrow direction={sortDirection} /> : null}
              </ToggleChip>
            )
          })}
        </div>
      </Disclosure>

      <Disclosure open={open === 'filters'}>
        <div className="flex flex-wrap gap-[10px]">
          <FieldLabel className="self-center">has parts</FieldLabel>
          {INSTRUMENT_GROUPS.map((group) => (
            <ToggleChip
              key={group}
              active={filters.instruments.includes(group)}
              onClick={() => toggleInstrument(group)}
              label={`Only songs with a ${INSTRUMENT_LABELS[group]} part`}
            >
              {INSTRUMENT_LABELS[group]}
            </ToggleChip>
          ))}
          <ToggleChip
            active={filters.masterOnly}
            onClick={() => update('masterOnly', !filters.masterOnly)}
            // `Master only` was the game's word for it, and the chip was the
            // last place the app still spoke it. This is the same filter said
            // as the rows say it: it hides everything marked `as made famous
            // by` somebody else.
            title="Original recordings only, no covers"
            label="Original recordings only, hiding covers"
          >
            Originals only
          </ToggleChip>
        </div>

        <div className="grid grid-cols-1 gap-[15px] sm:grid-cols-2 lg:grid-cols-4">
          <FacetSelect
            label="source"
            value={filters.sources[0] ?? ''}
            options={facets.sources}
            // The dropdown listed raw ids too — `rb3dlc (613)`. Same registry
            // as the badges, so the filter and the rows agree on what to call
            // a source.
            format={sourceName}
            onChange={(value) => singleSelect('sources', value)}
          />
          <FacetSelect
            label="genre"
            value={filters.genres[0] ?? ''}
            options={facets.genres}
            onChange={(value) => singleSelect('genres', value)}
          />
          <FacetSelect
            label="format"
            value={filters.formats[0] ?? ''}
            options={facets.formats}
            onChange={(value) => singleSelect('formats', value)}
          />

          <div className="flex gap-[10px]">
            <Select
              label="min diff"
              value={filters.minDifficulty ?? ''}
              onChange={(event) =>
                update('minDifficulty', event.target.value === '' ? null : Number(event.target.value))
              }
            >
              <option value="">Any</option>
              {[0, 1, 2, 3, 4, 5, 6].map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </Select>
            <Select
              label="max diff"
              value={filters.maxDifficulty ?? ''}
              onChange={(event) =>
                update('maxDifficulty', event.target.value === '' ? null : Number(event.target.value))
              }
            >
              <option value="">Any</option>
              {[0, 1, 2, 3, 4, 5, 6].map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Disclosure>
    </div>
  )
}

/**
 * A collapsible region that behaves differently at each width.
 *
 * On a desktop it's an ordinary block in the toolbar's flow. Below `md` it's
 * lifted out of flow and floated above the bar, so opening it costs the song
 * list nothing — the list keeps its full height and scroll position, and the
 * rows above the sheet stay live while you narrow.
 */
function Disclosure({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children: ReactNode
}) {
  if (!open) return null

  return (
    <div
      className={cx(
        'scrollbar-slim flex flex-col gap-[15px]',
        'md:order-5 md:basis-full',
        'max-md:absolute max-md:inset-x-0 max-md:bottom-full max-md:z-20',
        'max-md:max-h-[55vh] max-md:overflow-y-auto',
        // Sunken is the darkest surface in the palette, so the sheet reads as
        // sitting in front of the rows rather than among them.
        'max-md:bg-surface-sunken max-md:p-[15px]',
        'max-md:shadow-[var(--shadow-bar)]',
        // The sheet floats over the list, and every surface in this palette is
        // within 1.15:1 of every other — a card stroke would leave no visible
        // edge at all. The lit top rule is the same accent-at-half the text
        // field uses when focused, so an open sheet reads as active, matching
        // the accent state of the button that opened it.
        'max-md:border-t-2 max-md:border-t-[rgba(69,216,254,0.5)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Long enough that a normal typing burst produces one announcement, not seven. */
const ANNOUNCE_DELAY_MS = 700

/**
 * Speaks the result count, once the user stops typing.
 *
 * Separate from the visible count so the two can move at different speeds: the
 * number on screen should update on every keystroke, and the spoken one very
 * much should not.
 */
function ResultAnnouncer({ count, total }: { count: number; total: number }) {
  const [message, setMessage] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMessage(
        count === total
          ? `${count.toLocaleString()} songs`
          : `${count.toLocaleString()} of ${total.toLocaleString()} songs`,
      )
    }, ANNOUNCE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [count, total])

  return (
    <span aria-live="polite" aria-atomic className="sr-only">
      {message}
    </span>
  )
}

function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('yarg-label text-[11px] text-count-muted', className)}>{children}</span>
  )
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
  format = (raw: string) => raw,
}: {
  label: string
  value: string
  options: Array<{ value: string; count: number }>
  onChange: (value: string) => void
  format?: (raw: string) => string
}) {
  return (
    <Select label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">All</option>
      {options.slice(0, MAX_FACET_OPTIONS).map((option) => (
        <option key={option.value} value={option.value}>
          {format(option.value)} ({option.count})
        </option>
      ))}
    </Select>
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
