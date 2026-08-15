/**
 * InstrumentStrip — five fixed slots, guitar/bass/drums/keys/vocals, lit when
 * the chart has that family and dim (20% opacity) when it doesn't. The order
 * never changes and absent parts hold their slot rather than collapsing —
 * per the JSDoc, that fixed order is what makes five glyphs scannable down a
 * column once the words under them are gone. So every cell here is chosen for
 * *which* slots are lit, and the strip's own row-column width (`w-28`, 112px)
 * is the frame, since that's the only place this ever actually appears.
 */

import type { ReactNode } from 'react'

import { InstrumentStrip } from '@yass/client'

import { EXPERT, FULL_BAND, INSTRUMENTAL, SPARSE } from './_fixtures'

/** The real column width from `columns.ts` (`w-28 shrink-0`). */
const Frame = ({ children }: { children: ReactNode }) => <div style={{ width: 112 }}>{children}</div>

/** Guitar, bass, drums, vocals lit; keys dim — the ordinary four-piece. */
export const FullBand = () => (
  <Frame>
    <InstrumentStrip song={FULL_BAND} />
  </Frame>
)

/** Guitar and vocals lit, the other three dim — most of the strip is absence here. */
export const Sparse = () => (
  <Frame>
    <InstrumentStrip song={SPARSE} />
  </Frame>
)

/** Instrumental: guitar, bass, drums, keys lit and vocals alone dim — an absence the count (0) causes, not a gap in the chart. */
export const Instrumental = () => (
  <Frame>
    <InstrumentStrip song={INSTRUMENTAL} />
  </Frame>
)

/** Every family charted, at a larger size than the row ever draws it. */
export const AllLitLarge = () => (
  <Frame>
    <InstrumentStrip song={EXPERT} size={32} />
  </Frame>
)
