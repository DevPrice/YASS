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
import { fetchCapabilities } from './lib/api'
import { formatRelativeTime } from './lib/format'
import { useLibrary } from './lib/useLibrary'
import { useNowPlaying } from './lib/useNowPlaying'
import { FiltersPanel } from './features/library/Filters'
import type { OpenPanel } from './features/library/Filters'
import { SongList } from './features/library/SongList'
import { EMPTY_FILTERS, filterSongs, sortSongs } from './features/library/filtering'
import type { Filters, SortDirection, SortKey } from './features/library/filtering'
import { NowPlayingBar } from './features/nowPlaying/NowPlayingBar'
import { SettingsPanel } from './features/settings/SettingsPanel'

type View = 'library' | 'settings'

export function App() {
  const { library, loading, error, refresh } = useLibrary()
  const { nowPlaying, connected, settled } = useNowPlaying()

  /**
   * Settings are host-only, so the tab only exists when the server says this
   * client is the host. Guests browsing from a phone never see it.
   */
  const [canConfigure, setCanConfigure] = useState(false)

  useEffect(() => {
    void fetchCapabilities()
      .then((capabilities) => setCanConfigure(capabilities.settings))
      .catch(() => setCanConfigure(false))
  }, [])

  const [view, setView] = useState<View>('library')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sortKey, setSortKey] = useState<SortKey>('artist')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  /**
   * Which control sheet is open, held here rather than inside the filter bar so
   * Escape can dismiss it before falling through to clearing the filters.
   */
  const [openPanel, setOpenPanel] = useState<OpenPanel>('none')

  /**
   * The song the Random button landed on.
   *
   * The app has no queue and won't have one until the karaoke research lands,
   * so "random" does the honest browser-side thing: it picks one, scrolls it
   * into view, and marks it. That's enough to settle an argument in a room.
   */
  const [pickedId, setPickedId] = useState<string | null>(null)

  const songs = library?.songs ?? []

  // Filter and sort are separate memos so changing sort doesn't redo the
  // (more expensive) text match across the whole library.
  const filtered = useMemo(() => filterSongs(songs, filters), [songs, filters])
  const visible = useMemo(
    () => sortSongs(filtered, sortKey, sortDirection),
    [filtered, sortKey, sortDirection],
  )

  const searchRef = useRef<HTMLInputElement>(null)

  /**
   * Identifies the *query*, not the result.
   *
   * The list scrolls back to the top when this changes. Keying that off the
   * songs array instead would also fire whenever the library reloads — and now
   * that a re-export pushes a reload to every connected phone, that would yank
   * a reader back to the A's mid-scroll for something they didn't do.
   */
  const queryKey = JSON.stringify([filters, sortKey, sortDirection])

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
        // Escape unwinds one layer at a time. With a sheet open it closes the
        // sheet and stops there — going straight to wiping every filter would
        // make the reflex that dismisses a panel also destroy the work that
        // panel was used for.
        if (openPanel !== 'none') {
          setOpenPanel('none')
          return
        }

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
  }, [openPanel])

  const handleRandom = () => {
    if (visible.length === 0) return
    const choice = visible[Math.floor(Math.random() * visible.length)]
    if (choice !== undefined) {
      setPickedId(choice.id)
      // Close the sheet so the pick is actually visible on a phone.
      setOpenPanel('none')
    }
  }

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
      <NowPlayingBar nowPlaying={nowPlaying} connected={connected} settled={settled} />

      <header className="flex shrink-0 items-center justify-between gap-[15px] bg-surface-app px-[25px] py-[10px]">
        <div className="flex items-baseline gap-[15px]">
          {/* The app had no heading at all, so heading navigation did nothing. */}
          <h1 className="yarg-label text-[24px] text-white">yass</h1>
          {library ? (
            <span className="hidden text-[13px] text-content-faint sm:inline">
              list exported {formatRelativeTime(library.meta.generatedAt)}
            </span>
          ) : null}
        </div>

        {/*
         * Host-only, and the only thing in the header besides the wordmark.
         *
         * There used to be a `library` tab, which was permanently active and
         * did nothing, and a `reload` button — the one control a guest had that
         * acted on the host's machine, next to a stale list nobody could tell
         * was stale. The server watches the CSV now, so re-exporting from YARG
         * updates every phone in the room on its own.
         */}
        {canConfigure ? (
          <Button
            tone="accent"
            quiet={view !== 'settings'}
            aria-pressed={view === 'settings'}
            onClick={() => setView(view === 'settings' ? 'library' : 'settings')}
          >
            settings
          </Button>
        ) : null}
      </header>

      {/*
       * `main` is itself the flex column, not a wrapper around one: the filter
       * bar positions itself with `order-last` below `md`, and order is
       * resolved against the immediate flex parent.
       */}
      <main className="flex min-h-0 flex-1 flex-col">
      {view === 'settings' && canConfigure ? (
        <div className="scrollbar-slim flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-2xl">
            <SettingsPanel onSaved={() => void refresh()} />
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
          onOpenSettings={canConfigure ? () => setView('settings') : null}
          searchRef={searchRef}
          openPanel={openPanel}
          onOpenPanelChange={setOpenPanel}
          queryKey={queryKey}
          onRandom={handleRandom}
          pickedId={pickedId}
        />
      )}
      </main>

      {/*
       * The helper bar is the strongest identity cue in YARG's chrome, so the
       * design system keeps it on the companion app even though a browser has
       * no gamepad. It's branding with a shortcut function, not a control bar.
       *
       * Which is exactly why it stops at `md`. On a phone it was spending the
       * one screen region a thumb can comfortably reach on two shortcuts the
       * device cannot produce; below `md` the filter bar takes that space and
       * fills it with controls. Nothing is lost — the shortcuts don't apply
       * without a keyboard, and the play state is already the subject of the
       * now-playing banner at the top of the screen.
       */}
      <HelperBar className="hidden md:flex">
        <HelperHint keyLabel="/" action="search" />
        <HelperHint keyLabel="esc" action="close, then clear" />
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
  openPanel,
  onOpenPanelChange,
  queryKey,
  onRandom,
  pickedId,
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
  /** Null for guests — configuration is host-only. */
  onOpenSettings: (() => void) | null
  searchRef: Ref<HTMLInputElement>
  openPanel: OpenPanel
  onOpenPanelChange: (panel: OpenPanel) => void
  queryKey: string
  onRandom: () => void
  pickedId: string | null
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
    // Guests can't fix this, so don't hand them a dead end — tell them whose
    // problem it is instead of showing a settings button that isn't there.
    if (!onOpenSettings) {
      return (
        <EmptyState title="No songs loaded">
          The song list hasn&apos;t been set up yet. Ask whoever is running YARG to export it.
        </EmptyState>
      )
    }

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
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={onSort}
        onRandom={onRandom}
        open={openPanel}
        onOpenChange={onOpenPanelChange}
        searchRef={searchRef}
      />
      <SongList
        songs={visible}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={onSort}
        playingId={playingId}
        pickedId={pickedId}
        queryKey={queryKey}
      />
    </>
  )
}
