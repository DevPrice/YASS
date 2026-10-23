/**
 * The one toast in the app: YARG wiped the setlist, and some of what it took
 * was this browser's and hadn't been played.
 *
 * Only then, and only while the panel is closed — the panel says the same
 * thing in its cleared state, which is why the toast can time out without
 * losing anything. Lit, not lifted: it arrives by opacity, never by sliding,
 * and it never takes focus.
 */

import { useEffect, useState } from 'react'

import { Button, cx } from '../../ui'

const SHOW_MS = 8_000

export function ClearedToast({ lost, onShow }: { lost: number; onShow: () => void }) {
  const [visible, setVisible] = useState(false)
  const [gone, setGone] = useState(false)
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (held || gone) return
    const timer = window.setTimeout(() => setGone(true), SHOW_MS)
    return () => window.clearTimeout(timer)
  }, [held, gone])

  if (gone) return null

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
        The setlist was cleared, with {lost === 1 ? '1 of your songs' : `${lost} of your songs`}.
      </p>
      <Button
        onClick={() => {
          setGone(true)
          onShow()
        }}
      >
        show
      </Button>
    </div>
  )
}
