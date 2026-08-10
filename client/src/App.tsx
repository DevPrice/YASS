/**
 * App shell.
 *
 * Layout is a fixed now-playing banner and filter bar over a single scrolling
 * list, so the list keeps its own scroll position and the phone address bar
 * doesn't fight the page.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'

import { EmptyState, HelperBar, cx } from './ui'
import { useLibrary } from './lib/useLibrary'
import { useNowPlaying } from './lib/useNowPlaying'
import { FiltersPanel } from './features/library/Filters'
import type { OpenPanel } from './features/library/Filters'
import { SongList } from './features/library/SongList'
import {
  EMPTY_FILTERS,
  filterSongs,
  hasActiveFilters,
  sortSongs,
} from './features/library/filtering'
import type { Filters, SortDirection, SortKey } from './features/library/filtering'
import { NowPlayingBar } from './features/nowPlaying/NowPlayingBar'

export function App() {
  const { library, loading, error } = useLibrary()
  const { nowPlaying, connected, settled } = useNowPlaying()

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

  /**
   * What Escape does *right now* — or null, when it would do nothing.
   *
   * The hint used to read "close, then clear", which is the implementation
   * described to someone who already knows it. A hint bar is read at a glance
   * mid-task, and at any given moment the key has exactly one effect; naming
   * that one is the whole job. The slot disappears rather than greying out
   * when there is nothing to close and nothing to clear, because a permanent
   * label for a key that does nothing is how a helper bar becomes furniture.
   */
  const escapeAction =
    openPanel !== 'none'
      ? `close ${openPanel}`
      : hasActiveFilters(filters)
        ? 'clear filters'
        : null

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

        // Otherwise it resets every filter, search included. From inside the
        // search field it also steps back out, so the second Escape isn't
        // swallowed by a field that has already been emptied.
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
      {/*
       * The heading is real but not drawn.
       *
       * There was a "yass" wordmark and a settings button in a bar of their
       * own here. The wordmark told a room full of people the name of the app
       * they were already looking at, once per phone, forever — and the header
       * was the only thing between the now-playing banner and the list, so
       * deleting it hands ~44px straight to song rows on the device that has
       * the least of them.
       *
       * A heading still has to exist, though: it is how screen-reader users
       * establish what a page is before they start moving through it, and the
       * page had none at all before this. `sr-only` keeps that without
       * spending a pixel.
       */}
      <h1 className="sr-only">Yet Another Song Selector</h1>

      <NowPlayingBar nowPlaying={nowPlaying} connected={connected} settled={settled} />

      {/*
       * `main` is itself the flex column, not a wrapper around one: the filter
       * bar positions itself with `order-last` below `md`, and order is
       * resolved against the immediate flex parent.
       */}
      <main className="flex min-h-0 flex-1 flex-col">
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
          searchRef={searchRef}
          openPanel={openPanel}
          onOpenPanelChange={setOpenPanel}
          queryKey={queryKey}
          onRandom={handleRandom}
          pickedId={pickedId}
        />
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
        {escapeAction ? <HelperHint keyLabel="esc" action={escapeAction} /> : null}
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

  /*
   * No CSV yet.
   *
   * One message for everyone, because the client no longer knows who it is
   * talking to — and shouldn't. This used to branch on the settings
   * capability and show the host `meta.warnings[0]`, which can carry the
   * absolute path to the CSV. That was safe only as long as the capability
   * check stood between it and the room. The warnings still reach the host,
   * on the terminal the server is running in, which is where a path belongs.
   */
  if (library.meta.count === 0) {
    return (
      <EmptyState title="No songs loaded">
        Nobody has exported the song list yet. In YARG: Settings → Export Songs List → CSV.
        Whoever is running it points YASS at the file once, and it keeps up from there.
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
