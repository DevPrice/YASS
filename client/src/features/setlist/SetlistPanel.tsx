/**
 * The setlist, as one panel.
 *
 * It lives wherever the song detail lives — the other face of the detail sheet
 * below `lg`, the detail pane's resting face from `lg` — and never gets a row,
 * tab or column of its own. The list costs the library nothing until somebody
 * asks for it.
 *
 * **Stale, not gone.** When YARG stops sharing, the last setlist stays up in
 * the muted voice, stamped with when it was true, and is removed only when YARG
 * shows it empty. "Cleared" is said at that moment and no other: a setlist out
 * of view because the host opened Difficulty Select comes back exactly as it was.
 * A stale list also stops claiming where the show is: no `played` / `up next`
 * bands, whose counts would say a song was played that may never have been, and
 * the up-now row says only that it *was* up now.
 *
 * **Up now is not playing.** YARG moves the show's position when a song is
 * started, before Difficulty Select, so for a moment the setlist and the
 * now-playing banner can name different songs. The row claims "up now", and
 * wears the playing row's white borders only once the banner agrees.
 *
 * **Every state that can take a song offers the way to one.** `find a song`
 * sits in the empty and cleared states and under the list, and hands the guest
 * to the library's search: the sheet steps aside, or the pane's neighbour takes
 * focus. A queue screen that only explains how to add is a dead end.
 *
 * A plain list rather than a virtualized one, unlike the library. Remote adds
 * stop at 500 songs and YARG sends at most about 800, which is a few hundred
 * rows rendered once per setlist change — and a row that slides under a finger
 * or gives its place to an undo strip is far simpler without a measuring
 * virtualizer under it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
  RefObject,
} from 'react'

import type { SetlistEntry, SetlistState, Song } from '@shared/types'
import { Badge, Button, ChevronRight, EmptyState, cx } from '../../ui'
import { AlbumThumb, ArtistName, SongTitle } from '../../ui/library'
import { formatDuration } from '../../lib/format'
import { addToSetlist, moveInSetlist, removeFromSetlist, type EditOutcome } from '../../lib/setlist'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { SetlistIcon } from './icons'
import {
  dropPlacement,
  droppedIndex,
  earlier,
  firstOpenGap,
  formatRunTime,
  isLive,
  later,
  ordinal,
  restorePlacement,
  runTime,
  setlistMode,
  standingAt,
  yourLine,
  type MovePlan,
  type SetlistMode,
} from './model'

/** Long enough that a run of transitions is said once, as `ResultAnnouncer` does. */
const ANNOUNCE_MS = 700

/** How long a row the "yours" line jumped to stays lit. A cue, not a state. */
const FLASH_MS = 1_200

/** How long a removal can be undone. */
const UNDO_MS = 8_000

/** How long a refusal to put a song back stays readable. */
const UNDO_FAILED_MS = 5_000

/**
 * A cleared state on screen for less than this wasn't seen: StrictMode's
 * rehearsal unmount, or a panel flicked past on the way to a song.
 */
const SEEN_MS = 1_000

const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

export interface Cleared {
  /** This browser's unplayed songs the wipe took. */
  lost: SetlistEntry[]
  /** When it was seen, which tells one clearing from the next. */
  at: number
}

/** A removal that can still be undone, and where its song goes back to. */
interface Removed {
  entry: SetlistEntry
  /** `restorePlacement`, taken before the entry left. */
  plan: MovePlan
  /** Where it was, for when its neighbour has gone too. */
  index: number
  at: number
}

