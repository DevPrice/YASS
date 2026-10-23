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
 *
 * **Up now is not playing.** YARG moves the show's position when a song is
 * started, before Difficulty Select, so for a moment the setlist and the
 * now-playing banner can name different songs. The row claims "up now", and
 * wears the playing row's white borders only once the banner agrees.
 *
 * A plain list rather than a virtualized one, unlike the library. Remote adds
 * stop at 500 songs and YARG sends at most about 800, which is a few hundred
 * rows rendered once per setlist change — and an inline change strip that
 * grows its row is far simpler without a measuring virtualizer under it.
 */

import { useEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
  RefObject,
} from 'react'

import type { SetlistEntry, SetlistState, Song } from '@shared/types'
import { Badge, Button, EmptyState, cx } from '../../ui'
import { AlbumThumb, ArtistName, SongTitle } from '../../ui/library'
import { formatDuration } from '../../lib/format'
import { addToSetlist, moveInSetlist, removeFromSetlist, type EditOutcome } from '../../lib/setlist'
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
  runTime,
  setlistMode,
  standingAt,
  type MovePlan,
  type SetlistMode,
} from './model'

/** Long enough that a run of transitions is said once, as `ResultAnnouncer` does. */
const ANNOUNCE_MS = 700

const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

export interface Cleared {
  /** This browser's unplayed songs the wipe took. */
  lost: SetlistEntry[]
  /** When it was seen, which tells one clearing from the next. */
  at: number
}

export function SetlistPanel({
  setlist,
  mine,
  cleared,
  songsByHash,
  playingHash,
  onOpenSong,
  headingRef,
  className,
}: {
  setlist: SetlistState
  mine: ReadonlySet<number>
  cleared: Cleared | null
  songsByHash: ReadonlyMap<string, Song>
  /** What the now-playing banner names, so "up now" can tell when it is also playing. */
  playingHash: string | null
  onOpenSong: (song: Song) => void
  headingRef?: Ref<HTMLHeadingElement>
  className?: string
}) {
  const mode = setlistMode(setlist)
  const editable = setlist.guestEdits === 'on' && isLive(mode)

  return (
    <section aria-labelledby="setlist-heading" className={cx('flex flex-col', className)}>
      <PanelHeader
        setlist={setlist}
        mode={mode}
        mine={mine}
        cleared={cleared !== null}
        headingRef={headingRef}
      />

      {setlist.entries.length === 0 ? (
        <PanelEmpty setlist={setlist} mode={mode} cleared={cleared} />
      ) : (
        <SetlistRows
          setlist={setlist}
          mode={mode}
          mine={mine}
          editable={editable}
          songsByHash={songsByHash}
          playingHash={playingHash}
          onOpenSong={onOpenSong}
        />
      )}
    </section>
  )
}

// --- Header -------------------------------------------------------------------

