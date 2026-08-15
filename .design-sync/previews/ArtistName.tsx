/**
 * ArtistName — the performer, and "as made famous by" when the chart isn't
 * actually them playing.
 *
 * The component emits no wrapper (see the JSDoc on it in `ui/library.tsx`):
 * every housing sets its own size, colour and truncation, so each cell here
 * supplies one. Two housings are lifted straight from real callers —
 * `credit="inline"` at the detail pane's 20px italic secondary, and
 * `credit="label"` at the wide row's 18px column — because the housing is
 * half of what each mode looks like; showing the bare text in identical boxes
 * would hide that `label` is meant for a narrow column and `inline` for a
 * full sentence.
 *
 * `FULL_BAND` is a master recording (`isMaster: true`) and carries no cover
 * preamble either way, so the four cells cross `inline`/`label` against
 * `FULL_BAND`/`SPARSE` (`isMaster: false`) to show both housings with and
 * without the credit — the axis this component actually exists to draw.
 */

import type { ReactNode } from 'react'

import { ArtistName } from '@yass/client'

import { FULL_BAND, SPARSE } from './_fixtures'

/** The detail pane's own setting: a full sentence, nothing truncated. */
const Inline = ({ children }: { children: ReactNode }) => (
  <p
    style={{
      fontSize: 20,
      lineHeight: 1.15,
      fontWeight: 500,
      fontStyle: 'italic',
      color: 'var(--color-content-secondary)',
      maxWidth: 420,
      margin: 0,
    }}
  >
    {children}
  </p>
)

/** The wide row's own column: 18px, a fixed width, no truncation on this cell (the name inside truncates). */
const Label = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: 'flex',
      minHeight: '1.32em',
      minWidth: 0,
      alignItems: 'center',
      width: 220,
      fontSize: 18,
      lineHeight: 1,
      fontWeight: 500,
      fontStyle: 'italic',
      color: 'var(--color-content-secondary)',
    }}
  >
    {children}
  </div>
)

/** `inline`, plain: a master recording, so no preamble — most of a library. */
export const InlinePlain = () => (
  <Inline>
    <ArtistName song={FULL_BAND} credit="inline" />
  </Inline>
)

/** `inline`, covered: `isMaster: false` triggers "as made famous by", set quieter than the name. */
export const InlineCover = () => (
  <Inline>
    <ArtistName song={SPARSE} credit="inline" />
  </Inline>
)

/** `label`, plain: the bare name, sharing a baseline with every original around it. */
export const LabelPlain = () => (
  <Label>
    <ArtistName song={FULL_BAND} credit="label" />
  </Label>
)

/**
 * `label`, covered: YARG's own two-line `AS MADE / FAMOUS BY` tucked against
 * the name, which only `credit="label"` draws — `inline` says the same fact
 * as a leading sentence instead.
 */
export const LabelCover = () => (
  <Label>
    <ArtistName song={SPARSE} credit="label" />
  </Label>
)