export function SetlistPanel({
  setlist,
  mine,
  cleared,
  onClearedSeen,
  songsByHash,
  playingHash,
  onOpenSong,
  onFindSong,
  headingRef,
  className,
}: {
  setlist: SetlistState
  mine: ReadonlySet<number>
  cleared: Cleared | null
  /** The cleared state has been on screen and gone again; the plain empty state takes over. */
  onClearedSeen: (at: number) => void
  songsByHash: ReadonlyMap<string, Song>
  /** What the now-playing banner names, so "up now" can tell when it is also playing. */
  playingHash: string | null
  onOpenSong: (song: Song) => void
  /** To the library's search: closing the sheet first where there is one. */
  onFindSong: () => void
  headingRef?: Ref<HTMLHeadingElement>
  className?: string
}) {
  const mode = setlistMode(setlist)
  const editable = setlist.guestEdits === 'on' && isLive(mode)

  const sectionRef = useRef<HTMLElement>(null)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [flash, setFlash] = useState<{ id: number; at: number } | null>(null)
  const [removed, setRemoved] = useState<Removed | null>(null)

  useEffect(() => {
    if (flash === null) return
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  /**
   * Scroll to one of your rows and light it for a moment.
   *
   * `scrollIntoView` moves whatever scrolls the panel — the sheet, or the pane —
   * and nothing else, since the page itself never scrolls. Focus follows, so a
   * keyboard lands where the eye was sent.
   */
  const jumpTo = (id: number) => {
    const row = sectionRef.current?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)
    if (row == null) return
    row.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' })
    row.querySelector<HTMLElement>('[data-row-open]')?.focus({ preventScroll: true })
    setFlash({ id, at: Date.now() })
  }

  const doneWithRemoved = useCallback(
    (at: number) => setRemoved((current) => (current?.at === at ? null : current)),
    [],
  )

  // An undo strip outlives the list it was in: removing your only song empties it.
  const showRows = setlist.entries.length > 0 || removed !== null

  return (
    <section
      ref={sectionRef}
      aria-labelledby="setlist-heading"
      className={cx('flex flex-col', className)}
    >
      <PanelHeader
        setlist={setlist}
        mode={mode}
        mine={mine}
        cleared={cleared !== null}
        headingRef={headingRef}
        onJump={jumpTo}
      />

      {showRows ? (
        <SetlistRows
          setlist={setlist}
          mode={mode}
          mine={mine}
          editable={editable}
          songsByHash={songsByHash}
          playingHash={playingHash}
          flashId={flash?.id ?? null}
          removed={removed}
          onRemoved={setRemoved}
          onRemovedDone={doneWithRemoved}
          onOpenSong={onOpenSong}
          onFindSong={onFindSong}
        />
      ) : (
        <PanelEmpty
          setlist={setlist}
          mode={mode}
          cleared={cleared}
          onClearedSeen={onClearedSeen}
          onFindSong={onFindSong}
        />
      )}
    </section>
  )
}

// --- Header -------------------------------------------------------------------

/**
 * The title, and only the states worth a word.
 *
 * Live is the normal state and goes unlabelled: a `live` badge read as a
 * broadcast. `show` stays, because it changes what the numbers mean. Both ways
 * of not sharing — YARG out of the library, YASS out of touch with YARG — are
 * one thing to a guest, `closed for now`, with one sentence saying when adding
 * opens, because whether they can add right now is the whole of what they need.
 */
function PanelHeader({
  setlist,
  mode,
  mine,
  cleared,
  headingRef,
  onJump,
}: {
  setlist: SetlistState
  mode: SetlistMode
  mine: ReadonlySet<number>
  cleared: boolean
  headingRef?: Ref<HTMLHeadingElement>
  onJump: (id: number) => void
}) {
  const badge =
    mode === 'show' ? (
      <Badge tone="accent">show</Badge>
    ) : !isLive(mode) ? (
      <Badge>closed for now</Badge>
    ) : null

  return (
    <header className="flex flex-col gap-[10px] px-[25px] pt-[5px] pb-[15px] short:px-[15px]">
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[5px]">
        <h2
          id="setlist-heading"
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-[20px] leading-none font-extrabold text-content uppercase focus:outline-none"
        >
          Setlist
        </h2>
        {badge}
        <span className="hidden short:inline">
          <Summary setlist={setlist} mode={mode} />
        </span>
      </div>

      <p className="empty:hidden short:hidden">
        <Summary setlist={setlist} mode={mode} />
      </p>

      {!isLive(mode) && setlist.guestEdits === 'on' ? (
        <p className="max-w-[28rem] text-[15px] leading-[1.35] text-content-muted">
          Adding opens when the host is back at YARG&rsquo;s song list.
        </p>
      ) : null}

      {isLive(mode) ? <YourLine setlist={setlist} mine={mine} onJump={onJump} /> : null}

      {isLive(mode) && setlist.guestEdits === 'off' ? (
        <p className="text-[15px] leading-[1.35] text-content-muted">
          The host has turned off setlist changes for guests.
        </p>
      ) : null}

      <ModeAnnouncer mode={mode} cleared={cleared} />
    </header>
  )
}

/** `12 songs · 51 min`, `Up now 3 of 12 · 38 min to go`, `12 songs · as of 9:42 PM`. */
function Summary({ setlist, mode }: { setlist: SetlistState; mode: SetlistMode }) {
  const count = setlist.totalCount
  const num = (value: string) => <span className="font-bold text-count">{value}</span>
  const words = 'font-numeric text-[15px] tabular-nums text-count-muted'

  if (mode === 'show' && setlist.currentIndex !== null) {
    const left = runTime(setlist, setlist.currentIndex)
    return (
      <span className={words}>
        Up now {num((setlist.currentIndex + 1).toLocaleString())} of {num(count.toLocaleString())}
        {left === null ? null : <> · {num(formatRunTime(left))} to go</>}
      </span>
    )
  }

  const songs = (
    <>
      {num(count.toLocaleString())} {count === 1 ? 'song' : 'songs'}
    </>
  )

  if (mode === 'live') {
    // The empty state below says so in words; `0 songs` above it said it twice.
    if (count === 0) return null
    const total = runTime(setlist)
    return (
      <span className={words}>
        {songs}
        {total === null ? null : <> · {num(formatRunTime(total))}</>}
      </span>
    )
  }

  if (setlist.seenAt === null) return null
  return (
    <span className={words}>
      {songs} · as of {TIME.format(setlist.seenAt)}
    </span>
  )
}

/**
 * Where this browser's songs are, as a button that goes to the next of them.
 *
 * One string from one call on purpose: when limits and fair ordering arrive,
 * the server's policy sentence takes this line over, and swapping one string
 * is trivial. The start-edge bar is the one your rows wear, so the line reads
 * as the key to them.
 */
function YourLine({
  setlist,
  mine,
  onJump,
}: {
  setlist: SetlistState
  mine: ReadonlySet<number>
  onJump: (id: number) => void
}) {
  const line = yourLine(setlist, mine)
  const id = line === null ? null : (setlist.entries[line.index]?.id ?? null)
  if (line === null || id === null) return null

  const text = line.text

  return (
    <button
      type="button"
      onClick={() => onJump(id)}
      className={cx(
        'yarg-focusable group flex cursor-pointer items-center gap-[10px] self-start py-[4px] pr-[4px] pl-[10px] text-left',
        'text-[15px] leading-[1.35] text-white pointer-coarse:min-h-[44px]',
      )}
      style={{ borderLeft: '2px solid var(--accent-edge)' }}
    >
      <span>{text}</span>
      <span
        aria-hidden
        className="rotate-90 text-content-muted transition-colors duration-160 group-hover:text-white"
      >
        <ChevronRight />
      </span>
    </button>
  )
}

/** Says each change of state once, never a change of songs. */
function ModeAnnouncer({ mode, cleared }: { mode: SetlistMode; cleared: boolean }) {
  const [message, setMessage] = useState('')
  const previous = useRef<{ mode: SetlistMode; cleared: boolean }>({ mode, cleared })

  useEffect(() => {
    const was = previous.current
    previous.current = { mode, cleared }
    if (was.mode === mode && was.cleared === cleared) return

    const next =
      cleared && !was.cleared
        ? 'Setlist cleared.'
        : mode === 'show' && was.mode !== 'show'
          ? 'Show started.'
          : mode === 'live' && !isLive(was.mode)
            ? 'Setlist open again.'
            : !isLive(mode) && isLive(was.mode)
              ? 'Setlist closed for now.'
              : null
    if (next === null) return

    const timer = window.setTimeout(() => setMessage(next), ANNOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [mode, cleared])

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  )
}

// --- Empty and cleared ----------------------------------------------------------

function PanelEmpty({
  setlist,
  mode,
  cleared,
  onClearedSeen,
  onFindSong,
}: {
  setlist: SetlistState
  mode: SetlistMode
  cleared: Cleared | null
  onClearedSeen: (at: number) => void
  onFindSong: () => void
}) {
  // The header has already said it's closed and when it opens; there's nothing to add.
  if (!isLive(mode)) return null

  const canAdd = setlist.guestEdits === 'on'

  if (cleared !== null) {
    return (
      <ClearedState
        key={cleared.at}
        cleared={cleared}
        canAdd={canAdd}
        onSeen={onClearedSeen}
        onFindSong={onFindSong}
      />
    )
  }

  return (
    <EmptyState title="Nothing in the setlist yet">
      <p>
        Songs appear here as the host adds them in YARG.
        {canAdd ? ' You can add one too.' : null}
      </p>
      {canAdd ? <FindSongButton onFindSong={onFindSong} className="mt-[15px]" /> : null}
    </EmptyState>
  )
}

/**
 * The moment after a wipe, said once.
 *
 * It stays until it has been on screen and gone again, or until `useSetlist`
 * times it out; after that an empty setlist is just empty. Left up for good it
 * was a headline about the last show over every song anyone added since.
 */
function ClearedState({
  cleared,
  canAdd,
  onSeen,
  onFindSong,
}: {
  cleared: Cleared
  canAdd: boolean
  onSeen: (at: number) => void
  onFindSong: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const { lost, at } = cleared

  const seen = useRef(onSeen)
  seen.current = onSeen
  useEffect(() => {
    const shownAt = performance.now()
    return () => {
      if (performance.now() - shownAt >= SEEN_MS) seen.current(at)
    }
  }, [at])

  const again = async () => {
    setBusy(true)
    const words = await addAgain(lost)
    setBusy(false)
    setResult(words)
  }

  return (
    <EmptyState title="Cleared after the last show">
      {lost.length > 0 && canAdd ? (
        <>
          <p>
            {lost.length === 1 ? '1 of your songs hadn’t' : `${lost.length} of your songs hadn’t`} been
            played.
          </p>
          {result === null ? (
            <Button
              className="mt-[15px]"
              icon={<SetlistIcon />}
              onClick={() => void again()}
              aria-busy={busy}
              disabled={busy}
            >
              add again
            </Button>
          ) : null}
          <p role="status" className="mt-[10px] text-content empty:hidden">
            {result}
          </p>
        </>
      ) : null}
      {canAdd ? (
        <FindSongButton onFindSong={onFindSong} className={lost.length > 0 ? 'mt-[10px]' : ''} />
      ) : null}
    </EmptyState>
  )
}

/**
 * Re-add songs a wipe took, one at a time and in their old order, through the
 * same door as any add. Shared with the toast. Resolves to what to say.
 */
export async function addAgain(lost: readonly SetlistEntry[]): Promise<string> {
  let added = 0
  let refused: { name: string; outcome: EditOutcome } | null = null

  for (const entry of lost) {
    const outcome = await addToSetlist(entry.hash)
    if (outcome.ok) added += 1
    else refused ??= { name: entry.name, outcome }
  }

  return refused === null
    ? `Added ${added}.`
    : `Added ${added}. ${refused.name} wasn't: ${refusalWords(refused.outcome)}`
}

function FindSongButton({ onFindSong, className }: { onFindSong: () => void; className?: string }) {
  return (
    <Button className={className} icon={<SearchGlyph />} onClick={onFindSong}>
      find a song
    </Button>
  )
}

/** A refusal in the action bar's own words, lower-cased to follow a colon. */
function refusalWords(outcome: EditOutcome): string {
  if (outcome.ok) return ''
  switch (outcome.reason) {
    case 'incompatible':
      return "it's missing an instrument someone in this show is playing."
    case 'songNotFound':
      return "the host's game won't play this one."
    case 'full':
      return 'the setlist is full.'
    case 'alreadyInSetlist':
      // Someone else put it back first, which is the outcome the guest wanted.
      return "it's already in the setlist."
    case 'inactive':
      return 'YARG stopped taking songs just then.'
    case 'locked':
      return 'wait for the first song to start, then add.'
    case 'offline':
      return "couldn't reach the server."
    default:
      return 'something went wrong.'
  }
}

// --- The list ---------------------------------------------------------------------

function SetlistRows({
  setlist,
  mode,
  mine,
  editable,
  songsByHash,
  playingHash,
  flashId,
  removed,
  onRemoved,
  onRemovedDone,
  onOpenSong,
  onFindSong,
}: {
  setlist: SetlistState
  mode: SetlistMode
  mine: ReadonlySet<number>
  editable: boolean
  songsByHash: ReadonlyMap<string, Song>
  playingHash: string | null
  flashId: number | null
  removed: Removed | null
  onRemoved: (removed: Removed) => void
  onRemovedDone: (at: number) => void
  onOpenSong: (song: Song) => void
  onFindSong: () => void
}) {
  const stale = !isLive(mode)
  const current = setlist.showInProgress ? setlist.currentIndex : null
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const listRef = useRef<HTMLUListElement>(null)
  const drag = useRowDrag(listRef, setlist)

  /*
   * In a show, open with the up-now row second from the top: one played song
   * above it for context, and everything to come below. Once, on arrival —
   * following the show afterwards would move the list under a reader.
   */
  const anchorRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    anchorRef.current?.scrollIntoView({ block: 'start' })
  }, [])
  const anchorIndex = current === null ? null : Math.max(0, current - 1)

  // A stale snapshot doesn't know whether the up-now song was played, so it draws no bands.
  const banded = current !== null && !stale
  const played = current === null ? 0 : Math.min(current, setlist.entries.length)
  const upcoming = current === null ? 0 : setlist.totalCount - current - 1

  /*
   * No optimistic reordering: the row goes back where it was the moment it is
   * let go, and the setlist YARG sends a few milliseconds later puts it where
   * it actually landed. Somebody else's edit may have landed first, and the
   * list should never show a position YARG didn't agree to.
   */
  const move = async (entry: SetlistEntry, plan: MovePlan, to: number) => {
    if (plan === null || entry.id === null) return
    setBusy(true)
    const outcome = await moveInSetlist(entry.id, plan)
    setBusy(false)
    setStatus(outcome.ok ? `Moved ${entry.name} to ${ordinal(to + 1)}.` : changeRefusal(outcome, false))
  }

  /** Resolves to whether it went, so a swiped row knows to slide back. */
  const remove = async (entry: SetlistEntry, index: number): Promise<boolean> => {
    if (entry.id === null) return false
    const plan = restorePlacement(setlist, index)
    setBusy(true)
    const outcome = await removeFromSetlist(entry.id)
    setBusy(false)
    if (outcome.ok) {
      setStatus('')
      onRemoved({ entry, plan, index, at: Date.now() })
    } else {
      setStatus(changeRefusal(outcome, current !== null && index <= current))
    }
    return outcome.ok
  }

  const undoAt = removed === null ? null : undoIndex(setlist, removed)
  const undoRow =
    removed === null ? null : (
      <UndoRow key={`undo-${removed.at}`} removed={removed} onDone={onRemovedDone} />
    )

  return (
    <>
      <ul ref={listRef} role="list" className="flex flex-col" aria-busy={busy}>
        {setlist.entries.map((entry, index) => {
          const header =
            banded && index === 0 && played > 0 ? (
              <GroupHeader key="played" label="played" count={played} />
            ) : banded && current !== null && index === current + 1 ? (
              <GroupHeader key="next" label="up next" count={upcoming} />
            ) : null

          const song = songsByHash.get(entry.hash) ?? null
          const isMine = entry.id !== null && mine.has(entry.id)
          const changeable = editable && isMine && (current === null || index > current) && !busy

          return [
            undoAt === index ? undoRow : null,
            header,
            <SetlistRow
              key={entry.id ?? entry.hash}
              ref={index === anchorIndex ? anchorRef : undefined}
              setlist={setlist}
              entry={entry}
              index={index}
              song={song}
              stale={stale}
              isMine={isMine}
              playing={playingHash !== null && playingHash === entry.hash}
              flash={flashId !== null && flashId === entry.id}
              dragging={drag.state?.from === index ? drag.state.dy : null}
              dropLine={drag.lineAt(index)}
              handle={
                changeable
                  ? {
                      onPointerDown: (event) =>
                        drag.start(event, index, (gap) =>
                          void move(entry, dropPlacement(setlist, index, gap), droppedIndex(index, gap)),
                        ),
                      onKeyDown: (event) => {
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                        event.preventDefault()
                        const up = event.key === 'ArrowUp'
                        void move(entry, up ? earlier(setlist, index) : later(setlist, index), up ? index - 1 : index + 1)
                      },
                    }
                  : null
              }
              onRemove={changeable ? () => remove(entry, index) : null}
              onOpenSong={onOpenSong}
            />,
          ]
        })}
        {undoAt !== null && undoAt >= setlist.entries.length ? undoRow : null}
      </ul>

      <p role="status" className="sr-only">
        {status}
      </p>
      <p id="setlist-drag-hint" className="sr-only">
        Drag to move it, or use the up and down arrow keys.
      </p>

      {setlist.entries.length < setlist.totalCount ? (
        <p className="py-[15px] pr-[25px] pl-[86px] text-[14px] leading-[1.4] text-content-muted">
          <span className="font-bold text-count">
            {(setlist.totalCount - setlist.entries.length).toLocaleString()}
          </span>{' '}
          more after these. The setlist is too long to show in full.
        </p>
      ) : null}

      {!stale && current !== null && current >= setlist.entries.length ? (
        <p className="pb-[15px] pr-[25px] pl-[86px] text-[14px] leading-[1.4] text-content-muted">
          Up now is song <span className="font-bold text-count">{(current + 1).toLocaleString()}</span>,
          past the end of this list.
        </p>
      ) : null}

      {editable ? <FindSongRow onFindSong={onFindSong} /> : null}
    </>
  )
}

/** The undo strip stands where the song was: after its old neighbour, if that is still here. */
function undoIndex(setlist: SetlistState, removed: Removed): number {
  const { plan } = removed
  if (plan?.position === 'start') return 0
  if (plan?.position === 'after') {
    const anchor = setlist.entries.findIndex((entry) => entry.id === plan.anchorId)
    if (anchor !== -1) return anchor + 1
  }
  return Math.min(removed.index, setlist.entries.length)
}

/** `find a song` as the list's last row, its glyph where the album art stands. */
function FindSongRow({ onFindSong }: { onFindSong: () => void }) {
  return (
    <button
      type="button"
      onClick={onFindSong}
      className={cx(
        'yarg-focusable flex h-[60px] w-full shrink-0 cursor-pointer items-center gap-[15px] pr-[25px] pl-[56px] text-left',
        'text-content-muted transition-[background,color] duration-160 hover:bg-surface-hover hover:text-white',
        'focus-visible:[outline-offset:-3px]',
      )}
      style={{ borderBottom: '1px solid var(--color-border-row)' }}
    >
      <span
        aria-hidden
        className="flex size-[44px] shrink-0 items-center justify-center"
        style={{
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'inset 0 0 0 var(--stroke) var(--color-border-strong)',
        }}
      >
        <SearchGlyph />
      </span>
      <span className="yarg-label text-[13px] text-white">find a song</span>
    </button>
  )
}

/**
 * Where a removed song was, with the way back.
 *
 * Undo puts it back where it stood, not at the end: YARG has no insert-at, so
 * it is an add (which appends) and then a move after its old neighbour. Two
 * round trips, and for one of them the song stands at the end — worth it,
 * because the place in the queue is what a guest waited for, and an undo that
 * sent an accidental swipe to the back of the line would be a second accident.
 * If the move is refused (the neighbour left, the show moved past it) the song
 * stays at the end and the strip says so.
 */
function UndoRow({ removed, onDone }: { removed: Removed; onDone: (at: number) => void }) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [held, setHeld] = useState(false)
  const rowRef = useRef<HTMLLIElement>(null)
  const { entry, plan, at } = removed

  useEffect(() => {
    // The × that had focus went with its row; don't leave a keyboard at the top of the page.
    if (document.activeElement === document.body) {
      rowRef.current?.querySelector('button')?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (held || busy) return
    const timer = window.setTimeout(() => onDone(at), said === null ? UNDO_MS : UNDO_FAILED_MS)
    return () => window.clearTimeout(timer)
  }, [held, busy, said, at, onDone])

  const putBack = async () => {
    setBusy(true)
    const added = await addToSetlist(entry.hash)
    if (!added.ok) {
      setBusy(false)
      setSaid(`Couldn't put it back: ${refusalWords(added)}`)
      return
    }
    const moved = plan === null || (await moveInSetlist(added.entryId, plan)).ok
    setBusy(false)
    if (moved) onDone(at)
    else setSaid(`${entry.name} is back, at the end.`)
  }

  return (
    <li
      ref={rowRef}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="flex h-[60px] items-center gap-[15px] bg-surface-sunken pr-[10px] pl-[56px]"
      style={{ borderBottom: '1px solid var(--color-border-row)' }}
    >
      <p role="status" className="min-w-0 flex-1 truncate text-[15px] text-content-muted">
        {said ?? (
          <>
            Removed{' '}
            <span dir="auto" className="text-content">
              {entry.name}
            </span>
            .
          </>
        )}
      </p>
      {said === null ? (
        <Button onClick={() => void putBack()} aria-busy={busy} disabled={busy}>
          undo
        </Button>
      ) : null}
    </li>
  )
}

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <li
      aria-hidden
      className={cx(
        'yarg-wash-header flex h-[40px] items-end px-[15px] pb-[9px]',
        'font-heading text-[15px] leading-none font-extrabold text-title',
      )}
    >
      <span className="flex items-baseline gap-[14px]">
        <span className="uppercase">{label}</span>
        <span className="flex items-baseline gap-[5px]">
          <span className="font-numeric text-[13px] font-bold tabular-nums text-count">
            {count.toLocaleString()}
          </span>
          <span className="yarg-label text-[11px] tracking-[0.06em] text-content-muted">
            {count === 1 ? 'song' : 'songs'}
          </span>
        </span>
      </span>
    </li>
  )
}

