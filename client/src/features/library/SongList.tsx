/**
 * The song list.
 *
 * Row anatomy follows the design system's `LibraryRow`: an 80px row, Barlow
 * title in the chart's own casing, italic cyan artist, and a rounded capsule for
 * the difficulty. The playing row swaps to the cyan fill washed out to card
 * colour and grows a hard white border — the design's signature treatment.
 *
 * Virtualized because the library runs to thousands of rows.
 *
 * **Every layout decision here is a container query, not a media query.** The
 * list no longer owns the window: from `lg` up it shares it with the detail
 * pane, so the same 1280px desktop gives it 870px of width, and the same 1600px
 * one gives it 1140px. Asking the viewport how wide the list is would answer a
 * question nobody asked — it would reveal the album column at a viewport width
 * where the column has nowhere to go. Widths named below (`@2xl` = 672px,
 * `@5xl` = 1024px, and so on) are the *list's* widths, and the container is
 * declared in `App`.
 *
 * Semantically a `list`, not a `grid`, even though the wide layout is a table.
 * The narrow layout is a different shape entirely — title over a metadata line,
 * with columns dropped — and ARIA has no way to change role at a breakpoint. A
 * list of songs is true at every width; a grid would be a lie in the narrow one.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { Song } from '@shared/types'
import { EmptyState, SortArrow, cx } from '../../ui'
import { ArtistName, BandDifficulty, InstrumentStrip, SourceBadge } from '../../ui/library'
import { formatDuration, formatYear } from '../../lib/format'
import { groupSongs } from './grouping'
import type { SortDirection, SortKey } from './filtering'

/**
 * Row height, chosen by how much room the list actually has.
 *
 * 80px is the design system's list-item height and it is right for the wide
 * layout — nine columns, a 22px title, and a window that can afford it. The
 * narrow layout is a different row: a 17px title over a 14px artist, 35px of
 * text and a 24px icon. Inheriting 80px there spent 45px a row on padding,
 * which across a 615px phone list is the difference between six songs on
 * screen and ten, on the device the whole product is for.
 *
 * 60px is still a 60px touch target, well clear of the 44px comfort floor.
 */
const ROW_HEIGHT_WIDE = 80
const ROW_HEIGHT_NARROW = 60

/** Enough to read as a division of the list without competing with a row. */
const HEADER_HEIGHT_WIDE = 40
const HEADER_HEIGHT_NARROW = 35

/**
 * The list width the narrow row gives way at — Tailwind's `@2xl`, the same
 * 672px every `@2xl/list:` class in this file switches on.
 *
 * Duplicated as a number because the virtualizer has to know a row's height
 * before anything is laid out, and a container query has no answer to give
 * JavaScript. Measured off the scroll container, which is exactly as wide as
 * the `@container/list` column declared in `App` — so the two agree to the
 * pixel, scrollbar included.
 */
const WIDE_AT = 672

/**
 * The selected song, and how the list should bring it into view.
 *
 * The two are one value because they always change together and the alignment
 * is a property of *how* the selection was made, not of the song: a tap on a
 * row you can already see should not move the page under your finger, and the
 * Random button's pick has to be centred so the songs either side of it are
 * visible — the pick is a suggestion, and the neighbours are the argument
 * against it.
 *
 * Always replaced rather than mutated, so re-picking the same song still
 * re-reveals it.
 */
export interface Selection {
  id: string
  align: 'auto' | 'center'
}

/**
 * The wide layout's columns, revealed by how much room the list actually has.
 *
 * Hidden columns reveal as `flex`, not `block`: these classes land on a button
 * that is itself `flex`, and a container-scoped `@6xl/list:block` outranks a
 * bare `flex`, which silently dropped `items-center` off the album and genre
 * headers.
 *
 * Source drops out below `@5xl` rather than shrinking to a bare icon, because
 * the width where it drops is a width where the detail pane exists — and the
 * pane names the source in full. The narrow layout keeps its source icon, since
 * that is a phone, where there is no pane to fall back to.
 */
