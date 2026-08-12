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
 *     position flips, via `order-last` and per-child `order-*`.
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
 *
 * ## Every dimension is a set
 *
 * The panel used to hold three single-select dropdowns and two numeric ones,
 * which could express "songs from Rock Band 3" and never "songs from any Rock
 * Band game" — and the second is the question. Nobody standing in a room asks
 * for one decade; they ask for the eighties and the nineties. Nobody asks for
 * one source; they ask for the stuff everybody knows.
 *
 * So every dimension is a multi-select, and the reading is the one everybody
 * already has from every shopping site they have ever used: **within a
 * dimension, any; across dimensions, all.** `filtering.ts` documents the single
 * exception, which is parts.
 *
 * Multi-select is only affordable because of the token row above the panel.
 * Eight decades and six sources is a reasonable thing to have set and an
 * unreasonable thing to reconstruct from a badge reading `4` — so the state
 * comes out of the sheet and sits in the bar, named and individually
 * removable, where it stays legible with the panel shut. See `filterTokens.ts`.
 *
 * ## Two kinds of dimension, two kinds of control
 *
 * Parts, difficulty, vocals, length, decade, age rating and recording are closed
 * sets of at most eight known values, and they are chips: everything visible at
 * once, one tap to add, one tap to remove, no scrolling and no search box for
 * eight things.
 *
 * Source and genre are open sets that run to 27 and 57 in a real library and
 * have no ceiling at all. Those are collapsed pickers with a search field and a
 * scrolling list of rows, because a chip cloud of 57 genres is not a control,
 * it is a wall. They stay collapsed until asked for so the sheet opens at a
 * height a phone can hold.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode, Ref } from 'react'

import type { InstrumentGroup, SongFacets } from '@shared/types'
import { INSTRUMENT_GROUPS } from '@shared/types'
import { Button, RandomIcon, SortArrow, TextField, ToggleChip, cx } from '../../ui'
import type { DifficultyLens } from '../../lib/difficulty'
import { LENS_LABELS, unratedLabel } from '../../lib/difficulty'
import {
  INTENSITY_TIERS,
  LENGTH_BUCKETS,
  formatVocalParts,
  intensityName,
} from '../../lib/format'
import { resolveSource, sourceName } from '../../lib/sources'
import type { RowField } from './columns'
import { ROW_FIELDS, rowFieldLabel } from './columns'
import { FacetPicker } from './FacetPicker'
import { LensPicker } from './LensPicker'
import type { DerivedFacets, Filters } from './filtering'
import type { SortDirection, SortKey } from './filtering'
import {
  EMPTY_FILTERS,
  UNKNOWN,
  hasActiveView,
  panelFilterCount,
  toggleValue,
} from './filtering'
import { describeFilters, withoutToken } from './filterTokens'

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
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'length', label: 'Length' },
]

/**
 * What the difficulty ordering is called right now.
 *
 * Under a lens the chip says the instrument rather than the word `Difficulty`,
 * which is both shorter and more true: beside `Artist`, `Title`, `Year` and
 * `Length`, a chip reading `Drums` can only mean one thing, and a chip reading
 * `Difficulty` would be the one label on the row that no longer says which
 * number it means. The accessible name below still spells it out in full.
 */
function sortLabelFor(key: SortKey, lens: DifficultyLens): string {
  const base = COMPACT_SORTS.find((sort) => sort.key === key)?.label ?? 'Sort'
  return key === 'difficulty' && lens !== 'band' ? LENS_LABELS[lens] : base
}

function spokenSortName(key: SortKey, lens: DifficultyLens): string {
  return key === 'difficulty' && lens !== 'band'
    ? `${LENS_LABELS[lens]} difficulty`
    : (COMPACT_SORTS.find((sort) => sort.key === key)?.label ?? 'Sort')
}

