/**
 * The song list.
 *
 * Virtualized because the library runs to thousands of rows — rendering them
 * all would stall the phone this is most likely being browsed on.
 *
 * One component serves both layouts: a column-aligned table on wide screens and
 * a stacked card on narrow ones, chosen with CSS rather than a JS breakpoint so
 * there's no layout flash on load.
 */

import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { Song } from '@shared/types'
import { Badge, EmptyState, cx } from '../../ui'
import { formatDuration, formatSource, formatYear } from '../../lib/format'
import type { SortDirection, SortKey } from './filtering'

const ROW_HEIGHT = 56

/** Columns shown on wide screens, in order. */
const COLUMNS: Array<{ key: SortKey; label: string; className: string }> = [
  { key: 'name', label: 'Title', className: 'flex-[3] min-w-0' },
  { key: 'artist', label: 'Artist', className: 'flex-[2] min-w-0' },
  { key: 'album', label: 'Album', className: 'flex-[2] min-w-0 hidden xl:block' },
  { key: 'genre', label: 'Genre', className: 'w-32 shrink-0 hidden 2xl:block' },
  { key: 'year', label: 'Year', className: 'w-16 shrink-0 text-right' },
  { key: 'length', label: 'Time', className: 'w-16 shrink-0 text-right' },
  { key: 'bandDifficulty', label: 'Diff', className: 'w-14 shrink-0 text-right' },
  { key: 'source', label: 'Source', className: 'w-28 shrink-0 hidden lg:block' },
]

interface SongListProps {
  songs: readonly Song[]
  sortKey: SortKey
  sortDirection: SortDirection
  onSort: (key: SortKey) => void
  /** Library id of the song YARG is currently playing, for highlighting. */
  playingId: string | null
}

export function SongList({ songs, sortKey, sortDirection, onSort, playingId }: SongListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: songs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  // Jump back to the top whenever the result set changes identity, or the user
  // is left scrolled into empty space after narrowing a filter.
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
      className={cx(
        'hidden items-center gap-3 border-b border-border px-4 py-2 md:flex',
        'text-xs font-medium tracking-wide text-content-faint uppercase',
      )}
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
              'flex items-center gap-1 transition-colors hover:text-content',
              active && 'text-accent',
              column.className.includes('text-right') && 'justify-end',
            )}
          >
            <span className="truncate">{column.label}</span>
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
        'flex h-full items-center gap-3 border-b border-border/50 px-4',
        'transition-colors hover:bg-surface-hover',
        isPlaying && 'bg-accent/10',
      )}
    >
      {/* Wide layout: aligned columns. */}
      <div className="hidden w-full items-center gap-3 text-sm md:flex">
        <div className="flex-[3] min-w-0">
          <div className="flex items-center gap-2">
            {isPlaying ? <Badge tone="accent">Now</Badge> : null}
            <span className="truncate font-medium text-content">{song.name}</span>
          </div>
        </div>
        <div className="flex-[2] min-w-0 truncate text-content-muted">{song.artist}</div>
        <div className="hidden flex-[2] min-w-0 truncate text-content-muted xl:block">
          {song.album || '—'}
        </div>
        <div className="hidden w-32 shrink-0 truncate text-content-muted 2xl:block">
          {song.genre || '—'}
        </div>
        <div className="w-16 shrink-0 text-right tabular-nums text-content-muted">
          {formatYear(song.yearNumber)}
        </div>
        <div className="w-16 shrink-0 text-right tabular-nums text-content-muted">
          {formatDuration(song.lengthSeconds)}
        </div>
        <div className="w-14 shrink-0 text-right tabular-nums text-content-muted">
          {song.bandDifficulty === null ? '—' : song.bandDifficulty}
        </div>
        <div className="hidden w-28 shrink-0 truncate text-content-faint lg:block">
          {formatSource(song.source)}
        </div>
      </div>

      {/* Narrow layout: two stacked lines. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center md:hidden">
        <div className="flex items-center gap-2">
          {isPlaying ? <Badge tone="accent">Now</Badge> : null}
          <span className="truncate text-sm font-medium text-content">{song.name}</span>
        </div>
        <div className="truncate text-xs text-content-muted">
          {song.artist}
          {song.yearNumber !== null ? ` · ${song.yearNumber}` : ''}
          {song.lengthSeconds !== null ? ` · ${formatDuration(song.lengthSeconds)}` : ''}
        </div>
      </div>
    </div>
  )
}