const COLUMNS: Array<{
  /** Null for a column there is nothing sensible to order by. */
  key: SortKey | null
  label: string
  className: string
}> = [
  { key: 'name', label: 'title', className: 'flex-[3] min-w-0' },
  { key: 'artist', label: 'artist', className: 'flex-[2] min-w-0' },
  { key: 'album', label: 'album', className: 'flex-[2] min-w-0 hidden @6xl/list:flex' },
  { key: 'genre', label: 'genre', className: 'w-32 shrink-0 hidden @7xl/list:flex' },
  { key: 'year', label: 'year', className: 'w-16 shrink-0 text-right' },
  { key: 'length', label: 'time', className: 'w-16 shrink-0 text-right' },
  // Five fixed slots, so the column reads as a matrix down the page rather
  // than a ragged list. Sorting by it would mean inventing an order over a set.
  { key: null, label: 'parts', className: 'w-28 shrink-0 hidden @4xl/list:flex' },
  { key: 'bandDifficulty', label: 'diff', className: 'w-20 shrink-0 text-right' },
  { key: 'source', label: 'source', className: 'w-40 shrink-0 hidden @5xl/list:flex' },
]

interface SongListProps {
  songs: readonly Song[]
  sortKey: SortKey
  sortDirection: SortDirection
  onSort: (key: SortKey) => void
  playingId: string | null
  selection: Selection | null
  onSelect: (song: Song) => void
  /** Identifies the query. Changing it returns the list to the top. */
  queryKey: string
  /** True while a re-order is in flight. See the scroll container below. */
  isSorting: boolean
}

