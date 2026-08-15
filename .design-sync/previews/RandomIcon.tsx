/**
 * RandomIcon — the shuffle glyph, composed into the controls it actually
 * lives in. Rendered bare it is an 18px near-dot with no frame of reference,
 * so `InButton` and `IconOnly` port `Filters.tsx`'s two real shapes for it: a
 * labelled accent pill, and the icon-only width the label collapses into once
 * the search field needs the room back below ~900px. `Standalone` is the one
 * cell that isolates the geometry at true size, in two explicit colours, so
 * it's visible that the glyph traces `currentColor` rather than carrying
 * paint of its own — it's inlined SVG precisely so it can do that (see the
 * component's own JSDoc).
 */

import { Button, RandomIcon } from '@yass/client'

/** The everyday case: enough width for the word. */
export const InButton = () => (
  <Button tone="accent" icon={<RandomIcon />}>
    random song
  </Button>
)

/** The same control, icon-only, once the list is too narrow to spare the label. */
export const IconOnly = () => (
  <Button
    tone="accent"
    icon={<RandomIcon />}
    aria-label="Pick a random song from the current results"
  />
)

/** True 18px size, isolated, in two of the colours it's asked to inherit. */
export const Standalone = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    <span style={{ color: 'var(--yarg-white)', display: 'inline-flex' }}>
      <RandomIcon />
    </span>
    <span style={{ color: 'var(--color-accent)', display: 'inline-flex' }}>
      <RandomIcon />
    </span>
  </div>
)
