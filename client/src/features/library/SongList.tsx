/**
 * The song list.
 *
 * Row anatomy follows the design system's `LibraryRow`: an 80px row, Barlow 25px
 * title in the chart's own casing, italic cyan artist, and a rounded capsule for
 * the difficulty. The selected row swaps to the cyan fill washed out to card
 * colour and grows a hard white border — the design's signature treatment.
 *
 * Virtualized because the library runs to thousands of rows.
 *
 * Not yet implemented, pending the bitmap assets: source tiles, instrument
 * glyphs and star ratings. `LibraryRow` places those at the row's edges; there
 * is room reserved for them here.
 */

import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { Song } from '@shared/types'
import { EmptyState, cx } from '../../ui'
import { formatDuration, formatSource, formatYear } from '../../lib/format'
import type { SortDirection, SortKey } from './filtering'

/** The design system's list-item height. */
const ROW_HEIGHT = 80

const COLUMNS: Array<{ key: SortKey; label: string; className: string }> = [
  { key: 'name', label: 'title', className: 'flex-[3] min-w-0' },
  { key: 'artist', label: 'artist', className: 'flex-[2] min-w-0' },
  { key: 'album', label: 'album', className: 'flex-[2] min-w-0 hidden xl:block' },
  { key: 'genre', label: 'genre', className: 'w-32 shrink-0 hidden 2xl:block' },
  { key: 'year', label: 'year', className: 'w-16 shrink-0 text-right' },
  { key: 'length', label: 'time', className: 'w-16 shrink-0 text-right' },
  { key: 'bandDifficulty', label: 'diff', className: 'w-20 shrink-0 text-right' },
  { key: 'source', label: 'source', className: 'w-28 shrink-0 hidden lg:block' },
]

interface SongListProps {
  songs: readonly Song[]
  sortKey: SortKey
  sortDirection: SortDirection
  onSort: (key: SortKey) => void
  playingId: string | null
}

export function SongList({ songs, sortKey, sortDirection, onSort, playingId }: SongListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: songs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // Return to the top when the result set changes, so narrowing a filter doesn't
  // leave the user scrolled into empty space.
  useEffect(() => {
    virtualizer.scrollToOffset(0)
  }, [songs, virtualizer])

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

      <div ref={scrollRef} className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const song = songs[virtualRow.index]
            if (!song) return null

            return (
              <div
                key={song.id}
                className="absolute top-0 left-0 w-full"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <SongRow song={song} isPlaying={song.id === playingId} />
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
      className="yarg-wash-header hidden items-center gap-[15px] px-[25px] py-[10px] md:flex"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}
    >
      {COLUMNS.map((column) => {
        const active = column.key === sortKey

        return (
          <button
            key={column.key}
            type="button"
            onClick={() => onSort(column.key)}
            aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={cx(
              column.className,
              'yarg-label flex cursor-pointer items-center gap-[5px] text-[13px] transition-colors duration-160',
              active ? 'text-white' : 'text-content-header opacity-70 hover:opacity-100',
              column.className.includes('text-right') && 'justify-end',
            )}
          >
            <span className="truncate">{column.label}</span>
            {/* The file uses ▲ as its one unicode chevron; no icon font, no emoji. */}
            {active ? <span aria-hidden>{sortDirection === 'asc' ? '▲' : '▼'}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

function SongRow({ song, isPlaying }: { song: Song; isPlaying: boolean }) {
  return (
    <div
      className={cx(
        'flex h-full items-center gap-[15px] px-[25px] transition-[background] duration-160',
        isPlaying ? 'yarg-wash-selected' : 'bg-surface-card hover:bg-surface-hover',
      )}
      style={{
        borderTop: isPlaying ? '3px solid #fff' : '1px solid rgba(255,255,255,0.08)',
        borderBottom: isPlaying ? '3px solid #fff' : '1px solid rgba(255,255,255,0.08)',
        borderLeft: `2px solid ${isPlaying ? '#fff' : 'transparent'}`,
        borderRight: `2px solid ${isPlaying ? '#fff' : 'transparent'}`,
      }}
    >
      {/* Wide layout: aligned columns. */}
      <div className="hidden w-full items-center gap-[15px] md:flex">
        <div className="min-w-0 flex-[3] truncate text-[22px] leading-none font-semibold text-white">
          {song.name}
        </div>
        <div className="min-w-0 flex-[2] truncate text-[18px] leading-none font-medium text-content-secondary italic">
          {song.artist}
        </div>
        <div className="hidden min-w-0 flex-[2] truncate text-[16px] text-content-muted xl:block">
          {song.album || '—'}
        </div>
        <div className="hidden w-32 shrink-0 truncate text-[15px] text-content-muted 2xl:block">
          {song.genre || '—'}
        </div>
        <div className="font-numeric w-16 shrink-0 text-right text-[16px] tabular-nums text-count">
          {formatYear(song.yearNumber)}
        </div>
        <div className="font-numeric w-16 shrink-0 text-right text-[16px] tabular-nums text-count">
          {formatDuration(song.lengthSeconds)}
        </div>
        <div className="flex w-20 shrink-0 justify-end">
          <DifficultyCapsule tier={song.bandDifficulty} />
        </div>
        <div className="hidden w-28 shrink-0 truncate text-[14px] text-count-muted uppercase lg:block">
          {formatSource(song.source)}
        </div>
      </div>

      {/* Narrow layout: title over a metadata line. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[4px] md:hidden">
        <span className="truncate text-[17px] leading-none font-semibold text-white">
          {song.name}
        </span>
        <span className="truncate text-[14px] leading-none font-medium text-content-secondary italic">
          {song.artist}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-[10px] md:hidden">
        <span className="font-numeric text-[14px] tabular-nums text-count-muted">
          {formatDuration(song.lengthSeconds)}
        </span>
        <DifficultyCapsule tier={song.bandDifficulty} />
      </div>
    </div>
  )
}

/**
 * Band difficulty in the design's rounded capsule.
 *
 * `LibraryRow` overlaps an instrument glyph on the capsule's left edge; that
 * arrives with the bitmap assets.
 */
function DifficultyCapsule({ tier }: { tier: number | null }) {
  if (tier === null) {
    return <span className="text-[15px] text-content-faint">—</span>
  }

  return (
    <span
      className="font-numeric inline-flex h-[32px] items-center px-[13px] text-[16px] font-semibold text-white"
      style={{ borderRadius: 'var(--radius-round)', background: 'var(--yarg-surface-sunken)' }}
    >
      {tier}
    </span>
  )
}
