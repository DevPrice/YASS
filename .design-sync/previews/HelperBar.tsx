/**
 * HelperBar — the desktop-only footer of keyboard hints, kept from the game
 * even though a browser has no gamepad because it's the strongest identity
 * cue in YARG's chrome (see the JSDoc on the component itself).
 *
 * Both cells port `App.tsx`'s real composition rather than inventing one: a
 * `kbd` chip plus its dimmed label on the left, and a right-aligned status
 * string sourced from the SSE now-playing feed. `Hint` is a local copy of
 * `App.tsx`'s own (unexported) `HelperHint` — there is nothing else to import
 * it from. The two cells are `idle` and `playing` because that live status is
 * the one thing the bar exists to announce, and hint count differs between
 * them for the same reason it does in the app: `next song` and `esc` only
 * apply once something is selected or open.
 *
 * Wrapped in a fixed-width div because `HelperBar` itself has no width
 * opinion — it stretches to whatever flex parent it's given, which in the
 * real app is the whole window.
 */

import { HelperBar } from '@yass/client'

const Hint = ({ keyLabel, action }: { keyLabel: string; action: string }) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <kbd
      style={{
        display: 'flex',
        height: 24,
        minWidth: 24,
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 7px',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--yarg-white)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--yarg-surface-sunken)',
        boxShadow: 'inset 0 0 0 2px var(--yarg-border-card)',
      }}
    >
      {keyLabel}
    </kbd>
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 'var(--weight-extrabold)',
        textTransform: 'uppercase',
        fontSize: 12,
        color: 'var(--color-content-muted)',
      }}
    >
      {action}
    </span>
  </span>
)

/** Nothing selected, nothing playing — only the hint that always applies. */
export const Idle = () => (
  <div style={{ width: 640 }}>
    <HelperBar>
      <Hint keyLabel="/" action="search" />
      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-content-faint)' }}>
        yarg is idle
      </span>
    </HelperBar>
  </div>
)

/** A song selected and a sheet open: two more hints appear, and the status flips. */
export const Playing = () => (
  <div style={{ width: 640 }}>
    <HelperBar>
      <Hint keyLabel="/" action="search" />
      <Hint keyLabel="&uarr;&darr;" action="next song" />
      <Hint keyLabel="esc" action="close details" />
      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-content-faint)' }}>
        yarg is playing
      </span>
    </HelperBar>
  </div>
)
