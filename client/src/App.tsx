/**
 * App shell.
 *
 * A fixed now-playing banner over one scrolling list, so the list keeps its own
 * scroll position and the phone address bar doesn't fight the page — and, from
 * `lg` up, a second pane beside the list holding whatever song is selected.
 *
 * **The two panes are the layout, not a widescreen decoration.** The list was
 * the entire app at every width, which meant a 27-inch monitor got the phone's
 * design with the columns pulled apart: eight columns of 4,168 rows and nothing
 * to do with the other half of the screen. Master-detail spends that width on
 * the thing the list cannot hold — the twenty per-instrument difficulties, the
 * charter, the source, the full untruncated title — and it does it without
 * inventing a second interaction, because selecting a song is the same gesture
 * on a phone, where the same component arrives as a sheet.
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import type { Ref } from 'react'

import type { Song } from '@shared/types'
import { EmptyState, HelperBar, cx } from './ui'
import type { DifficultyLens } from './lib/difficulty'
import { formatTitleCredit } from './lib/format'
import { useLibrary } from './lib/useLibrary'
import { useMediaQuery } from './lib/useMediaQuery'
import { useNowPlaying } from './lib/useNowPlaying'
import { decodeAppState, syncUrl } from './lib/urlState'
import { FiltersPanel } from './features/library/Filters'
import type { OpenPanel } from './features/library/Filters'
import { SongList } from './features/library/SongList'
import type { Selection } from './features/library/SongList'
import { SongDetail, SongDetailEmpty } from './features/library/SongDetail'
import { SongDetailSheet } from './features/library/SongDetailSheet'
import {
  EMPTY_FILTERS,
  deriveFacets,
  filterSongs,
  hasActiveView,
  sortSongs,
} from './features/library/filtering'
import type { Filters, SortDirection, SortKey } from './features/library/filtering'
import { NowPlayingBar } from './features/nowPlaying/NowPlayingBar'

/**
 * Where the detail stops being a sheet and becomes a pane.
 *
 * Tailwind's `lg`, kept as a string because JavaScript has to know it too: a
 * modal `<dialog>` and a static pane are different elements with different
 * semantics, so exactly one of them may exist at a time. Everything else about
 * the layout stays in CSS — the list's columns are container queries against
 * the list's own width, which is the only honest measure once the pane is
 * taking a third of the window.
 */
const TWO_PANE_QUERY = '(min-width: 64rem)'

