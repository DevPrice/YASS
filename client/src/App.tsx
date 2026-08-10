/**
 * App shell.
 *
 * Layout is a fixed now-playing banner and filter bar over a single scrolling
 * list, so the list keeps its own scroll position and the phone address bar
 * doesn't fight the page.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'

import { Button, EmptyState, HelperBar, cx } from './ui'
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

  const searchRef = useRef<HTMLInputElement>(null)

  // The helper bar advertises these, so they have to actually work.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement

      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }

      if (event.key === 'Escape') {
        // Inside the search field, clear it and step back out; elsewhere,
        // reset every filter at once.
        if (target === searchRef.current) {
          searchRef.current?.blur()
        }
        setFilters(EMPTY_FILTERS)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

      <header className="flex shrink-0 items-center justify-between gap-[15px] bg-surface-app px-[25px] py-[10px]">
        <div className="flex items-baseline gap-[15px]">
          <span className="yarg-label text-[24px] text-white">yass</span>
          {library ? (
            <span className="hidden text-[13px] text-content-faint sm:inline">
              list exported {formatRelativeTime(library.meta.generatedAt)}
            </span>
          ) : null}
        </div>

        <nav className="flex items-center gap-[5px]">
          <Button
            tone="accent"
            quiet={view !== 'library'}
            onClick={() => setView('library')}
          >
            library
          </Button>
          <Button
            tone="accent"
            quiet={view !== 'settings'}
            onClick={() => setView('settings')}
          >
            settings
          </Button>
          <Button quiet onClick={() => void reload()} disabled={loading}>
            {loading ? 'loading' : 'reload'}
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
          searchRef={searchRef}
        />
      )}

      {/*
       * The helper bar is the strongest identity cue in YARG's chrome, so the
       * design system keeps it on the companion app even though a browser has
       * no gamepad. It's branding with a shortcut function, not a control bar.
       */}
      <HelperBar>
        <HelperHint keyLabel="/" action="search" />
        <HelperHint keyLabel="esc" action="clear filters" />
        <span className="ml-auto text-[12px] text-content-faint">
          {nowPlaying.playing ? 'yarg is playing' : 'yarg is idle'}
        </span>
      </HelperBar>
    </div>
  )
}

/** Keyboard analogue of the game's gamepad hint. */
function HelperHint({ keyLabel, action }: { keyLabel: string; action: string }) {
  return (
    <span className="flex items-center gap-[10px]">
      <kbd
        className="font-numeric flex h-[24px] min-w-[24px] items-center justify-center px-[7px] text-[12px] font-semibold text-white"
        style={{
          borderRadius: 'var(--radius-sm)',
          background: 'var(--yarg-surface-sunken)',
          boxShadow: 'inset 0 0 0 2px var(--yarg-border-card)',
        }}
      >
        {keyLabel}
      </kbd>
      <span className="yarg-label text-[12px] text-content-muted">{action}</span>
    </span>
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
  searchRef,
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
  searchRef: Ref<HTMLInputElement>
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
        <p className="mb-[25px]">
          {library.meta.warnings[0] ??
            'Export your song list from YARG (Settings → Export Songs List → CSV), then point YASS at the file.'}
        </p>
        <Button tone="accent" onClick={onOpenSettings}>
          open settings
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
        searchRef={searchRef}
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