export function SongList({
  songs,
  sortKey,
  sortDirection,
  onSort,
  playingId,
  selection,
  onSelect,
  queryKey,
  isSorting,
}: SongListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  /**
   * Width of the list's scrollbar, reserved on the header so the two agree.
   *
   * The header is a sibling *above* the scroll container, not inside it — it has
   * to be, because the virtualizer positions rows from the scroll element's own
   * origin, and a header sharing that box would offset every row by its height.
   * The cost of staying outside is that the scrollbar narrows the rows and not
   * the header, so at four thousand songs every column sat ~10px left of the
   * label naming it.
   *
   * Measured rather than assumed: `scrollbar-slim` asks for `thin`, and what
   * that resolves to is the platform's business — 10px in Chromium via the
   * `::-webkit-scrollbar` rule, something else in Firefox, nothing at all where
   * scrollbars overlay. Zero when the list doesn't overflow, which is correct:
   * there is no scrollbar to leave room for.
   *
   * Taken off the two boxes' rects rather than `offsetWidth - clientWidth`,
   * because both of those are rounded to whole pixels. At anything but 100%
   * zoom the real gutter has a fraction — 10.4px at 80% — and rounding it away
   * put the whole row back out by that fraction, which is the same bug again
   * one order of magnitude down.
   */
  const contentRef = useRef<HTMLDivElement>(null)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)

  /**
   * Which row the list is rendering, as a number the virtualizer can use.
   *
   * Taken in the same pass as the scrollbar, off the scroll container rather
   * than the content box — the container query the rows themselves switch on
   * measures the column, and the content box is that minus the scrollbar. Read
   * in a layout effect, so the first paint is already at the right height
   * rather than laying a phone out in 80px rows and correcting after.
   */
  const [isNarrow, setIsNarrow] = useState(false)

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const content = contentRef.current
    if (scroller === null || content === null) return

    const measure = () => {
      const outer = scroller.getBoundingClientRect().width
      setScrollbarWidth(outer - content.getBoundingClientRect().width)
      setIsNarrow(outer < WIDE_AT)
    }
    measure()

    // The content box is exactly what a scrollbar appearing narrows, so
    // filtering a long list down to three rows re-measures too.
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  /**
   * The songs with their category headers spliced in — what actually renders.
   *
   * Width is an input because one key's headers depend on it: the wide row
   * gives the artist its own column and a header dividing the table, the narrow
   * row has the artist stacked under every title already. See `grouping.ts`.
   */
  const items = useMemo(
    () => groupSongs(songs, sortKey, isNarrow ? 'narrow' : 'wide'),
    [songs, sortKey, isNarrow],
  )

  /**
   * Both memoized on `items`, and `getItemKey` is doing more than it looks.
   *
   * The virtualizer recomputes its measurements when one of a fixed set of
   * options changes identity, and `estimateSize` is not in that set — so a
   * grouping that changed without changing the item *count* would keep the old
   * heights and lay headers out as 80px rows. `getItemKey` is in the set, so
   * memoizing it on `items` makes it the signal: it changes exactly when the
   * grouping does, and the fresh `estimateSize` gets read on the same pass.
   */
  const getItemKey = useCallback((index: number) => items[index]?.key ?? index, [items])

  const rowHeight = isNarrow ? ROW_HEIGHT_NARROW : ROW_HEIGHT_WIDE
  const headerHeight = isNarrow ? HEADER_HEIGHT_NARROW : HEADER_HEIGHT_WIDE

  const estimateSize = useCallback(
    (index: number) => (items[index]?.kind === 'header' ? headerHeight : rowHeight),
    [items, headerHeight, rowHeight],
  )

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: 10,
  })

  /**
   * Crossing the breakpoint is a height change, and the virtualizer won't see
   * it on its own.
   *
   * `estimateSize` is not one of the options whose identity triggers a
   * re-measure — the same reason `getItemKey` is memoized on `items` above — so
   * a rotation or a resize past 672px would keep every row at the height it was
   * first laid out at and leave the spacer describing a list that no longer
   * exists. Saying so explicitly is cheaper than routing a second signal
   * through `getItemKey`, and it says what it means.
   */
  useEffect(() => {
    virtualizer.measure()
  }, [isNarrow, virtualizer])

  // Return to the top when the *query* changes, so narrowing a filter doesn't
  // leave the user scrolled into empty space.
  //
  // Keyed on the query rather than the songs array: `sortSongs` returns a new
  // array every render pass, and the library now reloads on its own whenever
  // the CSV is re-exported. Watching the array would jump a reader back to the
  // top for something they didn't do.
  useEffect(() => {
    virtualizer.scrollToOffset(0)
  }, [queryKey, virtualizer])

  /**
   * The list is read inside the reveal effect, never watched by it.
   *
   * Depending on `songs` would make a filter change reveal the selection —
   * immediately undoing the scroll-to-top above, which runs from the same
   * commit. The selection changing is the only thing that should move the list.
   */
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (selection === null) return

    // The index is into the rendered items, headers included — the same units
    // the virtualizer measures in.
    const index = itemsRef.current.findIndex(
      (item) => item.kind === 'song' && item.song.id === selection.id,
    )
    if (index >= 0) virtualizer.scrollToIndex(index, { align: selection.align })
  }, [selection, virtualizer])

  if (songs.length === 0) {
    return (
      <EmptyState title="No songs match">
        Try clearing a filter or searching for something shorter.
      </EmptyState>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SortHeader
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={onSort}
        scrollbarWidth={scrollbarWidth}
      />

      <div
        ref={scrollRef}
        // Focusable so the list can be scrolled from the keyboard. Chrome makes
        // scroll containers focusable on its own; Firefox and Safari do not, and
        // without this a keyboard user reaches the end of the initial virtual
        // window and stops.
        tabIndex={0}
        role="list"
        aria-label={`Song library, ${songs.length.toLocaleString()} songs`}
        className={cx(
          'scrollbar-slim yarg-focusable min-h-0 flex-1 overflow-y-auto',
          'transition-opacity duration-100',
          /*
           * Says a re-order is happening, without flashing on the sorts that
           * don't need saying.
           *
           * Re-sorting five thousand songs is 110-176ms of blocked main thread
           * on a throttled phone, and a tap that shows nothing for that long
           * reads as a tap that missed. The delay lives on the pending class
           * alone, so a sort that lands inside 150ms — every sort on a desktop —
           * never starts the fade, while removing the class returns to full
           * opacity immediately rather than waiting the delay out again.
           */
          isSorting && 'opacity-60 delay-150',
        )}
      >
        <div
          ref={contentRef}
          className="relative w-full"
          // Transparent to assistive tech: the spacer only exists to give the
          // scrollbar the full height, and it must not sit between the list and
          // its items.
          role="presentation"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index]
            if (item === undefined) return null

            const placement = {
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }

            if (item.kind === 'header') {
              return (
                <div
                  key={item.key}
                  /*
                   * Presentational on purpose, twice over: a `list` owns
                   * `listitem`s and nothing else, and every value these group
                   * by is already on the row or in its detail — the artist, the
                   * year, the letter the title starts with. Announcing each
                   * header would put a second copy of that in the way of
                   * someone moving through four thousand songs one at a time.
                   */
                  role="presentation"
                  aria-hidden
                  className="absolute top-0 left-0 w-full"
                  style={placement}
                >
                  <CategoryHeader label={item.label} />
                </div>
              )
            }

            return (
              <div
                key={item.key}
                role="listitem"
                // Only ~17 rows exist in the DOM at a time, so without these a
                // screen reader reports a list of seventeen out of 4,168.
                // Counted in songs, so the headers don't inflate the total or
                // put gaps in the numbering.
                aria-setsize={songs.length}
                aria-posinset={item.position + 1}
                className="absolute top-0 left-0 w-full"
                style={placement}
              >
                <SongRow
                  song={item.song}
                  isPlaying={item.song.id === playingId}
                  isSelected={item.song.id === selection?.id}
                  onSelect={onSelect}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * A division of the list — an artist, a decade, a letter.
 *
 * Wears the same wash as the sort header above it, because they are the same
 * kind of thing: a band that names what is under it rather than a row you can
 * act on. It is shorter and quieter than that one, which is the difference
 * between naming the whole table and naming the next twelve songs.
 *
 * Set in the value's own casing rather than uppercased like the rest of the
 * display type. `MOTÖRHEAD` would be very much this design system, but the
 * same rule renders the decades as `1980S`, and a header that looks like a
 * typo costs more than the extra shout is worth.
 */
function CategoryHeader({ label }: { label: string }) {
  return (
    <div
      dir="auto"
      className={cx(
        'yarg-wash-header flex h-full items-center truncate px-[25px]',
        // Cyan rather than the sort header's pale blue, and 15px rather than
        // its 13. The band behind the two is the same, so the label is the
        // only thing distinguishing "this names the columns" from "this names
        // the next twelve songs" — at the sort header's weight it read as a
        // stray character sitting in an empty strip.
        'font-heading text-[15px] font-extrabold text-title',
      )}
      // The row's 2px side borders again, so a header's text starts on the
      // same pixel as the title of the song beneath it. See `SortHeader`.
      style={{
        borderLeft: '2px solid transparent',
        borderRight: '2px solid transparent',
        borderBottom: '1px solid var(--color-border-row)',
      }}
    >
      {label}
    </div>
  )
}

/**
 * The column labels.
 *
 * Everything about this element's horizontal box has to match `SongRow`'s, or
 * the labels stop naming the thing underneath them. Two of those measurements
 * are not in the class list and are easy to lose:
 *
 *   The 2px side borders are the row's, not the header's — `SongRow` reserves
 *   them for the white border the playing row wears, so its columns live in a
 *   box 4px narrower than this one and 2px to the right. Repeating them
 *   transparent here costs nothing and lines the two boxes up.
 *
 *   The scrollbar takes its width out of the rows and not out of this, since
 *   the scroll container is below. `scrollbarWidth` is what it actually took.
 */
function SortHeader({
  sortKey,
  sortDirection,
  onSort,
  scrollbarWidth,
}: Pick<SongListProps, 'sortKey' | 'sortDirection' | 'onSort'> & { scrollbarWidth: number }) {
  return (
    <div
      className="yarg-wash-header hidden items-center gap-[15px] px-[25px] py-[10px] @2xl/list:flex"
      style={{
        borderBottom: '1px solid var(--color-border-strong)',
        borderLeft: '2px solid transparent',
        borderRight: '2px solid transparent',
        // Overrides the right half of `px-[25px]`; the left half stands.
        paddingRight: `calc(25px + ${scrollbarWidth}px)`,
      }}
    >
      {COLUMNS.map((column) => {
        const active = column.key === sortKey
        const alignEnd = column.className.includes('text-right')

        // Not every column is an ordering. `parts` is a set per row, and
        // sorting by a set means inventing a comparison the data doesn't have.
        if (column.key === null) {
          return (
            <span
              key={column.label}
              className={cx(
                column.className,
                'yarg-label items-center text-[13px] text-content-header opacity-70',
                alignEnd && 'justify-end',
              )}
            >
              {column.label}
            </span>
          )
        }

        const key = column.key

        return (
          <button
            key={key}
            type="button"
            onClick={() => onSort(key)}
            // `aria-sort` belongs on a `columnheader` inside a grid; on a bare
            // button it is inert, so the state goes in the name instead.
            aria-label={
              active
                ? `Sort by ${column.label}, currently ${
                    sortDirection === 'asc' ? 'ascending' : 'descending'
                  }. Activate to reverse`
                : `Sort by ${column.label}`
            }
            className={cx(
              column.className,
              'yarg-label flex cursor-pointer items-center gap-[5px] text-[13px] transition-colors duration-160',
              active ? 'text-white' : 'text-content-header opacity-70 hover:opacity-100',
              alignEnd && 'justify-end',
              // 13px of text is a quarter of a touch target. Columns sit
              // shoulder to shoulder, so the height is bought with padding
              // rather than an overlay box that would collide with its
              // neighbours — and only where the pointer is actually coarse.
              'yarg-focusable pointer-coarse:py-[16px]',
            )}
          >
            <span className="truncate">{column.label}</span>
            {active ? <SortArrow direction={sortDirection} /> : null}
          </button>
        )
      })}
    </div>
  )
}

function SongRow({
  song,
  isPlaying,
  isSelected,
  onSelect,
}: {
  song: Song
  isPlaying: boolean
  isSelected: boolean
  onSelect: (song: Song) => void
}) {
  /**
   * Two marks, and they say different things.
   *
   * *Playing* is the game's fact and the system's signature treatment — the
   * wash plus a hard white border. *Selected* is the reader's own pointer, and
   * it borrows the accent as a 2px inset ring over the lifted surface, so it
   * reads as "this is the one I'm looking at" rather than as a second claim
   * about what YARG is doing. A row that is both wears the ring inside the
   * border, which is exactly what it means.
   *
   * There used to be a third mark, for the Random button's pick. It has been
   * folded into selection: landing on a song and then telling you nothing about
   * it was always the weaker half of "just pick one".
   */
  const playingBorder = isPlaying ? '#fff' : null

  return (
    <button
      type="button"
      onClick={() => onSelect(song)}
      /*
       * Not a tab stop. The list is one.
       *
       * Every row being tabbable made Tab a tunnel with 4,168 stops and no
       * forward exit — reaching whatever follows the library meant holding the
       * key down through the entire song list, and the only way out was
       * backwards. The roving pattern instead: Tab reaches the scroll container
       * once, arrows walk the selection from there, and Tab from a row skips
       * the other 4,167 because `-1` takes them out of the sequence without
       * taking them away from a pointer, a screen reader, or `focus()`.
       */
      tabIndex={-1}
      // "The current item within a set" is exactly what a master-detail
      // selection is, and unlike `aria-selected` it needs no listbox around it —
      // which this cannot be, since a virtualized listbox has to manage its own
      // roving focus across rows that do not exist yet.
      aria-current={isSelected ? true : undefined}
      className={cx(
        'flex h-full w-full cursor-pointer items-center gap-[15px] px-[25px] text-left',
        'transition-[background] duration-160',
        isPlaying
          ? 'yarg-wash-selected'
          : isSelected
            ? 'bg-surface-hover'
            : 'bg-surface-card hover:bg-surface-hover',
        // The wash has to point away from the text. The wide row's title sits
        // ~40% across, clear of the bright edge; the narrow row stacks title
        // and artist against the left edge, where white lands on #0082BA at
        // 4.28:1. Flipping the angle puts the colour on the empty side and the
        // text back on card black.
        isPlaying && '[--yarg-wash-angle:270deg] @2xl/list:[--yarg-wash-angle:90deg]',
        // Inward, because the ring is drawn on the row's own edge and a row
        // that pushed its focus outline outward would paint over its neighbour.
        'yarg-focusable focus-visible:[outline-offset:-3px]',
      )}
      style={{
        borderTop: playingBorder
          ? `3px solid ${playingBorder}`
          : '1px solid var(--color-border-row)',
        borderBottom: playingBorder
          ? `3px solid ${playingBorder}`
          : '1px solid var(--color-border-row)',
        borderLeft: `2px solid ${playingBorder ?? 'transparent'}`,
        borderRight: `2px solid ${playingBorder ?? 'transparent'}`,
        boxShadow: isSelected
          ? 'inset 0 0 0 var(--stroke) var(--yarg-vivid-sky-blue)'
          : undefined,
      }}
    >
      {isPlaying ? <span className="sr-only">Now playing. </span> : null}

      {/* Wide layout: aligned columns. */}
      <div className="hidden w-full items-center gap-[15px] @2xl/list:flex">
        <div
          dir="auto"
          className="min-w-0 flex-[3] truncate-tight text-[22px] leading-none font-semibold text-white"
        >
          {song.name}
        </div>
        {/*
         * Unclipped, and the truncation moved onto the name inside: the cover
         * credit is a second element in this cell now, and `overflow: hidden`
         * out here would cut the top and bottom off its two lines.
         */}
        <div className="flex min-w-0 flex-[2] text-[18px] leading-none font-medium text-content-secondary italic">
          <ArtistName song={song} credit="label" />
        </div>
        <div className="hidden min-w-0 flex-[2] truncate text-[16px] text-content-muted @6xl/list:block">
          {song.album || '—'}
        </div>
        <div className="hidden w-32 shrink-0 truncate text-[15px] text-content-muted @7xl/list:block">
          {song.genre || '—'}
        </div>
        <div className="font-numeric w-16 shrink-0 text-right text-[16px] tabular-nums text-count">
          <span className="sr-only">Released </span>
          {formatYear(song.yearNumber)}
        </div>
        <div className="font-numeric w-16 shrink-0 text-right text-[16px] tabular-nums text-count">
          <span className="sr-only">Length </span>
          {formatDuration(song.lengthSeconds)}
        </div>
        {/* `shrink-0` to match the header's `parts` column, which has it. Without
            it this is the one cell that gives up width under pressure, and the
            five slots stop lining up with the label above them. */}
        <InstrumentStrip song={song} className="hidden w-28 shrink-0 @4xl/list:flex" />
        <div className="flex w-20 shrink-0 justify-end">
          <BandDifficulty tier={song.bandDifficulty} />
        </div>
        <SourceBadge
          source={song.source}
          size={26}
          className="hidden w-40 shrink-0 @5xl/list:flex"
        />
      </div>

      {/*
       * Narrow layout: source, then title over a metadata line.
       *
       * The icon leads the row rather than sitting in the metadata cluster on
       * the right. It is the one field on a phone row that is a picture rather
       * than a number, so it reads at a glance from a fixed column down the
       * left edge — where the eye already is when it starts each row — instead
       * of shuffling left and right with the width of the time beside it.
       */}
      <SourceBadge
        source={song.source}
        size={24}
        showName={false}
        className="shrink-0 @2xl/list:hidden"
      />

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[4px] @2xl/list:hidden">
        <span dir="auto" className="truncate-tight text-[17px] leading-none font-semibold text-white">
          {song.name}
        </span>
        <span className="min-w-0 text-[14px] leading-none font-medium text-content-secondary italic">
          <ArtistName song={song} credit="label" />
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-[10px] @2xl/list:hidden">
        <span className="font-numeric text-[14px] tabular-nums text-count-muted">
          <span className="sr-only">Length </span>
          {formatDuration(song.lengthSeconds)}
        </span>
        {/* 28px on the phone row, not 32: the narrow row is 60px tall and the
            ring is the only thing in that cluster with real height to it. */}
        <BandDifficulty tier={song.bandDifficulty} size={28} />
      </div>
    </button>
  )
}