interface FiltersPanelProps {
  filters: Filters
  onChange: (filters: Filters) => void
  /** Facets the server tallied off the CSV's own columns. */
  facets: SongFacets
  /** The four this app tallies for itself — decade, vocals, length, age rating. */
  derived: DerivedFacets
  lens: DifficultyLens
  onLensChange: (lens: DifficultyLens) => void
  resultCount: number
  totalCount: number
  sortKey: SortKey
  sortDirection: SortDirection
  onSort: (key: SortKey) => void
  /**
   * What a phone row draws beside the title.
   *
   * Here rather than on the list, because this is the panel that exists at
   * exactly the widths the list has no column header to hang a picker off —
   * see the `row shows` section below.
   */
  fields: ReadonlySet<RowField>
  onFieldToggle: (field: RowField) => void
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
  derived,
  lens,
  onLensChange,
  resultCount,
  totalCount,
  sortKey,
  sortDirection,
  onSort,
  fields,
  onFieldToggle,
  onRandom,
  open,
  onOpenChange,
  searchRef,
}: FiltersPanelProps) {
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    onChange({ ...filters, [key]: value })
  }

  /** Add or remove one value from any of the string-valued dimensions. */
  const toggle = <K extends 'sources' | 'genres' | 'ratings'>(key: K, value: string) => {
    update(key, toggleValue(filters[key], value) as Filters[K])
  }

  const toggleNumber = (
    key: 'decades' | 'vocals' | 'lengths' | 'intensities',
    value: number,
  ) => {
    update(key, toggleValue(filters[key], value))
  }

  const togglePanel = (panel: Exclude<OpenPanel, 'none'>) => {
    onOpenChange(open === panel ? 'none' : panel)
  }

  /**
   * `clear` puts the view back to how it was found, lens included.
   *
   * A reset that left the list quoting drum tiers would be a control saying it
   * had cleared the view while one of the things it changed was still set. The
   * lens has its own token for taking off on its own.
   */
  const clearAll = () => {
    onChange(EMPTY_FILTERS)
    onLensChange('band')
  }

  const active = hasActiveView(filters, lens)
  const panelCount = panelFilterCount(filters)
  const tokens = useMemo(() => describeFilters(filters, lens), [filters, lens])

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
       *             [ tokens ······························· ]
       *
       *   phone     [ count ················ clear  sort  filters ]
       *             [ tokens ································· ]
       *             [ search ···························· random  ]
       *
       * Search gets the full width on a phone because typing is the common
       * case and sharing the row left it 144px wide — the placeholder cut off
       * mid-word at "Search title, artis".
       *
       * The tokens sit directly under the count on a phone, which is the pairing
       * that matters: the number and the reason it is that number, on adjacent
       * lines, both above the thumb.
       */}
      {/*
       * `role="search"` sits on the wrapper, not the input — on the input it
       * would replace the `searchbox` role rather than add a landmark.
       */}
      <div
        role="search"
        className={cx(
          'order-5 flex basis-full items-center gap-[10px] md:order-1 md:min-w-0 md:flex-1 md:basis-0',
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
          // An Arabic or Hebrew query otherwise keeps the magnifier and the
          // native clear affordance on the wrong sides of the field.
          dir="auto"
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
        onClick={() => togglePanel('sort')}
        aria-expanded={open === 'sort'}
        aria-controls="sort-panel"
        aria-haspopup="true"
        aria-label={`Sort, currently ${spokenSortName(sortKey, lens)} ${
          sortDirection === 'asc' ? 'ascending' : 'descending'
        }`}
      >
        sort
        <SortArrow direction={sortDirection} />
      </Button>

      <Button
        className="order-3 shrink-0 max-md:px-[14px] md:order-2 @5xl/list:ml-auto"
        tone={open === 'filters' ? 'accent' : 'neutral'}
        onClick={() => togglePanel('filters')}
        aria-expanded={open === 'filters'}
        aria-controls="filters-panel"
        aria-haspopup="true"
        aria-label={
          panelCount === 0
            ? 'Filters'
            : `Filters, ${panelCount} ${panelCount === 1 ? 'dimension' : 'dimensions'} set`
        }
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
      <div className="order-1 flex min-w-0 flex-1 items-center gap-[15px] md:order-3 md:flex-none md:basis-auto md:justify-end">
        {/*
         * The visible count is not the live region.
         *
         * It used to be, and `filterSongs` runs on every keystroke — so typing
         * "beatles" queued seven announcements, each one interrupting the last,
         * and none of them the answer. The announcement is debounced separately
         * below; this stays silent.
         *
         * `whitespace-nowrap` because `353 of 4,168 songs` is one phrase and
         * breaking it left `SONGS` orphaned on a line under `of` — and, once
         * the cluster was over its width, pushed `clear` out from under the
         * flex box and straight across the `sort` button beside it.
         */}
        <span className="font-numeric flex items-baseline gap-[5px] text-[15px] whitespace-nowrap">
          <span className="font-bold text-count">{resultCount.toLocaleString()}</span>
          {resultCount !== totalCount ? (
            <span className="text-count-muted">of {totalCount.toLocaleString()}</span>
          ) : null}
          {/* Pluralized off the number the word is actually about, which is the
              subject of the sentence — `0 of 4,168 SONG` read as a typo. */}
          <span className="text-count-muted uppercase">
            {(resultCount === totalCount ? resultCount : totalCount) === 1 ? 'song' : 'songs'}
          </span>
        </span>

        <ResultAnnouncer count={resultCount} total={totalCount} />
      </div>

      {/*
       * `clear` rides at the end of the tokens rather than beside the count.
       *
       * Two reasons, and the second is the load-bearing one. It belongs with
       * what it clears — a row of removable things ending in "or drop all of
       * them" is one idea, where the same control parked beside a number was
       * next to the one thing it does not undo. And a 390px phone cannot fit
       * `353 of 4,168 songs`, `clear`, `sort` and `filters` on one line: it
       * never could, and the overflow put `clear` on top of `sort`.
       */}
      {active ? (
        <TokenRow
          tokens={tokens}
          onRemove={(removal) => {
            if (removal.dimension === 'lens') onLensChange('band')
            else onChange(withoutToken(filters, removal))
          }}
          onClearAll={clearAll}
        />
      ) : null}

      <Disclosure id="sort-panel" open={open === 'sort'} className="@2xl/list:hidden">
        {/*
         * Two sections in the sheet the phone sorts from, and the second one is
         * not a sort.
         *
         * It is here because of where it is *not* possible: from 672px of list
         * up, the table has a header, and the header's corner cell holds a
         * picker over all nine columns. Below that there is no header to hang
         * anything off, and there is no nine-column question either — a 60px
         * row has room for one mark, so the whole of the same idea is which of
         * the two it is. Exactly one of the two controls exists at any width,
         * which is the same trade the sort chips above make against the table's
         * sortable headers.
         */}
        <FilterSection label="sort by">
          <div className="flex flex-wrap gap-[10px]">
            {COMPACT_SORTS.map(({ key }) => {
              const isActive = key === sortKey
              const spoken = spokenSortName(key, lens)

              return (
                <ToggleChip
                  key={key}
                  active={isActive}
                  onClick={() => onSort(key)}
                  label={
                    isActive
                      ? `${spoken}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}. Tap to reverse`
                      : `Sort by ${spoken}`
                  }
                >
                  {sortLabelFor(key, lens)}
                  {isActive ? <SortArrow direction={sortDirection} /> : null}
                </ToggleChip>
              )
            })}
          </div>
        </FilterSection>

        {/*
         * No `clear` on this section, unlike every other one in the panel.
         *
         * Everywhere else clearing a dimension is the widest possible answer
         * and worth one tap; here it would empty the row, and putting the
         * fields back is three taps on three chips that are all already on
         * screen. A control whose only job is to undo three visible taps is a
         * fourth control in a row of three.
         */}
        <FilterSection label="row shows">
          {/*
           * Three independent toggles, in a group rather than a radiogroup.
           *
           * They were a one-of-two mark, which is the shape a 60px row wants
           * and the wrong shape for a control: the time turned out to be worth
           * dropping too, and a row that can lose one of its three fields can
           * lose any of them. The default is still one picture — see
           * `columns.ts` — it is just a default now rather than a rule.
           *
           * `role="group"` and not `radiogroup` for the reason `FacetPicker`
           * refuses `listbox`: naming a radiogroup promises arrow-key traversal
           * between the chips, and those two keys walk the song selection
           * everywhere else in this app.
           */}
          <div
            role="group"
            aria-label="What each row shows beside the title"
            className="flex flex-wrap gap-[10px]"
          >
            {ROW_FIELDS.map((field) => {
              const name = rowFieldLabel(field, lens)

              return (
                <ToggleChip
                  key={field}
                  active={fields.has(field)}
                  onClick={() => onFieldToggle(field)}
                  label={
                    fields.has(field)
                      ? `Hide ${name} on every row`
                      : `Show ${name} on every row`
                  }
                >
                  {name}
                </ToggleChip>
              )
            })}
          </div>
        </FilterSection>
      </Disclosure>

      <Disclosure id="filters-panel" open={open === 'filters'}>
        {/*
         * Two sections, not one. They are different questions — what the band
         * brought, and what kind of recording — and running them together under
         * one label had the panel implying that `Originals only` is an
         * instrument.
         *
         * Both wear the same label-above-chips shape every other section here
         * wears. They were an inline `label — chips` row, which is more compact
         * and was the only place in the panel that put a label beside its
         * controls rather than over them; one surface with two label systems
         * reads as two surfaces that got merged.
         */}
        {/* Container-counted, like the grid below it. */}
        <div className="grid grid-cols-1 items-start gap-[20px] @2xl/list:grid-cols-2">
          <FilterSection
            label="has parts"
            /*
             * The one dimension that means "all of". Saying so costs six
             * characters and saves the wrong mental model.
             *
             * Set apart by case and not by opacity. Everything in this panel is
             * 10–11px, and `--color-count-muted` clears 4.5:1 on the app surface
             * by a margin thin enough that *any* alpha under it fails — at 70%
             * this read 2.87:1. Lowercase against the surrounding uppercase is
             * the whole distinction and it costs no contrast.
             */
            hint="(all of)"
            selected={filters.instruments.length}
            onClear={() => update('instruments', [])}
          >
            <ChipSet>
              {INSTRUMENT_GROUPS.map((group) => (
                <ToggleChip
                  key={group}
                  active={filters.instruments.includes(group)}
                  onClick={() => update('instruments', toggleValue(filters.instruments, group))}
                  label={`Only songs with a ${INSTRUMENT_LABELS[group]} part`}
                >
                  {INSTRUMENT_LABELS[group]}
                </ToggleChip>
              ))}
            </ChipSet>
          </FilterSection>

          <FilterSection label="recording">
            <ChipSet>
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
            </ChipSet>
          </FilterSection>
        </div>

        {/*
         * Difficulty gets its own full-width band, because it is two controls
         * and the first one changes what the second one means.
         */}
        <FilterSection
          label="difficulty"
          value={lens === 'band' ? undefined : LENS_LABELS[lens]}
          selected={filters.intensities.length}
          onClear={() => update('intensities', [])}
        >
          <LensPicker value={lens} onChange={onLensChange} />

          <div className="flex flex-wrap gap-[10px]">
            {INTENSITY_TIERS.map((tier) => (
              <ToggleChip
                key={tier}
                active={filters.intensities.includes(tier)}
                onClick={() => toggleNumber('intensities', tier)}
                label={`${intensityName(tier)} — ${
                  lens === 'band' ? 'band difficulty' : `${LENS_LABELS[lens].toLowerCase()} difficulty`
                } ${tier}`}
              >
                {intensityName(tier)}
                {/*
                 * The tier itself, beside the name. The rings on every row
                 * count to this number and the rail's glyphs *are* it, so the
                 * chip is where the two vocabularies are shown to be one.
                 *
                 * Secondary by weight and family, never by opacity: this is the
                 * app's own division — Red Hat Display extrabold shouts, Inter
                 * at normal weight is numbers — and it holds the label's full
                 * contrast, which an alpha at this size cannot.
                 */}
                <span className="font-numeric text-[11px] font-normal tabular-nums">{tier}</span>
              </ToggleChip>
            ))}
            <ToggleChip
              active={filters.intensities.includes(UNKNOWN)}
              onClick={() => toggleNumber('intensities', UNKNOWN)}
              label={
                lens === 'band'
                  ? 'Songs with no band difficulty rating'
                  : `Songs with no ${LENS_LABELS[lens].toLowerCase()} part`
              }
            >
              {unratedLabel(lens)}
            </ToggleChip>
          </div>
        </FilterSection>

        {/*
         * The four closed sets, side by side wherever there is room for them.
         * `items-start` so a section with two rows of chips doesn't stretch the
         * three beside it to match.
         *
         * **Counted off the panel, not the viewport.** This grid asked the
         * viewport for its column count, which is the mistake the sort chips at
         * the top of this file exist to warn about: from `lg` up the list shares
         * the window with the detail pane, so a 1280px viewport is a ~800px
         * panel, and `xl:grid-cols-4` put four columns of chips into a row that
         * could not hold them. The fourth column is worth having and it is the
         * *panel* that has to be wide enough for it.
         */}
        <div
          className={cx(
            'grid grid-cols-1 items-start gap-[20px]',
            // One, two, four. Never three: four sections in three columns is a
            // row of three and an orphan, which is both unbalanced and exactly
            // as tall as the two-column layout that tiles evenly — so the
            // three-column step costs a row of height and buys nothing.
            '@2xl/list:grid-cols-2 @5xl/list:grid-cols-4',
          )}
        >
          <FilterSection
            label="vocals"
            selected={filters.vocals.length}
            onClear={() => update('vocals', [])}
          >
            <ChipSet>
              {derived.vocals.map(({ value, count }) => {
                const parts = Number(value)
                return (
                  <ToggleChip
                    key={value}
                    active={filters.vocals.includes(parts)}
                    onClick={() => toggleNumber('vocals', parts)}
                    label={`${formatVocalParts(parts)}, ${count.toLocaleString()} songs`}
                  >
                    {formatVocalParts(parts)}
                  </ToggleChip>
                )
              })}
            </ChipSet>
          </FilterSection>

          <FilterSection
            label="length"
            selected={filters.lengths.length}
            onClear={() => update('lengths', [])}
          >
            <ChipSet>
              {derived.lengths.map(({ value, count }) => {
                const bucket = Number(value)
                const found = LENGTH_BUCKETS[bucket]

                return (
                  <ToggleChip
                    key={value}
                    active={filters.lengths.includes(bucket)}
                    onClick={() => toggleNumber('lengths', bucket)}
                    label={`${found?.label ?? 'Unknown length'}, ${count.toLocaleString()} songs`}
                  >
                    {found?.name ?? 'Unknown'}
                    {/* The boundary, so the chip teaches its own cut rather than
                        asking anyone to remember what `Long` means. Same weight
                        and family rule as the difficulty tiers above. */}
                    {found ? (
                      <span className="font-numeric text-[11px] font-normal tabular-nums">
                        {found.short}
                      </span>
                    ) : null}
                  </ToggleChip>
                )
              })}
            </ChipSet>
          </FilterSection>

          <FilterSection
            label="decade"
            selected={filters.decades.length}
            onClear={() => update('decades', [])}
          >
            <ChipSet>
              {derived.decades.map(({ value, count }) => {
                const decade = Number(value)
                const label = decade === UNKNOWN ? 'No year' : `${decade}s`

                return (
                  <ToggleChip
                    key={value}
                    active={filters.decades.includes(decade)}
                    onClick={() => toggleNumber('decades', decade)}
                    label={`${label}, ${count.toLocaleString()} songs`}
                  >
                    {/* Out of the display face's uppercase: `1980S` reads as a
                        typo, which is the same call `CategoryHeader` makes
                        about the decade headers it draws over the list. */}
                    <span className={decade === UNKNOWN ? undefined : 'normal-case'}>{label}</span>
                  </ToggleChip>
                )
              })}
            </ChipSet>
          </FilterSection>

          {/*
           * `age rating`, not `rating`, and the extra word is load-bearing: the
           * section directly above this grid is `difficulty`, whose chips are
           * tiers and whose last one is `Unrated`. A control labelled `rating`
           * sitting under that one would be read as the same question asked
           * again. `Age Rating` is also what YARG's own export calls the column.
           *
           * Drawn from the library rather than from `AGE_RATINGS`, so a library
           * whose charts are all unrated shows the one chip that means anything
           * instead of four dead ones — the same rule the three sections beside
           * it follow.
           */}
          <FilterSection
            label="age rating"
            selected={filters.ratings.length}
            onClear={() => update('ratings', [])}
          >
            <ChipSet>
              {derived.ratings.map(({ value, count }) => (
                <ToggleChip
                  key={value}
                  active={filters.ratings.includes(value)}
                  onClick={() => toggle('ratings', value)}
                  label={`${value}, ${count.toLocaleString()} songs`}
                >
                  {value}
                </ToggleChip>
              ))}
            </ChipSet>
          </FilterSection>
        </div>

        {/* The two open sets. Collapsed until asked for; see the file header. */}
        <div className="grid grid-cols-1 items-start gap-[20px] @2xl/list:grid-cols-2">
          <FacetPicker
            label="source"
            options={facets.sources}
            selected={filters.sources}
            onToggle={(value) => toggle('sources', value)}
            onClear={() => update('sources', [])}
            // The same registry as the badges, so the filter and the rows agree
            // on what to call a source — the dropdown this replaced listed the
            // raw ids, `rb3dlc (613)`.
            format={sourceName}
            iconFor={(value) => resolveSource(value).iconUrl}
          />
          <FacetPicker
            label="genre"
            options={facets.genres}
            selected={filters.genres}
            onToggle={(value) => toggle('genres', value)}
            onClear={() => update('genres', [])}
          />
        </div>
      </Disclosure>
    </div>
  )
}

