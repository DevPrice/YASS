/**
 * The setlist's two marks on a song's detail: where it stands, and what this
 * browser can do about it.
 *
 * The action bar is the one that speaks whenever it is drawn — it states the
 * song's place in the setlist itself, so the badge appears only where there is
 * no bar, against a YARG that can only be followed.
 *
 * **Say when, not "no".** While nobody can add — YARG out of view, the link
 * lost, the host's switch off — the bar is a single muted line naming what has
 * to happen first, with no button to look broken all night. A refusal of this
 * one song keeps its button, drawn neutral, half-strength and `aria-disabled`
 * so a screen reader finds it too, with the reason beneath. The derivation is
 * `actionBar` in `model.ts`; this only draws it.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import type { SetlistState } from '@shared/types'
import { Badge, Button, cx } from '../../ui'
import { addToSetlist, removeFromSetlist } from '../../lib/setlist'
import { takeRefusal } from '../library/swipeAdd'
import { SetlistIcon } from './icons'
import { actionBar, badgeStanding, ordinal, type LastTry } from './model'

/** The position badge, beside `Now playing` in the detail's identity block. */
export function SetlistStanding({
  setlist,
  hash,
  isPlaying,
}: {
  setlist: SetlistState
  hash: string | null
  isPlaying: boolean
}) {
  const standing = badgeStanding(setlist, hash, isPlaying)
  if (standing === null) return null

  const [label, where] = ((): [string, string] => {
    switch (standing.kind) {
      case 'queued':
        return [`${ordinal(standing.position)} in the setlist`, String(standing.position)]
      case 'upNow':
        return ['Up now in the setlist', 'up now']
      case 'upNext':
        return ['Up next in the setlist', 'up next']
      case 'later': {
        const ahead = standing.songs - 1
        return [`In the setlist, after ${ahead} more ${ahead === 1 ? 'song' : 'songs'}`, `after ${ahead} more`]
      }
      case 'played':
        return ['Played in this show', 'played']
    }
  })()

  // "setlist ·" up front, because a bare `in 4` beside a song's title said
  // nothing about which list it was counting.
  return (
    <span aria-label={label}>
      <Badge>
        setlist · <span className="font-numeric ml-[3px] text-count">{where}</span>
      </Badge>
    </span>
  )
}

/**
 * The foot of the song detail: one control and, under a button, one caption.
 *
 * Keyed by song where it is used, so everything it remembers — the last answer,
 * the undo — belongs to one song and is gone when another is opened.
 */
export function SetlistActionBar({
  setlist,
  hash,
  mine,
  isPlaying,
}: {
  setlist: SetlistState
  hash: string | null
  mine: ReadonlySet<number>
  isPlaying: boolean
}) {
  const [pending, setPending] = useState<'add' | 'remove' | null>(null)
  // A song opened because a swipe to add it was refused starts from that
  // refusal, so the bar says why rather than offering the add YARG just turned down.
  const [last, setLast] = useState<LastTry | null>(() => takeRefusal(hash))

  const bar = actionBar({ state: setlist, hash, mine, pending, last, playing: isPlaying })
  if (bar.kind === 'hidden') return null

  const remember = (reason: LastTry['reason'], entryId: number | null) => {
    setLast({ reason, entryId, currentIndex: setlist.currentIndex })
  }

  const add = async () => {
    if (hash === null) return
    setPending('add')
    const outcome = await addToSetlist(hash)
    setPending(null)
    remember(outcome.ok ? 'ok' : outcome.reason, outcome.entryId)
  }

  const remove = async (entryId: number) => {
    setPending('remove')
    const outcome = await removeFromSetlist(entryId)
    setPending(null)
    remember(outcome.ok ? 'ok' : outcome.reason, null)
  }

  const captionId = `setlist-caption-${hash}`

  let control
  let caption: { lead: string | null; text: string } | null = null

  switch (bar.kind) {
    case 'add':
      control = <AddButton onClick={() => void add()} describedBy={captionId} />
      caption = { lead: bar.lead, text: bar.caption }
      break
    case 'busy':
      control = <AddButton busy label={bar.label} describedBy={captionId} />
      break
    case 'refused':
      control = <AddButton disabled describedBy={captionId} />
      caption = { lead: bar.lead, text: bar.caption }
      break
    case 'closed':
      control = <StatusRow where={bar.text} />
      break
    case 'added':
    case 'yours': {
      const entryId = bar.entryId
      control = (
        <StatusRow
          lead={bar.kind === 'added' ? 'Added.' : 'Yours'}
          leadClass={bar.kind === 'added' ? 'text-success' : 'text-white'}
          where={bar.where}
          action={
            <Button className="min-w-[120px]" onClick={() => void remove(entryId)}>
              {bar.kind === 'added' ? 'undo' : 'remove'}
            </Button>
          }
        />
      )
      break
    }
    case 'status':
      control = <StatusRow lead={bar.lead} leadClass="text-white" where={bar.where} />
      break
  }

  return (
    <div
      className={cx(
        'flex shrink-0 flex-col gap-[10px] bg-surface-bar px-[25px] pt-[15px]',
        'pb-[max(15px,env(safe-area-inset-bottom))]',
        'short:px-[15px] short:pt-[10px] short:pb-[max(10px,env(safe-area-inset-bottom))]',
      )}
      style={{ boxShadow: 'var(--shadow-bar)' }}
    >
      {control}
      {caption !== null ? (
        <p id={captionId} role="status" className="text-[14px] leading-[1.4] text-content-muted">
          {caption.lead !== null ? (
            <span className="font-semibold text-white">{caption.lead} </span>
          ) : null}
          {caption.text}
        </p>
      ) : (
        <p id={captionId} role="status" className="sr-only" />
      )}
    </div>
  )
}

function AddButton({
  onClick,
  disabled = false,
  busy = false,
  label,
  describedBy,
}: {
  onClick?: () => void
  disabled?: boolean
  busy?: boolean
  label?: string
  describedBy: string
}) {
  const inert = disabled || busy

  return (
    <Button
      // Neutral when it can't act: a half-strength cyan pill still reads as pressable.
      tone={disabled ? 'neutral' : 'accent'}
      icon={<SetlistIcon />}
      aria-disabled={inert}
      aria-busy={busy}
      aria-describedby={describedBy}
      onClick={inert ? undefined : onClick}
      className={cx('w-full', disabled && 'cursor-default opacity-50 hover:brightness-100')}
    >
      {label ?? 'add to setlist'}
    </Button>
  )
}

function StatusRow({
  lead,
  leadClass,
  where,
  action,
}: {
  lead?: string
  leadClass?: string
  where: string | null
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-[44px] items-center gap-[15px]">
      <SetlistIcon className="shrink-0 text-content-muted" />
      <p role="status" className="min-w-0 flex-1 text-[15px] leading-[1.35]">
        {lead !== undefined ? <span className={cx('font-semibold', leadClass)}>{lead}</span> : null}
        {where !== null ? (
          <span className="text-content-muted">
            {lead !== undefined ? ' ' : null}
            {where}
          </span>
        ) : null}
      </p>
      {action}
    </div>
  )
}
