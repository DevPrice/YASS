/**
 * App shell.
 *
 * Layout is a fixed now-playing banner and filter bar over a single scrolling
 * list, so the list keeps its own scroll position and the phone address bar
 * doesn't fight the page.
 */

import { useMemo, useState } from 'react'

import { Button, EmptyState, cx } from './ui'
import { formatRelativeTime } from './lib/format'
import { useLibrary } from './lib/useLibrary'
import { useNowPlaying } from './lib/useNowPlaying'
import { FiltersPanel } from './features/library/Filters'
import { SongList } from './features/library/SongList'
import { EMPTY_FILTERS, filterSongs, sortSongs } from './features/library/filtering'
import type { Filters, SortDirection, SortKey } from './features/library/filtering'
import { NowPlayingBar } from './features/nowPlaying/NowPlayingBar'
import { SettingsPanel } from './features/settings/SettingsPanel'

type View = 'library' | 'settings'

export function App() {
  const { library, loading, error, reload } = useLibrary()
  const { nowPlaying, connected } = useNowPlaying()

  const [view, setView] = useState<View>('library')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sortKey, setSortKey] = useState<SortKey>('artist')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const songs = library?.songs ?? []

  // Filter and sort are separate memos so changing sort doesn't redo the
  // (more expensive) text match across the whole library.
  const filtered = useMemo(() => filterSongs(songs, filters), [songs, filters])
  const visible = useMemo(
    () => sortSongs(filtered, sortKey, sortDirection),
    [filtered, sortKey, sortDirection],
  )

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <NowPlayingBar nowPlaying={nowPlaying} connected={connected} />

      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-content">YASS</span>
          {library ? (
            <span className="hidden text-xs text-content-faint sm:inline">
              list exported {formatRelativeTime(library.meta.generatedAt)}
            </span>
          ) : null}
        </div>

        <nav className="flex items-center gap-1">
          <Button
            variant={view === 'library' ? 'primary' : 'ghost'}
            onClick={() => setView('library')}
          >
            Library
          </Button>
          <Button
            variant={view === 'settings' ? 'primary' : 'ghost'}
            onClick={() => setView('settings')}
          >
            Settings
          </Button>
          <Button variant="ghost" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </Button>
        </nav>
      </header>

      {view === 'settings' ? (
        <div className="scrollbar-slim flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-2xl">
            <SettingsPanel onSaved={() => void reload()} />
          </div>
        </div>
      ) : (
        <LibraryView
          error={error}
          loading={loading}
          library={library}
          filters={filters}
          onFiltersChange={setFilters}
          visible={visible}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={handleSort}
          playingId={nowPlaying.song?.libraryId ?? null}
          onOpenSettings={() => setView('settings')}
        />
      )}
    </div>
  )
}

function LibraryView({
  error,
  loading,
  library,
  filters,
  onFiltersChange,
  visible,
  sortKey,
  sortDirection,
  onSort,
  playingId,
  onOpenSettings,
}: {
  error: string | null
  loading: boolean
  library: ReturnType<typeof useLibrary>['library']
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  visible: Parameters<typeof SongList>[0]['songs']
  sortKey: SortKey
  sortDirection: SortDirection
  onSort: (key: SortKey) => void
  playingId: string | null
  onOpenSettings: () => void
}) {
  if (error) {
    return (
      <EmptyState title="Could not load the song list">
        <p>{error}</p>
      </EmptyState>
    )
  }

  if (!library) {
    return (
      <div className={cx('flex flex-1 items-center justify-center text-sm text-content-muted')}>
        {loading ? 'Loading song list…' : 'No song list.'}
      </div>
    )
  }

  // No CSV configured yet — send the user straight to the fix rather than
  // showing an empty table.
  if (library.meta.count === 0) {
    return (
      <EmptyState title="No songs loaded">
        <p className="mb-4">
          {library.meta.warnings[0] ??
            'Export your song list from YARG (Settings → Export Songs List → CSV), then point YASS at the file.'}
        </p>
        <Button variant="primary" onClick={onOpenSettings}>
          Open settings
        </Button>
      </EmptyState>
    )
  }

  return (
    <>
      <FiltersPanel
        filters={filters}
        onChange={onFiltersChange}
        facets={library.facets}
        resultCount={visible.length}
        totalCount={library.meta.count}
      />
      <SongList
        songs={visible}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={onSort}
        playingId={playingId}
      />
    </>
  )
}
