/**
 * ChevronRight — "there is more of this behind here," ported into its two
 * real hosts rather than shown bare, which at 6x9px is a single
 * near-invisible dot.
 *
 * `Collapsed` / `Expanded` port `FacetPicker.tsx`'s disclosure summary row:
 * the chevron sits beside the current selection as part of one phrase
 * — "source — all — ▸" — rather than parked at the row's far edge, and it
 * rotates 90&deg; open instead of swapping to a different glyph.
 * `DetailsLink` ports `NowPlayingBar.tsx`'s trailing "details" affordance,
 * the chevron's other real job: pointing at a sheet it opens rather than a
 * panel it discloses. Each wrapper sets an explicit `color` so the cell shows
 * the glyph tracing `currentColor` rather than carrying paint of its own.
 */

import { ChevronRight } from '@yass/client'

const FacetRow = ({ open, selected }: { open: boolean; selected: string }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: 280,
      padding: '10px 15px',
      background: 'var(--yarg-surface-sunken)',
      borderRadius: 'var(--radius-md)',
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--weight-extrabold)',
      textTransform: 'uppercase',
      fontSize: 11,
      color: 'var(--color-count-muted)',
    }}
  >
    <span>source</span>
    <span
      style={{ color: selected === 'all' ? 'var(--color-content-faint)' : 'var(--color-accent)' }}
    >
      {selected}
    </span>
    <span
      style={{
        marginLeft: 'auto',
        display: 'inline-flex',
        color: 'var(--color-content-faint)',
        rotate: open ? '90deg' : '0deg',
      }}
    >
      <ChevronRight />
    </span>
  </div>
)

/** Closed: "source — all —" pointing right at the panel it would open. */
export const Collapsed = () => <FacetRow open={false} selected="all" />

/** Open, with facets already chosen &mdash; the chevron rotates, it doesn't swap. */
export const Expanded = () => <FacetRow open selected="yarg, yarg dlc" />

/** `NowPlayingBar`'s other real host: a muted trailing link into the detail sheet. */
export const DetailsLink = () => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--weight-extrabold)',
      textTransform: 'uppercase',
      fontSize: 10,
      color: 'var(--color-content-muted)',
    }}
  >
    details
    <ChevronRight />
  </span>
)
