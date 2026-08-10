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

import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { Song } from '@shared/types'
import { EmptyState, SortArrow, cx } from '../../ui'
import { DifficultyCapsule, InstrumentStrip, SourceBadge } from '../../ui/library'
import { formatDuration, formatYear } from '../../lib/format'
import type { SortDirection, SortKey } from './filtering'

/** The design system's list-item height. */
const ROW_HEIGHT = 80

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
}: SongListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: songs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

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
  const songsRef = useRef(songs)
  songsRef.current = songs

  useEffect(() => {
    if (selection === null) return

    const index = songsRef.current.findIndex((song) => song.id === selection.id)
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
      <SortHeader sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />

      <div
        ref={scrollRef}
        // Focusable so the list can be scrolled from the keyboard. Chrome makes
        // scroll containers focusable on its own; Firefox and Safari do not, and
        // without this a keyboard user reaches the end of the initial virtual
        // window and stops.
        tabIndex={0}
        role="list"
        aria-label={`Song library, ${songs.length.toLocaleString()} songs`}
        className="scrollbar-slim yarg-focusable min-h-0 flex-1 overflow-y-auto"
      >
        <div
          className="relative w-full"
          // Transparent to assistive tech: the spacer only exists to give the
          // scrollbar the full height, and it must not sit between the list and
          // its items.
          role="presentation"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const song = songs[virtualRow.index]
            if (!song) return null

            return (
              <div
                key={song.id}
                role="listitem"
                // Only ~17 rows exist in the DOM at a time, so without these a
                // screen reader reports a list of seventeen out of 4,168.
                aria-setsize={songs.length}
                aria-posinset={virtualRow.index + 1}
                className="absolute top-0 left-0 w-full"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <SongRow
                  song={song}
                  isPlaying={song.id === playingId}
                  isSelected={song.id === selection?.id}
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

function SortHeader({
  sortKey,
  sortDirection,
  onSort,
}: Pick<SongListProps, 'sortKey' | 'sortDirection' | 'onSort'>) {
  return (
    <div
      className="yarg-wash-header hidden items-center gap-[15px] px-[25px] py-[10px] @2xl/list:flex"
      style={{ borderBottom: '1px solid var(--color-border-strong)' }}
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
          className="min-w-0 flex-[3] truncate text-[22px] leading-none font-semibold text-white"
        >
          {song.name}
        </div>
        <div
          dir="auto"
          className="min-w-0 flex-[2] truncate text-[18px] leading-none font-medium text-content-secondary italic"
        >
          {song.artist}
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
        <InstrumentStrip song={song} className="hidden w-28 @4xl/list:flex" />
        <div className="flex w-20 shrink-0 justify-end">
          <DifficultyCapsule tier={song.bandDifficulty} />
        </div>
        <SourceBadge
          source={song.source}
          size={26}
          className="hidden w-40 shrink-0 @5xl/list:flex"
        />
      </div>

      {/* Narrow layout: title over a metadata line. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[4px] @2xl/list:hidden">
        <span dir="auto" className="truncate text-[17px] leading-none font-semibold text-white">
          {song.name}
        </span>
        <span
          dir="auto"
          className="truncate text-[14px] leading-none font-medium text-content-secondary italic"
        >
          {song.artist}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-[10px] @2xl/list:hidden">
        {/* The icon alone here: the name would cost the title its width. */}
        <SourceBadge source={song.source} size={24} showName={false} />
        <span className="font-numeric text-[14px] tabular-nums text-count-muted">
          <span className="sr-only">Length </span>
          {formatDuration(song.lengthSeconds)}
        </span>
        <DifficultyCapsule tier={song.bandDifficulty} />
      </div>
    </button>
  )
}
