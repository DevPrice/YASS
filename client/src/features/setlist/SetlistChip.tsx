/**
 * The banner's trailing chip: the setlist's only way in.
 *
 * In the banner because the banner is where YARG's live state already is — the
 * game's present is the song playing, and its next few are the setlist. In the
 * banner's *existing* row because the banner never changes height: the setlist
 * goes out of view every time the host opens Difficulty Select, and a strip
 * that came and went with it would shove the list under somebody's thumb.
 *
 * A chip in a chip's two states, and here they mean live: tinted while YARG is
 * sharing the setlist, the plain stroke while it isn't.
 *
 * **One face in every state.** The setlist icon in every state, so the only way
 * in never looks like two different controls (it used to become YARG's show
 * icon, which reads as a globe). After it, a word and a number, saying the one
 * thing worth opening the setlist for:
 *
 * - `setlist 12` — how many songs, outside a show, or as last seen while out
 *   of view.
 * - `3 next` — what is left to come in a show. Not `4/12`, which beside the
 *   now-playing title read as a track counter or a page indicator.
 * - `yours 4` — where this browser's next song stands. That is the number a
 *   guest opens the chip to find, so once they have one it wins over the count.
 * - `setlist –` — nothing honest to say.
 *
 * The word `setlist` is there on every width when the number is a bare count,
 * so the chip never comes down to an icon and a figure. Beside `next` and
 * `yours` it goes below `sm`: with it, the widest chip was 158px of a 390px
 * banner and left the song title four characters. The icon and the accessible
 * name still say setlist there.
 *
 * **What `yours 4` counts** is the same thing the chip counts without it, so the
 * two read as one scale: outside a show, the place in the setlist (the row's
 * number in the panel); in a show, the place among the songs still to come,
 * with up next as 1 and the up-now song not counted — the songs ahead of yours,
 * excluding the one on now, plus one.
 *
 * A song of yours that is up now is not to come: it has arrived, the panel
 * marks it, and once it plays the banner is about it. A `yours up now` chip
 * also sat at 143px for the whole song, so the chip moves on to your next one,
 * or to the count.
 *
 * A stale setlist never claims a position (Stale-Not-Gone): out of view, the
 * chip shows the last count and nothing about yours.
 */

import type { ReactNode } from 'react'

import type { SetlistState } from '@shared/types'
import { cx } from '../../ui'
import { isLive, ordinal, setlistMode } from './model'
import { SetlistIcon } from './icons'

export function SetlistChip({
  setlist,
  mine,
  onOpen,
  opensDialog,
}: {
  setlist: SetlistState
  /** This browser's entry IDs. */
  mine: ReadonlySet<number>
  onOpen: () => void
  /** True where the panel arrives as a sheet, so the button says it opens a dialog. */
  opensDialog: boolean
}) {
  const mode = setlistMode(setlist)
  if (mode === 'absent') return null

  const lit = isLive(mode)
  const { value, qualified, spoken } = chipValue(setlist, mine)

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Setlist${spoken}. Open setlist.`}
      aria-haspopup={opensDialog ? 'dialog' : undefined}
      className={cx(
        'yarg-focusable relative flex h-[36px] shrink-0 cursor-pointer items-center gap-[7px] pr-[14px] pl-[10px]',
        'pointer-coarse:h-[44px]',
        'transition-[filter,color] duration-160 hover:brightness-115',
        lit ? 'text-white' : 'text-content-faint',
      )}
      style={{
        borderRadius: 'var(--radius-pill)',
        background: lit ? 'var(--accent-tint)' : 'transparent',
        boxShadow: `inset 0 0 0 var(--stroke) ${lit ? 'var(--accent-edge)' : 'var(--color-border-strong)'}`,
      }}
    >
      <SetlistIcon size={22} />
      {word('setlist', qualified ? 'hidden sm:inline' : undefined)}
      {qualified ? word('·', 'hidden sm:inline') : null}
      <span className="flex items-baseline gap-[5px] whitespace-nowrap">{value}</span>
    </button>
  )
}

interface ChipValue {
  value: ReactNode
  /** The value brings its own word, so `setlist` may give way to it. */
  qualified: boolean
  /** Follows "Setlist" in the accessible name, punctuation and all. */
  spoken: string
}

function word(text: string, className?: string) {
  return <span className={cx('yarg-label text-[11px]', className)}>{text}</span>
}

function figure(text: string) {
  return <span className="font-numeric text-[15px] font-bold tabular-nums">{text}</span>
}

function chipValue(setlist: SetlistState, mine: ReadonlySet<number>): ChipValue {
  const mode = setlistMode(setlist)
  const count = setlist.totalCount
  const songs = `${count.toLocaleString()} ${count === 1 ? 'song' : 'songs'}`

  if (mode === 'unavailable') {
    return { value: figure('–'), qualified: false, spoken: ' not available right now' }
  }
  if (mode === 'outOfView') {
    return setlist.seenAt === null
      ? { value: figure('–'), qualified: false, spoken: ' out of view' }
      : {
          value: figure(count.toLocaleString()),
          qualified: false,
          spoken: ` out of view, last seen with ${songs}`,
        }
  }

  const current = setlist.showInProgress ? setlist.currentIndex : null
  const yours = nextOfYours(setlist, mine, current)

  if (yours !== null) {
    return {
      value: (
        <>
          {word('yours')}
          {figure(yours.toLocaleString())}
        </>
      ),
      qualified: true,
      spoken:
        current === null
          ? `, yours is ${ordinal(yours)}`
          : yours === 1
            ? ', yours is up next'
            : `, yours is ${ordinal(yours)} in line`,
    }
  }

  if (current !== null) {
    const left = Math.max(0, count - current - 1)
    return {
      value: (
        <>
          {figure(left.toLocaleString())}
          {word('next')}
        </>
      ),
      qualified: true,
      spoken: `, ${left === 0 ? 'nothing' : left === 1 ? '1 song' : `${left.toLocaleString()} songs`} up next`,
    }
  }

  return { value: figure(count.toLocaleString()), qualified: false, spoken: `, ${songs}` }
}

/**
 * The place in line, as the file comment defines it, of this browser's first
 * song still to come, or null. Only entries the wire carried can be found, so
 * one past a truncated tail goes unsaid, as it does in the panel.
 */
function nextOfYours(
  setlist: SetlistState,
  mine: ReadonlySet<number>,
  current: number | null,
): number | null {
  const from = current === null ? 0 : current + 1
  const index = setlist.entries.findIndex(
    (entry, i) => i >= from && entry.id !== null && mine.has(entry.id),
  )
  if (index === -1) return null
  return current === null ? index + 1 : index - current
}
