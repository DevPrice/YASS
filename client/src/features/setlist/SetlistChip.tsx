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
 */

import type { SetlistState } from '@shared/types'
import { cx } from '../../ui'
import { isLive, setlistMode } from './model'
import { SetlistIcon, ShowIcon } from './icons'

export function SetlistChip({
  setlist,
  onOpen,
  opensDialog,
}: {
  setlist: SetlistState
  onOpen: () => void
  /** True where the panel arrives as a sheet, so the button says it opens a dialog. */
  opensDialog: boolean
}) {
  const mode = setlistMode(setlist)
  if (mode === 'absent') return null

  const lit = isLive(mode)
  const count = setlist.totalCount
  const known = setlist.seenAt !== null

  const number =
    mode === 'show' && setlist.currentIndex !== null
      ? `${setlist.currentIndex + 1}/${count}`
      : mode === 'unavailable' || !known
        ? '–'
        : count.toLocaleString()

  const songs = `${count.toLocaleString()} ${count === 1 ? 'song' : 'songs'}`
  const label =
    mode === 'live'
      ? `Setlist, ${songs}. Open setlist.`
      : mode === 'show'
        ? `Show in progress, song ${(setlist.currentIndex ?? 0) + 1} of ${count} up now. Open setlist.`
        : mode === 'outOfView'
          ? known
            ? `Setlist out of view, last seen with ${songs}. Open setlist.`
            : 'Setlist out of view. Open setlist.'
          : 'Setlist not available right now. Open setlist.'

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      aria-haspopup={opensDialog ? 'dialog' : undefined}
      className={cx(
        'yarg-focusable relative flex h-[36px] shrink-0 cursor-pointer items-center gap-[8px] pr-[14px] pl-[11px]',
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
      {mode === 'show' ? <ShowIcon size={22} /> : <SetlistIcon size={22} />}
      <span className="yarg-label hidden text-[11px] sm:inline short:hidden">setlist</span>
      <span className="font-numeric text-[15px] font-bold tabular-nums">{number}</span>
    </button>
  )
}