function PanelHeader({
  setlist,
  mode,
  mine,
  cleared,
  headingRef,
}: {
  setlist: SetlistState
  mode: SetlistMode
  mine: ReadonlySet<number>
  cleared: boolean
  headingRef?: Ref<HTMLHeadingElement>
}) {
  const badge =
    mode === 'live' ? (
      <Badge tone="accent">live</Badge>
    ) : mode === 'show' ? (
      <Badge tone="accent">show</Badge>
    ) : mode === 'outOfView' ? (
      <Badge>out of view</Badge>
    ) : (
      <Badge>not available</Badge>
    )

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

      <p className="short:hidden">
        <Summary setlist={setlist} mode={mode} />
      </p>

      {mode === 'outOfView' ? (
        <p className="max-w-[28rem] text-[15px] leading-[1.35] text-content-muted">
          YARG shares the setlist while the host is picking songs, or during a show.
        </p>
      ) : mode === 'unavailable' ? (
        <p className="max-w-[28rem] text-[15px] leading-[1.35] text-content-muted">
          The setlist isn&rsquo;t available right now.
        </p>
      ) : null}

      {isLive(mode) ? <YourLine setlist={setlist} mine={mine} /> : null}

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
    const total = runTime(setlist)
    return (
      <span className={words}>
        {songs}
        {total === null || count === 0 ? null : <> · {num(formatRunTime(total))}</>}
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
 * Where this browser's songs are.
 *
 * One element on purpose: when limits and fair ordering arrive, the server's
 * policy sentence takes this line over, and swapping one line is trivial.
 */
function YourLine({ setlist, mine }: { setlist: SetlistState; mine: ReadonlySet<number> }) {
  const upcoming: number[] = []
  setlist.entries.forEach((entry, index) => {
    if (entry.id === null || !mine.has(entry.id)) return
    const standing = standingAt(setlist, index)
    if (standing.kind !== 'played') upcoming.push(index)
  })

  const next = upcoming[0]
  if (next === undefined) return null

  const standing = standingAt(setlist, next)
  const where =
    standing.kind === 'upNow'
      ? 'up now'
      : standing.kind === 'upNext'
        ? 'up next'
        : standing.kind === 'later'
          ? `up in ${standing.songs} songs`
          : ordinal(next + 1)

  const text =
    upcoming.length === 1
      ? `Yours is ${where}.`
      : setlist.showInProgress
        ? `${upcoming.length} of yours to come · the next is ${where}.`
        : `${upcoming.length} of yours · the next is ${where}.`

  return (
    <p className="flex items-center gap-[10px] text-[15px] leading-[1.35] text-white">
      <Badge>yours</Badge>
      <span>{text}</span>
    </p>
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
            ? 'Setlist live again.'
            : mode === 'outOfView'
              ? 'Setlist out of view.'
              : mode === 'unavailable'
                ? 'Setlist not available right now.'
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
}: {
  setlist: SetlistState
  mode: SetlistMode
  cleared: Cleared | null
}) {
  if (cleared !== null && isLive(mode)) {
    return <ClearedState lost={cleared.lost} canAdd={setlist.guestEdits === 'on'} />
  }

  if (!isLive(mode)) {
    return (
      <EmptyState title="Setlist out of view">
        YARG shares it while the host is picking songs, or during a show.
      </EmptyState>
    )
  }

  return (
    <EmptyState title="Nothing in the setlist yet">
      <p>Songs appear here as the host adds them in YARG.</p>
      {setlist.guestEdits === 'on' ? (
        <p className="mt-[10px]">You can add one too: open a song and tap Add to setlist.</p>
      ) : null}
    </EmptyState>
  )
}

function ClearedState({ lost, canAdd }: { lost: SetlistEntry[]; canAdd: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const addAgain = async () => {
    setBusy(true)
    let added = 0
    let refused: { name: string; outcome: EditOutcome } | null = null

    // One at a time and in their old order, through the same door as any add.
    for (const entry of lost) {
      const outcome = await addToSetlist(entry.hash)
      if (outcome.ok) added += 1
      else refused ??= { name: entry.name, outcome }
    }

    setBusy(false)
    setResult(
      refused === null
        ? `Added ${added}.`
        : `Added ${added}. ${refused.name} wasn't: ${refusalWords(refused.outcome)}`,
    )
  }

  return (
    <EmptyState title="Setlist cleared">
      <p>YARG clears it after a show, or when a single song is played.</p>
      {lost.length > 0 && canAdd ? (
        <>
          <p className="mt-[10px]">
            {lost.length === 1 ? '1 of your songs hadn’t' : `${lost.length} of your songs hadn’t`} been
            played.
          </p>
          {result === null ? (
            <Button
              className="mt-[15px]"
              icon={<SetlistIcon />}
              onClick={() => void addAgain()}
              aria-busy={busy}
              disabled={busy}
            >
              add them again
            </Button>
          ) : null}
          <p role="status" className="mt-[10px] text-content">
            {result}
          </p>
        </>
      ) : null}
    </EmptyState>
  )
}

/** A refusal in the action bar's own words, lower-cased to follow a colon. */
function refusalWords(outcome: EditOutcome): string {
  if (outcome.ok) return ''
  switch (outcome.reason) {
    case 'incompatible':
      return "this song has no part for someone who's playing right now."
    case 'songNotFound':
      return "YARG couldn't find it."
    case 'full':
      return 'the setlist is full.'
    case 'inactive':
      return 'YARG stopped taking songs just then.'
    case 'locked':
      return "everyone's picking their parts. Try again once the show starts."
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
  onOpenSong,
}: {
  setlist: SetlistState
  mode: SetlistMode
  mine: ReadonlySet<number>
  editable: boolean
  songsByHash: ReadonlyMap<string, Song>
  playingHash: string | null
  onOpenSong: (song: Song) => void
}) {
  const stale = !isLive(mode)
  const current = setlist.showInProgress ? setlist.currentIndex : null
  const [open, setOpen] = useState<number | null>(null)
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

  const remove = async (entry: SetlistEntry, index: number) => {
    if (entry.id === null) return
    setBusy(true)
    const outcome = await removeFromSetlist(entry.id)
    setBusy(false)
    setOpen(null)
    setStatus(outcome.ok ? `Removed ${entry.name}.` : changeRefusal(outcome, current !== null && index <= current))
  }

  return (
    <>
      <ul ref={listRef} role="list" className="flex flex-col" aria-busy={busy}>
        {setlist.entries.map((entry, index) => {
          const header =
            current !== null && index === 0 && played > 0 ? (
              <GroupHeader key="played" label="played" count={played} />
            ) : current !== null && index === current + 1 ? (
              <GroupHeader key="next" label="up next" count={upcoming} />
            ) : null

          const song = songsByHash.get(entry.hash) ?? null
          const isMine = entry.id !== null && mine.has(entry.id)
          const changeable = editable && isMine && (current === null || index > current)

          return [
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
              dragging={drag.state?.from === index ? drag.state.dy : null}
              dropLine={drag.lineAt(index)}
              handle={
                changeable && !busy
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
              changeOpen={open === entry.id}
              onToggleChange={changeable ? () => setOpen(open === entry.id ? null : entry.id) : null}
              onRemove={() => void remove(entry, index)}
              onOpenSong={onOpenSong}
            />,
          ]
        })}
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

      {current !== null && current >= setlist.entries.length ? (
        <p className="pb-[15px] pr-[25px] pl-[86px] text-[14px] leading-[1.4] text-content-muted">
          Up now is song <span className="font-bold text-count">{(current + 1).toLocaleString()}</span>,
          past the end of this list.
        </p>
      ) : null}
    </>
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
  dragging,
  dropLine,
  handle,
  changeOpen,
  onToggleChange,
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
  /** How far this row has been dragged, or null when it isn't the one being dragged. */
  dragging: number | null
  /** Where the drop line sits on this row, if it sits on it at all. */
  dropLine: 'above' | 'below' | null
  /** The grip, on this browser's own songs that can still move. */
  handle: Handle | null
  changeOpen: boolean
  onToggleChange: (() => void) | null
  onRemove: () => void
  onOpenSong: (song: Song) => void
}) {
  const standing = standingAt(setlist, index)
  const upNow = !stale && standing.kind === 'upNow'
  const played = standing.kind === 'played'
  const dim = stale || played
  const lit = upNow && playing

  // The grip says "yours" on its own, and a phone row can't hold both and a title.
  const yoursBadge = isMine && !stale && handle === null

  const badges = (
    <>
      {upNow ? <Badge tone="accent">up now</Badge> : null}
      {song === null ? <Badge>not in library</Badge> : null}
      {yoursBadge ? <Badge>yours</Badge> : null}
    </>
  )
  const hasBadge = upNow || song === null || yoursBadge

  const spoken = [
    upNow ? (lit ? 'Up now, playing.' : 'Up now.') : null,
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

  const rowClass = cx(
    'flex h-[60px] w-full min-w-0 items-center gap-[15px] pl-[15px] text-left',
    handle !== null || onToggleChange !== null ? 'pr-[10px]' : 'pr-[25px]',
    upNow ? 'yarg-wash-selected [--yarg-wash-angle:270deg]' : 'bg-surface-card',
  )
  const rowStyle = {
    borderTop: lit ? '3px solid #fff' : '1px solid var(--color-border-row)',
    borderBottom: lit ? '3px solid #fff' : '1px solid var(--color-border-row)',
    borderLeft: `2px solid ${lit ? '#fff' : 'transparent'}`,
    borderRight: `2px solid ${lit ? '#fff' : 'transparent'}`,
  }

  return (
    <li
      ref={ref}
      data-setlist-row={index}
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
      <div className="flex items-stretch">
        {song !== null ? (
          <button
            type="button"
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
          <div className={rowClass} style={rowStyle}>
            {spoken ? <span className="sr-only">{spoken} </span> : null}
            {body}
          </div>
        )}

        {handle !== null ? (
          <button
            type="button"
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

        {onToggleChange !== null ? (
          <button
            type="button"
            onClick={onToggleChange}
            aria-expanded={changeOpen}
            aria-label={`More for ${entry.name}`}
            className={cx(
              'yarg-focusable flex w-[44px] shrink-0 cursor-pointer items-center justify-center bg-surface-card',
              'transition-colors duration-160 hover:text-white',
              changeOpen ? 'text-white' : 'text-content-muted',
            )}
            style={{ borderBottom: '1px solid var(--color-border-row)' }}
          >
            <MoreIcon />
          </button>
        ) : null}
      </div>

      {/*
       * Remove, behind a second tap. Moving is a drag on the grip; taking a song
       * out of the queue is the one change worth not doing by accident while
       * scrolling in a loud room.
       */}
      {changeOpen ? (
        <div className="flex items-center justify-end bg-surface-sunken py-[10px] pr-[25px]">
          <Button onClick={onRemove}>remove from setlist</Button>
        </div>
      ) : null}
    </li>
  )
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
        : "Hold on a moment. Everyone's picking their parts."
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

function MoreIcon() {
  return (
    <svg width="16" height="4" viewBox="0 0 16 4" fill="currentColor" aria-hidden>
      <circle cx="2" cy="2" r="1.75" />
      <circle cx="8" cy="2" r="1.75" />
      <circle cx="14" cy="2" r="1.75" />
    </svg>
  )
}