// --- The token row ------------------------------------------------------------

/**
 * What is narrowing the list, with the panel shut.
 *
 * Horizontally scrollable below `md` rather than wrapping: on a phone this sits
 * between the count and the search field, and a row that grew to four lines
 * would push the field a person is mid-word in down the screen. On a desktop
 * there is width to wrap into and no thumb to displace.
 */
function TokenRow({
  tokens,
  onRemove,
  onClearAll,
}: {
  tokens: ReturnType<typeof describeFilters>
  onRemove: (removal: ReturnType<typeof describeFilters>[number]['removal']) => void
  onClearAll: () => void
}) {
  return (
    <div
      /*
       * A group rather than a list.
       *
       * `clear all` sits in this row and is an action on the set rather than a
       * member of it, so a `list` would either have to own it — a list owns
       * `listitem`s and nothing else — or wrap the tokens in a nested `ul` set
       * to `display: contents`, which several screen readers drop from the
       * accessibility tree outright. Every token already carries its whole
       * sentence in its own name, so the container only has to say what the
       * row is.
       */
      role="group"
      aria-label="Active filters"
      className="order-4 flex min-w-0 basis-full items-center gap-[12px] md:order-4"
    >
      {/*
       * The tokens scroll; `clear all` does not.
       *
       * It sat at the end of the row and went out the side of a 390px phone
       * behind two screens of tokens — which is the one control that must never
       * be reachable only by scrolling, because on a touch device it is the
       * *only* reset. There is no Escape key on a phone.
       */}
      <div
        className={cx(
          'flex min-w-0 flex-1 items-center gap-[8px]',
          'max-md:scrollbar-slim max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-[2px]',
          'md:flex-wrap',
        )}
      >
        {tokens.map((token) => (
          <span key={token.id} className="shrink-0">
            <Token token={token} onRemove={() => onRemove(token.removal)} />
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onClearAll}
        // 11px of text, so the hit area is grown to 44px behind it rather than
        // the label being inflated. Nothing sits close enough to clash.
        className={cx(
          'yarg-label yarg-focusable tap-target shrink-0 cursor-pointer',
          'text-[11px] text-accent hover:text-white',
        )}
      >
        clear all
      </button>
    </div>
  )
}

function Token({
  token,
  onRemove,
}: {
  token: ReturnType<typeof describeFilters>[number]
  onRemove: () => void
}) {
  const isLens = token.kind === 'lens'

  return (
    <button
      type="button"
      onClick={onRemove}
      /*
       * The whole token is the remove control, rather than a label with a small
       * × beside it. A 10px glyph is not a target on a phone, and there is
       * nothing else a token could do when tapped — it is already the readout.
       * The × is the affordance saying so, not a second button inside the first.
       */
      aria-label={`Remove ${token.dimension} filter: ${token.label}`}
      className={cx(
        'yarg-label yarg-focusable group inline-flex cursor-pointer items-center gap-[7px]',
        'py-[6px] pr-[9px] pl-[12px] text-[11px] transition-colors duration-160',
        'pointer-coarse:min-h-[36px]',
        isLens ? 'text-content-muted hover:text-content' : 'text-white',
      )}
      style={{
        borderRadius: 'var(--radius-pill)',
        /*
         * A lens is not a filter and does not wear a filter's colour. It draws
         * as an outline in the neutral stroke every inactive control uses, so
         * the row reads at a glance as "these six things are hiding songs, and
         * this one is changing what you are looking at".
         */
        background: isLens ? 'transparent' : 'var(--accent-tint)',
        boxShadow: `inset 0 0 0 var(--stroke) ${
          isLens ? 'var(--color-border-strong)' : 'var(--accent-edge)'
        }`,
      }}
    >
      {token.iconUrl !== undefined && token.iconUrl !== null ? (
        <img
          src={token.iconUrl}
          alt=""
          aria-hidden
          width={14}
          height={14}
          loading="lazy"
          decoding="async"
          className="shrink-0 object-contain"
          style={{ width: 14, height: 14 }}
        />
      ) : null}
      <span className={cx('max-w-[180px] truncate-tight', token.preserveCase && 'normal-case')}>
        {token.label}
      </span>
      <CloseIcon />
    </button>
  )
}

// --- Sections -----------------------------------------------------------------

/**
 * A labelled group of controls, with the count it currently constrains.
 *
 * The per-section `clear` is what the token row cannot do cheaply: taking six
 * genres off one at a time is six taps down a scrolling row, and "none of
 * these" is one gesture. It appears only when there is something to clear, so a
 * panel at rest carries no dead affordances.
 */
function FilterSection({
  label,
  hint,
  value,
  selected = 0,
  onClear,
  children,
}: {
  label: string
  /** A lowercase aside on the heading, for a rule the label can't carry alone. */
  hint?: string
  /** A chosen value the heading should read out — the lens, so far. */
  value?: string
  selected?: number
  onClear?: () => void
  children: ReactNode
}) {
  return (
    /*
     * `min-w-0` is a guard rather than a fix for anything currently broken.
     *
     * A grid track is `minmax(auto, 1fr)`, and that `auto` is this section's
     * min-content — so a chip carrying a single word too long to fit its share
     * of the row would widen the whole track and push the grid past the panel.
     * Every label in here today wraps at a space and stays well inside its
     * column; zeroing the floor means the day one doesn't, the chip wraps
     * instead of the panel growing a scrollbar.
     */
    <section className="flex min-w-0 flex-col gap-[10px]">
      <div className="flex min-w-0 items-center gap-[10px]">
        <FieldLabel className="min-w-0 truncate">
          {label}
          {hint !== undefined ? <span className="ml-[6px] normal-case">{hint}</span> : null}
          {value !== undefined ? (
            <>
              {/* The separator is `content-faint` rather than the label colour
                  faded — see the note on `(all of)` above for why nothing at
                  this size wears an alpha. */}
              <span className="mx-[7px] text-content-faint">/</span>
              <span className="text-accent">{value}</span>
            </>
          ) : null}
        </FieldLabel>

        {selected > 0 && onClear !== undefined ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label} filter`}
            className="yarg-label yarg-focusable tap-target ml-auto shrink-0 cursor-pointer text-[10px] text-accent hover:text-white"
          >
            clear
          </button>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function ChipSet({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-[8px]">{children}</div>
}

// --- Shared bits --------------------------------------------------------------

/**
 * A collapsible region that behaves differently at each width.
 *
 * On a desktop it's an ordinary block in the toolbar's flow. Below `md` it's
 * lifted out of flow and floated above the bar, so opening it costs the song
 * list nothing — the list keeps its full height and scroll position, and the
 * rows above the sheet stay live while you narrow.
 *
 * It scrolls at every width now, not only on a phone. The panel holds nine
 * dimensions rather than five, and on a desktop it is a flex sibling of the
 * list — left uncapped, a fully expanded panel would push the rows off the
 * bottom of a laptop screen, which is the same failure the phone overlay was
 * built to avoid.
 */
function Disclosure({
  id,
  open,
  className,
  children,
}: {
  id: string
  open: boolean
  className?: string
  children: ReactNode
}) {
  if (!open) return null

  return (
    <div
      id={id}
      className={cx(
        'scrollbar-slim flex flex-col gap-[20px]',
        'md:order-6 md:basis-full md:max-h-[52vh] md:overflow-y-auto',
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
        'max-md:border-t-2 max-md:border-t-[var(--accent-edge)]',
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

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** The remove mark on a token. Drawn at the same weight as every other glyph here. */
function CloseIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      fill="none"
      aria-hidden
      className="shrink-0 opacity-60 transition-opacity duration-160 group-hover:opacity-100"
    >
      <path
        d="M1 1L8 8M8 1L1 8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}
