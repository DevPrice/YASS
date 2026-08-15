/**
 * PartsGrid — every instrument family a chart carries, with its tier.
 *
 * The four cells are chosen for the shapes the grid has to survive rather than
 * for variety: a full band, the ceiling, a chart with most families missing,
 * and one with no vocals at all. Absence is the thing this component is for, so
 * a preview of only full charts would prove nothing.
 */

import { PartsGrid } from '@yass/client'

import { EXPERT, FULL_BAND, INSTRUMENTAL, SPARSE } from './_fixtures'

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ maxWidth: 420 }}>{children}</div>
)

/** Guitar, bass, drums and vocals — the ordinary four-piece. */
export const FullBand = () => (
  <Frame>
    <PartsGrid song={FULL_BAND} />
  </Frame>
)

/** Every family charted at tier 6, where the rings go red. */
export const Ceiling = () => (
  <Frame>
    <PartsGrid song={EXPERT} />
  </Frame>
)

/** Guitar and vocals only. The families with no chart are drawn dim, not dropped. */
export const Sparse = () => (
  <Frame>
    <PartsGrid song={SPARSE} />
  </Frame>
)

/** No vocal part at all, which is a different statement from an unrated one. */
export const Instrumental = () => (
  <Frame>
    <PartsGrid song={INSTRUMENTAL} />
  </Frame>
)