export function App() {
  const { library, loading, error } = useLibrary()
  const { nowPlaying, connected, settled } = useNowPlaying()

  /**
   * The view, read out of the address bar on the way in.
   *
   * Lazy initialisers rather than an effect, so the first render is already the
   * shared view — an effect would paint the whole library, then the filtered
   * one, and yank the list back to the top between the two.
   */
  const initial = useMemo(() => decodeAppState(window.location.search), [])

  const [filters, setFilters] = useState<Filters>(initial.filters)
  const [sortKey, setSortKey] = useState<SortKey>(initial.sortKey)
  const [sortDirection, setSortDirection] = useState<SortDirection>(initial.sortDirection)

  /**
   * Which part every difficulty on screen is about.
   *
   * Held beside the filters rather than inside them because it is not one: it
   * removes no songs. What it does is decide which of a song's twenty-one tiers
   * the filter chips, the sort, the ring on every row, the column header and the
   * jump rail are all quoting — five surfaces that have to agree, which is
   * exactly why the answer lives in one place. See `lib/difficulty.ts`.
   */
  const [lens, setLens] = useState<DifficultyLens>(initial.lens)

  /**
   * Which control sheet is open, held here rather than inside the filter bar so
   * Escape can dismiss it before falling through to clearing the filters.
   */
  const [openPanel, setOpenPanel] = useState<OpenPanel>('none')

  /**
   * The song being looked at, and how the list should reveal it.
   *
   * This is also where the Random button lands. It used to have a mark of its
   * own — scroll to a song, outline it, say nothing further — which answered
   * "which one" and then dropped the question everybody actually asks next.
   * Picking at random now selects, so the pick arrives with its parts, its
   * difficulty and its charter attached.
   *
   * A song restored from the URL arrives `center`ed: whoever opens that link did
   * not scroll to it, so the list has to place it somewhere it can be seen with
   * its neighbours rather than wherever an `auto` reveal decides is least work.
   */
  const [selection, setSelection] = useState<Selection | null>(
    initial.selectedId === null ? null : { id: initial.selectedId, align: 'center' },
  )

  const twoPane = useMediaQuery(TWO_PANE_QUERY)

  const songs = library?.songs ?? []

  /**
   * The filters the *list* is showing, which are allowed to lag the box.
   *
   * Typing used to re-sort the library between the keypress and the character
   * appearing: 140ms of blocked main thread per keystroke on a mid-range phone
   * with five thousand songs, and 184ms on the backspace that widens the
   * filter back to everything. The field is the thing that has to feel
   * instant; the list can arrive a frame later.
   *
   * `useDeferredValue` rather than `useTransition` because the trigger is a
   * controlled input. The field stays bound to `filters` and repaints on the
   * keystroke; the list re-renders in a second, interruptible pass — and if
   * another key lands first, React abandons that pass and starts over on the
   * newest value instead of grinding through every prefix.
   *
   * It is worth being clear about what this does not do: React can interrupt
   * *between* components, not inside a `useMemo`, so the sort below still owns
   * the main thread for however long it takes. What moved is when it runs —
   * after the character is on screen rather than before it.
   */
  const deferredFilters = useDeferredValue(filters)

  /**
   * Sorted first, filtered second — the reverse of the obvious order, and the
   * reason a keystroke now costs a filter pass instead of a filter and a sort.
   *
   * `Array.filter` preserves order, so filtering a sorted library gives exactly
   * the array that sorting the filtered one does. But the sort is the O(n log n)
   * half and every comparison goes through `Intl.Collator`, and this way it
   * depends only on the library and the sort key — neither of which a keystroke
   * touches. Searching stopped sorting anything at all.
   */
  const sorted = useMemo(
    () => sortSongs(songs, sortKey, sortDirection, lens),
    [songs, sortKey, sortDirection, lens],
  )
  const visible = useMemo(
    () => filterSongs(sorted, deferredFilters, lens),
    [sorted, deferredFilters, lens],
  )

  /**
   * Decade, vocal count and length bucket, tallied off the library itself.
   *
   * The server's facets cover the CSV's own columns; these three are this app's
   * cuts across fields it already has, and the tables they cut at live in
   * `lib/format.ts` because YARG drew them. Memoized on `songs`, so a re-export
   * pushed to every phone recomputes them once and a keystroke never does.
   */
  const derivedFacets = useMemo(() => deriveFacets(songs), [songs])

  /**
   * Resolved against the whole library, not the filtered view.
   *
   * Narrowing the list to something the selected song falls outside of is not a
   * reason to throw away what someone is reading — and clearing the selection
   * from under them would make the filter controls feel destructive.
   */
  const selected = useMemo<Song | null>(
    () => (selection === null ? null : (songs.find((song) => song.id === selection.id) ?? null)),
    [songs, selection],
  )

  const searchRef = useRef<HTMLInputElement>(null)

  const playingSong = nowPlaying.playing ? nowPlaying.song : null
  const playingId = playingSong?.libraryId ?? null

  /** Only the playing song has art on disk we can reach. See `SongDetail`. */
  const detailArtHash =
    selected !== null && playingSong !== null && playingSong.libraryId === selected.id && playingSong.hasArt
      ? playingSong.hash
      : null

  const select = useCallback((song: Song, align: Selection['align'] = 'auto') => {
    setSelection({ id: song.id, align })
    // The filter sheet and the detail sheet both come up from the bottom edge
    // of a phone, and only one of them can have it.
    setOpenPanel('none')
  }, [])

  /** The playing song, if the library knows it. Null disables both routes to it. */
  const showPlaying = useMemo(() => {
    if (playingId === null) return null

    const song = songs.find((candidate) => candidate.id === playingId)
    if (song === undefined) return null

    return () => select(song, 'center')
  }, [playingId, songs, select])

  /**
   * Identifies the *query*, not the result.
   *
   * The list re-anchors when this changes — on the selected song if the new
   * filters kept it, at the top if there is nothing left to hold on to. Keying
   * that off the songs array instead would also fire whenever the library
   * reloads, and now that a re-export pushes a reload to every connected phone,
   * that would move a reader mid-scroll for something they didn't do.
   */
  // Built from the deferred filters, not the live ones: this is what returns
  // the list to the top, and it has to change on the commit that shows the new
  // results rather than on the one that shows the new character.
  const queryKey = JSON.stringify([deferredFilters, sortKey, sortDirection, lens])

  /**
   * The view, written back to the address bar.
   *
   * Everything anybody builds up here used to survive nothing: a refresh lost
   * it, a phone lock that evicted the tab lost it, and handing your phone to
   * the person beside you — the entire social mechanic of a room picking a
   * song — lost it. Now the URL *is* the view, so all three work and the view
   * is also a link somebody can send to four other phones.
   *
   * `replaceState`, never `pushState`. See `lib/urlState.ts` for why Back is
   * deliberately not an undo, and Escape is.
   *
   * Off the live filters rather than the deferred ones: the address bar is not
   * the list and has no reason to lag a keystroke.
   */
  useEffect(() => {
    syncUrl({ filters, sortKey, sortDirection, lens, selectedId: selection?.id ?? null })
  }, [filters, sortKey, sortDirection, lens, selection])

  /**
   * A real navigation, read back.
   *
   * Nothing here pushes history, so this fires only when the browser moves
   * between entries for some other reason — opening a shared link in the same
   * tab, or Forward after a Back that left the app and came home. Ignoring it
   * would leave the address bar and the screen describing different views.
   */
  useEffect(() => {
    const onPopState = () => {
      const state = decodeAppState(window.location.search)

      setFilters(state.filters)
      setSortKey(state.sortKey)
      setSortDirection(state.sortDirection)
      setLens(state.lens)
      setSelection(
        state.selectedId === null ? null : { id: state.selectedId, align: 'center' },
      )
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  /**
   * What Escape does *right now* — or null, when it would do nothing.
   *
   * The hint used to read "close, then clear", which is the implementation
   * described to someone who already knows it. A hint bar is read at a glance
   * mid-task, and at any given moment the key has exactly one effect; naming
   * that one is the whole job. The slot disappears rather than greying out
   * when there is nothing left to unwind, because a permanent label for a key
   * that does nothing is how a helper bar becomes furniture.
   */
  const escapeAction =
    openPanel !== 'none'
      ? `close ${openPanel}`
      : selection !== null
        ? 'close song'
        : hasActiveView(filters, lens)
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

      /*
       * Arrows walk the selection, which is what makes the pane a desktop
       * layout rather than two things next to each other: pick one song and
       * the rest of the library is a keypress away, no pointer involved.
       *
       * Once something is selected, or whenever focus is inside the list. The
       * second half is what makes the first discoverable: rows stopped being
       * tab stops when the list became one, so Tab now lands on the library
       * itself, and the key a person tries there has to be the key that walks
       * it. Gating on a selection meant the affordance only appeared once you
       * had already found it some other way.
       *
       * Anywhere else with nothing selected they stay the keys that scroll the
       * page, which is what they should be when the list is not what has focus.
       */
      const inList = target?.closest('[role="list"]') != null

      if (
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        !typing &&
        (selection !== null || inList)
      ) {
        const step = event.key === 'ArrowDown' ? 1 : -1

        // From nothing selected, the first press takes the end of the list the
        // key points at rather than counting from a position that doesn't exist.
        const next =
          selection === null
            ? visible[step === 1 ? 0 : visible.length - 1]
            : (() => {
                const index = visible.findIndex((song) => song.id === selection.id)
                return index === -1 ? undefined : visible[index + step]
              })()

        if (next === undefined) return

        event.preventDefault()
        setSelection({ id: next.id, align: 'auto' })
        return
      }

      if (event.key === 'Escape') {
        // Escape unwinds one layer at a time. With a sheet open it closes the
        // sheet and stops there — going straight to wiping every filter would
        // make the reflex that dismisses a panel also destroy the work that
        // panel was used for.
        /*
         * `preventDefault` on both of the branches that handle the key, because
         * a browser clears an `input[type=search]` on Escape all by itself.
         * Without this, closing a song from inside the search field silently
         * threw the search away too — one press, two effects, and the helper
         * bar promising only one of them.
         */
        if (openPanel !== 'none') {
          event.preventDefault()
          setOpenPanel('none')
          return
        }

        /*
         * Below `lg` the detail is a modal `<dialog>`, which takes Escape as a
         * `cancel` event and stops it before it reaches this listener — so it
         * gets its exit animation instead of being yanked out of the DOM. This
         * branch is what closes the *pane*, where there is no dialog.
         */
        if (selection !== null) {
          event.preventDefault()
          setSelection(null)
          return
        }

        // Otherwise it resets every filter, search included — and the
        // difficulty lens, which is the one piece of state that can outlive an
        // empty filter set and would otherwise leave the list quoting drum
        // tiers after being told to clear. From inside the search field it also
        // steps back out, so the second Escape isn't swallowed by a field that
        // has already been emptied.
        if (target === searchRef.current) {
          searchRef.current?.blur()
        }
        setFilters(EMPTY_FILTERS)
        setLens('band')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openPanel, selection, visible])

  const handleRandom = () => {
    if (visible.length === 0) return

    const choice = visible[Math.floor(Math.random() * visible.length)]
    // Centred, so the songs either side of the pick are visible too — the pick
    // is a suggestion, and the neighbours are the argument against it.
    if (choice !== undefined) select(choice, 'center')
  }

  /**
   * Re-ordering is the one thing left that still sorts, so it goes in a
   * transition — 110-176ms of blocked main thread at five thousand songs on a
   * throttled phone, all of it after a tap that otherwise showed nothing.
   *
   * `useTransition` rather than deferring the sort key, because the key is read
   * by three things that have to agree: the arrow in the column header, the
   * order of the rows, and the category headers dividing them. Deferring the
   * value would move the arrow while the rows it describes were still the old
   * ones. Marking the *update* non-urgent moves all three together and leaves
   * `isSorting` to say that something is happening in the meantime.
   */
  const [isSorting, startSorting] = useTransition()

  const handleSort = (key: SortKey) => {
    startSorting(() => {
      if (key === sortKey) {
        setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDirection('asc')
      }
    })
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

      <NowPlayingBar
        nowPlaying={nowPlaying}
        connected={connected}
        settled={settled}
        onSelect={showPlaying}
      />

      <main className="flex min-h-0 flex-1">
        {/*
         * The list column names itself as a container, and everything inside
         * it — the table's columns, the sort header, the compact sort chips —
         * measures against this box rather than the window. That is what stops
         * the two-pane layout from being a stretched phone: at 1280px the list
         * has 870px and shows through `source`, at 1920px it has 1460px and
         * shows all nine columns, and neither number is the viewport's.
         *
         * It is also the flex column the filter bar's `order-last` resolves
         * against, which is why that bar is inside here and not a sibling.
         */}
        <div className="@container/list flex min-w-0 flex-1 flex-col">
          <LibraryView
            error={error}
            loading={loading}
            library={library}
            filters={filters}
            onFiltersChange={setFilters}
            derivedFacets={derivedFacets}
            lens={lens}
            onLensChange={setLens}
            visible={visible}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={handleSort}
            playingId={playingId}
            searchRef={searchRef}
            openPanel={openPanel}
            onOpenPanelChange={setOpenPanel}
            queryKey={queryKey}
            onRandom={handleRandom}
            selection={selection}
            onSelect={select}
            isSorting={isSorting}
          />
        </div>

        {twoPane ? (
          <aside
            aria-label="Song details"
            className={cx(
              'scrollbar-slim flex w-[clamp(320px,32%,460px)] shrink-0 flex-col',
              'overflow-y-auto bg-surface-card',
            )}
            // Every surface in this palette sits within 1.15:1 of every other,
            // so the seam between the panes has to be drawn rather than implied
            // by the fill. Same rule the song rows are separated with.
            style={{ borderLeft: '1px solid var(--color-border-row)' }}
          >
            {selected ? (
              <SongDetail
                song={selected}
                isPlaying={selected.id === playingId}
                artHash={detailArtHash}
                className="p-[25px]"
              />
            ) : (
              <SongDetailEmpty onShowPlaying={showPlaying} />
            )}
          </aside>
        ) : null}
      </main>

      {/*
       * The helper bar is the strongest identity cue in YARG's chrome, so the
       * design system keeps it on the companion app even though a browser has
       * no gamepad. It's branding with a shortcut function, not a control bar.
       *
       * Which is exactly why it stops at `md`. On a phone it was spending the
       * one screen region a thumb can comfortably reach on shortcuts the device
       * cannot produce; below `md` the filter bar takes that space and fills it
       * with controls. Nothing is lost — the shortcuts don't apply without a
       * keyboard, and the play state is already the subject of the now-playing
       * banner at the top of the screen.
       */}
      <HelperBar className="hidden md:flex">
        <HelperHint keyLabel="/" action="search" />
        {selection !== null ? <HelperHint keyLabel="↑↓" action="next song" /> : null}
        {escapeAction ? <HelperHint keyLabel="esc" action={escapeAction} /> : null}
        <span className="ml-auto text-[12px] text-content-faint">
          {nowPlaying.playing ? 'yarg is playing' : 'yarg is idle'}
        </span>
      </HelperBar>

      {/*
       * Below `lg` the same detail arrives as a modal sheet. Rendered instead of
       * the pane, never alongside it: a `<dialog>` hidden with `display:none`
       * is still a dialog waiting to trap focus.
       */}
      {!twoPane && selected ? (
        <SongDetailSheet label={formatTitleCredit(selected)} onClose={() => setSelection(null)}>
          <SongDetail
            song={selected}
            isPlaying={selected.id === playingId}
            artHash={detailArtHash}
            // Less of the sheet spent on the plate than the pane spends, so a
            // phone shows the title, the album and the whole parts grid without
            // anyone scrolling for them.
            className="px-[25px] pt-[5px] [--plate-cap:30svh]"
          />
        </SongDetailSheet>
      ) : null}
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
  derivedFacets,
  lens,
  onLensChange,
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
  selection,
  onSelect,
  isSorting,
}: {
  error: string | null
  loading: boolean
  library: ReturnType<typeof useLibrary>['library']
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  derivedFacets: ReturnType<typeof deriveFacets>
  lens: DifficultyLens
  onLensChange: (lens: DifficultyLens) => void
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
  selection: Selection | null
  onSelect: (song: Song) => void
  /** True while a re-order is in flight; the list says so rather than freezing. */
  isSorting: boolean
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
        derived={derivedFacets}
        lens={lens}
        onLensChange={onLensChange}
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
        lens={lens}
        playingId={playingId}
        selection={selection}
        onSelect={onSelect}
        queryKey={queryKey}
        isSorting={isSorting}
      />
    </>
  )
}
