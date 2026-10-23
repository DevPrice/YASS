/**
 * The setlist's two marks on a song's detail: where it stands, and what this
 * browser can do about it.
 *
 * **Say when, not "no".** An add that can't work right now is still drawn —
 * neutral, half-strength and `aria-disabled`, so a screen reader finds it too —
 * and its caption says when it will work, in terms of what the host is doing.
 * Nobody learns from a refusal what the bar could have told them before they
 * tapped. The derivation is `actionBar` in `model.ts`; this only draws it.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { SetlistState } from '@shared/types'
import { Badge, Button, cx } from '../../ui'
import { addToSetlist, removeFromSetlist } from '../../lib/setlist'
import { SetlistIcon } from './icons'
import { LOCKED_HOLD_MS, actionBar, ordinal, standingOf, type LastTry } from './model'

/** The position badge, beside `Now playing` in the detail's identity block. */
export function SetlistStanding({ setlist, hash }: { setlist: SetlistState; hash: string | null }) {
  const standing = standingOf(setlist, hash)
  if (standing === null) return null

  switch (standing.kind) {
    case 'queued':
      return (
        <span aria-label={`${ordinal(standing.position)} in the setlist`}>
          <Badge>
            setlist <span className="font-numeric ml-[5px] text-count">{standing.position}</span>
          </Badge>
        </span>
      )
    case 'upNow':
      return (
        <span aria-label="Up now in the show">
          <Badge tone="accent">up now</Badge>
        </span>
      )
    case 'upNext':
      return (
        <span aria-label="Up next in the show">
          <Badge>up next</Badge>
        </span>
      )
    case 'later':
      return (
        <span aria-label={`Comes up in ${standing.songs} songs`}>
          <Badge>in {standing.songs} songs</Badge>
        </span>
      )
    case 'played':
      return (
        <span aria-label="Played in this show">
          <Badge>played</Badge>
        </span>
      )
  }
}

/**
 * The foot of the song detail: one control and one caption.
 *
 * Keyed by song where it is used, so everything it remembers — the last answer,
 * the undo — belongs to one song and is gone when another is opened.
 */
export function SetlistActionBar({
  setlist,
  hash,
  mine,
}: {
  setlist: SetlistState
  hash: string | null
  mine: ReadonlySet<number>
}) {
  const [pending, setPending] = useState(false)
  const [last, setLast] = useState<LastTry | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // "Hold on a moment" expires by the clock as well as by the show moving, and
  // the clock moving is not something React hears about on its own.
  useEffect(() => {
    if (last?.reason !== 'locked') return
    const timer = window.setTimeout(() => setNow(Date.now()), LOCKED_HOLD_MS - (Date.now() - last.at))
    return () => window.clearTimeout(timer)
  }, [last])

  const bar = actionBar({ state: setlist, hash, mine, pending, last, now })
  if (bar.kind === 'hidden') return null

  const remember = (reason: LastTry['reason'], entryId: number | null) => {
    const at = Date.now()
    setNow(at)
    setLast({ reason, entryId, currentIndex: setlist.currentIndex, at })
  }

  const add = async () => {
    if (hash === null) return
    setPending(true)
    const outcome = await addToSetlist(hash)
    setPending(false)
    remember(outcome.ok ? 'ok' : outcome.reason, outcome.entryId)
  }

  const remove = async (entryId: number) => {
    setPending(true)
    const outcome = await removeFromSetlist(entryId)
    setPending(false)
    remember(outcome.ok ? 'ok' : outcome.reason, null)
  }

  const captionId = `setlist-caption-${hash}`

  let control
  let caption: { lead: string | null; text: string } | null = null

  switch (bar.kind) {
    case 'add':
    case 'retry':
      control = (
        <AddButton onClick={() => void add()} describedBy={captionId} />
      )
      caption = { lead: bar.kind === 'add' ? bar.lead : null, text: bar.caption }
      break
    case 'adding':
      control = <AddButton busy describedBy={captionId} />
      break
    case 'disabled':
      control = <AddButton disabled describedBy={captionId} />
      caption = { lead: bar.lead, text: bar.caption }
      break
    case 'checking':
      control = <AddButton disabled label="checking…" describedBy={captionId} />
      caption = { lead: null, text: 'Lost the connection. Checking whether it went in…' }
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
      {label ?? (busy ? 'adding…' : 'add to setlist')}
    </Button>
  )
}

function StatusRow({
  lead,
  leadClass,
  where,
  action,
}: {
  lead: string
  leadClass: string
  where: string | null
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-[44px] items-center gap-[15px]">
      <SetlistIcon className="text-content-muted" />
      <p role="status" className="min-w-0 flex-1 text-[15px] leading-[1.35]">
        <span className={cx('font-semibold', leadClass)}>{lead}</span>
        {where !== null ? <span className="text-content-muted"> {where}</span> : null}
      </p>
      {action}
    </div>
  )
}
