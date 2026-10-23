/**
 * The one toast in the app: YARG wiped the setlist, and some of what it took
 * was this browser's and hadn't been played.
 *
 * Only then, and only while the panel is closed — the panel says the same
 * thing in its cleared state, so the toast steps aside the moment the panel
 * opens rather than saying it twice. Its one button does the thing rather than
 * leading to it: `add again` re-adds the lost songs from here, and the toast
 * stays to say how that went. Lit, not lifted: it arrives by opacity, never by
 * sliding, and it never takes focus.
 */

import { useEffect, useState } from 'react'

import type { SetlistEntry } from '@shared/types'
import { Button, cx } from '../../ui'
import { SetlistIcon } from './icons'
import { addAgain } from './SetlistPanel'

/** Long enough to read twice in a loud room, with a phone held at arm's length. */
const SHOW_MS = 11_000

/** How long the result of `add again` stays. */
const RESULT_MS = 5_000

export function ClearedToast({
  lost,
  covered,
  onDone,
}: {
  lost: readonly SetlistEntry[]
  /** The panel is showing, and says this itself. */
  covered: boolean
  /** Gone, for good: timed out, covered, or finished adding. */
  onDone: () => void
}) {
  const [visible, setVisible] = useState(false)
  const [gone, setGone] = useState(false)
  const [held, setHeld] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (covered) setGone(true)
  }, [covered])

  useEffect(() => {
    if (held || gone || busy) return
    const timer = window.setTimeout(() => setGone(true), result === null ? SHOW_MS : RESULT_MS)
    return () => window.clearTimeout(timer)
  }, [held, gone, busy, result])

  useEffect(() => {
    if (gone) onDone()
  }, [gone, onDone])

  if (gone) return null

  const again = async () => {
    setBusy(true)
    const words = await addAgain(lost)
    setBusy(false)
    setResult(words)
  }

  const count = lost.length

  return (
    <div
      role="status"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cx(
        'absolute inset-x-[15px] top-[102px] z-20 flex items-center gap-[15px] px-[20px] py-[12px] short:top-[58px]',
        'sm:right-[15px] sm:left-auto sm:max-w-[420px]',
        'transition-opacity duration-160 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{
        borderRadius: 'var(--radius-md)',
        background: 'var(--yarg-surface-toast)',
        boxShadow: 'var(--shadow-bar), inset 0 0 0 var(--stroke) var(--yarg-border-card)',
      }}
    >
      <p className="min-w-0 flex-1 text-[15px] leading-[1.35] text-content">
        {result ??
          (count === 1
            ? '1 of your songs was cleared before it played.'
            : `${count} of your songs were cleared before they played.`)}
      </p>
      {result === null ? (
        <Button
          icon={<SetlistIcon />}
          onClick={() => void again()}
          aria-busy={busy}
          disabled={busy}
          className="shrink-0"
        >
          add again
        </Button>
      ) : null}
    </div>
  )
}