interface Handle {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

function SetlistRow({
  ref,
  setlist,
  entry,
  index,
  song,
  stale,
  isMine,
  playing,
  flash,
  dragging,
  dropLine,
  handle,
  onRemove,
  onOpenSong,
}: {
  ref?: Ref<HTMLLIElement>
  setlist: SetlistState
  entry: SetlistEntry
  index: number
  song: Song | null
  stale: boolean
  isMine: boolean
  playing: boolean
  /** Lit for a moment after the "yours" line jumped here. */
  flash: boolean
  /** How far this row has been dragged, or null when it isn't the one being dragged. */
  dragging: number | null
  /** Where the drop line sits on this row, if it sits on it at all. */
  dropLine: 'above' | 'below' | null
  /** The grip, on this browser's own songs that can still move. */
  handle: Handle | null
  /** Remove, on the same rows as the grip. Resolves to whether it went. */
  onRemove: (() => Promise<boolean>) | null
  onOpenSong: (song: Song) => void
}) {
  const standing = standingAt(setlist, index)
  const upNow = !stale && standing.kind === 'upNow'
  const wasUpNow = stale && standing.kind === 'upNow'
  const played = standing.kind === 'played'
  const dim = stale || played
  const lit = upNow && playing
  const swipe = useRowSwipe(onRemove)

  const badges = (
    <>
      {upNow ? <Badge tone="accent">up now</Badge> : null}
      {wasUpNow ? <Badge>was up now</Badge> : null}
      {song === null ? <Badge>not in library</Badge> : null}
    </>
  )
  const hasBadge = upNow || wasUpNow || song === null

  const spoken = [
    upNow ? (lit ? 'Up now, playing.' : 'Up now.') : null,
    wasUpNow ? 'Was up now.' : null,
    played && !stale ? 'Played.' : null,
    song === null ? 'Not in this library.' : null,
    isMine ? 'Yours.' : null,
  ]
    .filter(Boolean)
    .join(' ')

  const body = (
    <>
      <span className="font-numeric w-[26px] shrink-0 text-right text-[14px] tabular-nums text-count-muted">
        {index + 1}
      </span>
      <span
        className="flex size-[44px] shrink-0 items-center justify-center"
        style={
          song === null
            ? {
                borderRadius: 'var(--radius-sm)',
                background: 'var(--yarg-surface-sunken)',
                boxShadow: 'inset 0 0 0 1px var(--color-border-row)',
              }
            : undefined
        }
      >
        {song !== null ? <AlbumThumb song={song} size={44} className="size-[44px]" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-[4px]">
        <span
          dir="auto"
          className={cx(
            'truncate-tight text-[17px] leading-none transition-colors duration-160 motion-reduce:transition-none',
            dim ? 'font-medium text-content-muted' : 'font-semibold text-white',
          )}
        >
          <SongTitle song={song ?? entry} />
        </span>
        <span
          className={cx(
            'min-w-0 text-[14px] leading-none font-medium italic transition-colors duration-160 motion-reduce:transition-none',
            dim ? 'text-content-faint' : 'text-content-secondary',
          )}
        >
          <ArtistName song={song ?? { artist: entry.artist, isMaster: true }} credit="label" />
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-[8px]">
        {badges}
        {hasBadge ? null : (
          <span className="font-numeric text-[14px] tabular-nums text-count-muted">
            <span className="sr-only">Length </span>
            {formatDuration(entry.lengthSeconds)}
          </span>
        )}
      </span>
    </>
  )

  /*
   * Yours wears an accent bar on its start edge rather than a `yours` badge, so
   * the row keeps its length and the "yours" line has something to point at.
   * Accent only while it is live and to come; a played or stale one of yours
   * keeps the bar in the control grey, the way the rest of the row goes muted.
   */
  const startEdge = lit
    ? '#fff'
    : isMine
      ? dim
        ? 'var(--color-border-strong)'
        : 'var(--accent-edge)'
      : 'transparent'

  const rowClass = cx(
    'flex h-[60px] w-full min-w-0 items-center gap-[15px] pl-[15px] text-left',
    handle !== null ? 'pr-[10px]' : 'pr-[25px]',
    upNow ? 'yarg-wash-selected [--yarg-wash-angle:270deg]' : 'bg-surface-card',
  )
  const rowStyle = {
    borderTop: lit ? '3px solid #fff' : '1px solid var(--color-border-row)',
    borderBottom: lit ? '3px solid #fff' : '1px solid var(--color-border-row)',
    borderLeft: `2px solid ${startEdge}`,
    borderRight: `2px solid ${lit ? '#fff' : 'transparent'}`,
    // Colour only, and it fades back on the row's own background transition.
    ...(flash ? { background: 'var(--accent-tint)' } : {}),
  }

  return (
    <li
      ref={ref}
      data-setlist-row={index}
      data-entry-id={entry.id ?? undefined}
      aria-setsize={setlist.totalCount}
      aria-posinset={index + 1}
      className="relative"
      style={
        dragging !== null
          ? {
              // Lit, not lifted: the row under the finger takes the accent
              // stroke rather than a shadow, and moves only because the finger does.
              transform: `translateY(${dragging}px)`,
              zIndex: 10,
              boxShadow: 'inset 0 0 0 var(--stroke) var(--accent-edge)',
            }
          : undefined
      }
    >
      {dropLine !== null ? (
        <span
          aria-hidden
          className={cx(
            'pointer-events-none absolute inset-x-0 z-20 h-[3px] bg-accent',
            dropLine === 'above' ? '-top-[2px]' : '-bottom-[1px]',
          )}
        />
      ) : null}

      {swipe.phase !== 'rest' ? (
        <span
          aria-hidden
          className="yarg-label absolute inset-0 flex items-center justify-end pr-[25px] text-[13px] text-white"
          style={{ background: 'color-mix(in srgb, var(--yarg-imperial-red) 75%, transparent)' }}
        >
          remove
        </span>
      ) : null}

      <div
        {...swipe.handlers}
        className={cx(
          'relative flex items-stretch',
          // A mouse swipe would otherwise select the title it drags across.
          onRemove !== null && 'touch-pan-y select-none',
          swipe.phase !== 'drag' &&
            'transition-transform duration-160 ease-[var(--ease-standard)] motion-reduce:transition-none',
        )}
        style={swipe.offset === 0 ? undefined : { transform: `translateX(${swipe.offset}px)` }}
      >
        {song !== null ? (
          <button
            type="button"
            data-row-open
            onClick={() => onOpenSong(song)}
            className={cx(
              rowClass,
              'yarg-focusable cursor-pointer transition-[background] duration-160 focus-visible:[outline-offset:-3px]',
              !upNow && 'hover:bg-surface-hover',
            )}
            style={rowStyle}
          >
            {spoken ? <span className="sr-only">{spoken} </span> : null}
            {body}
          </button>
        ) : (
          <div className={cx(rowClass, 'transition-[background] duration-160')} style={rowStyle}>
            {spoken ? <span className="sr-only">{spoken} </span> : null}
            {body}
          </div>
        )}

        {/*
         * Remove for a mouse and a keyboard, beside the grip. On a touch screen
         * the row swipes away instead and this steps out of sight, kept for a
         * screen reader: 88px of controls on a 390px row would leave the title
         * a word. No confirm, because the undo strip that takes the row's place
         * is the safety.
         */}
        {onRemove !== null ? (
          <button
            type="button"
            data-no-swipe
            onClick={() => void onRemove()}
            aria-label={`Remove ${entry.name}`}
            className={cx(
              'yarg-focusable flex w-[44px] shrink-0 cursor-pointer items-center justify-center bg-surface-card',
              'text-content-muted transition-colors duration-160 hover:text-white',
              'pointer-coarse:sr-only',
            )}
            style={{ borderBottom: '1px solid var(--color-border-row)' }}
          >
            <CrossGlyph />
          </button>
        ) : null}

        {handle !== null ? (
          <button
            type="button"
            data-no-swipe
            onPointerDown={handle.onPointerDown}
            onKeyDown={handle.onKeyDown}
            aria-label={`Move ${entry.name}`}
            aria-describedby="setlist-drag-hint"
            className={cx(
              'yarg-focusable flex w-[44px] shrink-0 cursor-grab touch-none items-center justify-center bg-surface-card',
              'transition-colors duration-160 select-none hover:text-white active:cursor-grabbing',
              dragging !== null ? 'text-white' : 'text-content-muted',
            )}
            style={{ borderBottom: '1px solid var(--color-border-row)' }}
          >
            <GripIcon />
          </button>
        ) : null}
      </div>
    </li>
  )
}

/** How far a pointer travels before a row decides between swipe, scroll and tap. */
const SWIPE_SLOP = 10

/** How much of the row's width a swipe has to cross for letting go to remove it. */
const SWIPE_COMMIT = 0.4

/** How long a row takes to slide back, after which the red behind it can go. */
const SWIPE_SETTLE_MS = 200

type SwipePhase = 'rest' | 'drag' | 'back' | 'out'

/**
 * Swipe left to remove, as Apple Music's and Spotify's queues do.
 *
 * It has to share the row with three other gestures, and each is settled by
 * where the pointer went first:
 *
 * - **Scrolling.** The row is `touch-action: pan-y`, so a vertical move stays
 *   the browser's and arrives here as `pointercancel`; a move that is more
 *   vertical than horizontal before the slop is crossed is dropped too.
 * - **Reordering.** The grip is `touch-action: none` and marked
 *   `data-no-swipe`; a gesture that starts on it never starts here.
 * - **Tapping.** Nothing is captured until the pointer has gone `SWIPE_SLOP`
 *   to the left and well more sideways than up or down, so a tap is still a
 *   click on the row. Once a swipe has started, the click its release would
 *   make is swallowed.
 *
 * The row follows the finger exactly while it is down — direct manipulation,
 * the one movement the motion rules allow, because the finger is doing it. What
 * happens after release (sliding back, sliding out) is a short transition that
 * reduced motion turns off. A row that slides out stays out until the setlist
 * YARG sends drops it, and slides back if the remove is refused.
 */
function useRowSwipe(onCommit: (() => Promise<boolean>) | null) {
  const [offset, setOffset] = useState(0)
  const [phase, setPhase] = useState<SwipePhase>('rest')
  const gesture = useRef<{
    pointer: number
    x: number
    y: number
    width: number
    swiping: boolean
    dx: number
  } | null>(null)
  const swallowClick = useRef(false)

  useEffect(() => {
    if (phase !== 'back') return
    const timer = window.setTimeout(() => setPhase('rest'), SWIPE_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  const settle = () => {
    setOffset(0)
    setPhase('back')
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    swallowClick.current = false
    if (onCommit === null || phase === 'out' || event.button !== 0) return
    if ((event.target as Element).closest('[data-no-swipe]') !== null) return
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: event.currentTarget.offsetWidth,
      swiping: false,
      dx: 0,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const live = gesture.current
    if (live === null || live.pointer !== event.pointerId) return
    const dx = event.clientX - live.x
    const dy = event.clientY - live.y

    if (!live.swiping) {
      if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) >= Math.abs(dx)) {
        gesture.current = null
        return
      }
      if (dx > -SWIPE_SLOP || Math.abs(dx) < Math.abs(dy) * 1.5) return
      live.swiping = true
      swallowClick.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setPhase('drag')
    }

    live.dx = Math.min(0, dx)
    setOffset(live.dx)
  }

  const end = (event: ReactPointerEvent<HTMLElement>, letGo: boolean) => {
    const live = gesture.current
    if (live === null || live.pointer !== event.pointerId) return
    gesture.current = null
    if (!live.swiping) return

    if (letGo && onCommit !== null && -live.dx >= live.width * SWIPE_COMMIT) {
      setPhase('out')
      setOffset(-live.width)
      void onCommit().then((went) => {
        if (!went) settle()
      })
    } else {
      settle()
    }
  }

  const onClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return
    swallowClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return {
    offset,
    phase,
    handlers:
      onCommit === null && phase === 'rest'
        ? {}
        : {
            onPointerDown,
            onPointerMove,
            onPointerUp: (event: ReactPointerEvent<HTMLElement>) => end(event, true),
            onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => end(event, false),
            onClickCapture,
          },
  }
}

/**
 * Dragging a row by its grip.
 *
 * Pointer events with capture rather than HTML drag-and-drop, which touch
 * browsers don't deliver from a finger, and rather than a library, which this
 * app has so far had no need of. The grip is `touch-action: none`, so a drag
 * on it never scrolls the list; the list scrolls itself instead when the
 * finger nears the top or bottom of whatever is scrolling it — the sheet, or
 * the pane.
 *
 * Gaps are numbered as `dropPlacement` numbers them, so the line drawn here and
 * the move sent on release can't disagree.
 */
function useRowDrag(listRef: RefObject<HTMLUListElement | null>, setlist: SetlistState) {
  const [state, setState] = useState<{ from: number; gap: number; dy: number } | null>(null)
  const session = useRef<{
    from: number
    startY: number
    startScroll: number
    lastY: number
    /** Where it would land if let go now. */
    gap: number
    scroller: HTMLElement | null
    timer: number
    onDrop: (gap: number) => void
  } | null>(null)

  const update = () => {
    const live = session.current
    const list = listRef.current
    if (live === null || list === null) return

    let above = 0
    for (const row of list.querySelectorAll<HTMLElement>('[data-setlist-row]')) {
      if (Number(row.dataset.setlistRow) === live.from) continue
      const box = row.getBoundingClientRect()
      if (box.top + box.height / 2 < live.lastY) above += 1
    }

    // `above` counts rows other than the dragged one, so past it the gap is one further on.
    const gap = Math.min(
      setlist.entries.length,
      Math.max(firstOpenGap(setlist), above <= live.from ? above : above + 1),
    )
    const scrolled = (live.scroller?.scrollTop ?? 0) - live.startScroll
    live.gap = gap
    setState({ from: live.from, gap, dy: live.lastY - live.startY + scrolled })
  }

  const end = (drop: boolean) => {
    const live = session.current
    if (live === null) return
    window.clearInterval(live.timer)
    session.current = null
    setState(null)
    if (drop) live.onDrop(live.gap)
  }

  const start = (
    event: ReactPointerEvent<HTMLElement>,
    from: number,
    onDrop: (gap: number) => void,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()

    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const scroller = scrollParent(handle)

    session.current = {
      from,
      startY: event.clientY,
      startScroll: scroller?.scrollTop ?? 0,
      lastY: event.clientY,
      gap: from,
      scroller,
      onDrop,
      // Held still near an edge, the list keeps scrolling; nothing else would
      // fire to move it.
      timer: window.setInterval(() => {
        const live = session.current
        if (live?.scroller == null) return
        const box = live.scroller.getBoundingClientRect()
        const step =
          live.lastY < box.top + EDGE ? -SCROLL_STEP : live.lastY > box.bottom - EDGE ? SCROLL_STEP : 0
        if (step === 0) return
        live.scroller.scrollTop += step
        update()
      }, 16),
    }
    setState({ from, gap: from, dy: 0 })

    const move = (next: PointerEvent) => {
      if (session.current === null) return
      session.current.lastY = next.clientY
      update()
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const finish = (drop: boolean) => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', cancel)
      end(drop)
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', cancel)
  }

  /** The line goes above the row whose gap it is, or below the last row for the end. */
  const lineAt = (index: number): 'above' | 'below' | null => {
    if (state === null || dropPlacement(setlist, state.from, state.gap) === null) return null
    if (state.gap === index) return 'above'
    if (state.gap === setlist.entries.length && index === setlist.entries.length - 1) return 'below'
    return null
  }

  return { state, start, lineAt }
}

/** How near an edge the finger has to be before the list scrolls under it. */
const EDGE = 56
const SCROLL_STEP = 8

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
      <circle cx="2" cy="2" r="1.6" />
      <circle cx="8" cy="2" r="1.6" />
      <circle cx="2" cy="8" r="1.6" />
      <circle cx="8" cy="8" r="1.6" />
      <circle cx="2" cy="14" r="1.6" />
      <circle cx="8" cy="14" r="1.6" />
    </svg>
  )
}

function changeRefusal(outcome: EditOutcome, played: boolean): string {
  if (outcome.ok) return ''
  switch (outcome.reason) {
    case 'inactive':
      return 'You can change your songs while the host is picking songs in YARG, or during a show.'
    case 'entryNotFound':
      return "It's not in the setlist any more."
    case 'locked':
      return played
        ? "It's already been played."
        : 'Wait for the first song to start, then try again.'
    case 'editsOff':
      return 'The host has turned off setlist changes for guests.'
    case 'unavailable':
      return "The setlist isn't available right now."
    case 'connectionLost':
      return 'Lost the connection. Checking…'
    default:
      return "Couldn't reach the server. Try again."
  }
}

/** Drawn at the weight of the sheet's own close mark. */
function CrossGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

/** The search field's own glyph. */
function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
