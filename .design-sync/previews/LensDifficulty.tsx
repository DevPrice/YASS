/**
 * LensDifficulty — the row's one difficulty ring, pointed at whichever part
 * (or the band as a whole) the current lens asks about.
 *
 * The glyph in the middle is what says *what is being counted* on a phone row
 * with no column header, and it is real art: the component reaches into the
 * same instrument lookup `PartsGrid` uses, so a band mark, a microphone and a
 * drum kit are all legible in the captures.
 *
 * Cells are comparisons rather than single specimens. One ring on its own says
 * almost nothing — the fact worth showing is the *difference* between a lens
 * with a tier, a lens over a part the chart never had, and a part charted at
 * `0`. Those last two look similar and mean opposite things, so they are put
 * side by side deliberately.
 */

import type { ReactNode } from 'react'

import { LensDifficulty } from '@yass/client'

import { EXPERT, FULL_BAND, INSTRUMENTAL, LONG_TITLE, SPARSE } from './_fixtures'

const Item = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
    {children}
    <span
      style={{
        fontSize: 13,
        fontFamily: 'var(--font-ui)',
        color: 'var(--yarg-text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  </div>
)

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end', flexWrap: 'wrap' }}>
    {children}
  </div>
)

/**
 * One chart, read five ways.
 *
 * The band lens is the row's default; the four instrument lenses answer the
 * question a specific player is actually asking, which is never the average.
 */
export const AcrossLenses = () => (
  <Row>
    <Item label="band">
      <LensDifficulty song={FULL_BAND} lens="band" size={56} />
    </Item>
    <Item label="guitar">
      <LensDifficulty song={FULL_BAND} lens="guitar" size={56} />
    </Item>
    <Item label="bass">
      <LensDifficulty song={FULL_BAND} lens="bass" size={56} />
    </Item>
    <Item label="drums">
      <LensDifficulty song={FULL_BAND} lens="drums" size={56} />
    </Item>
    <Item label="vocals">
      <LensDifficulty song={FULL_BAND} lens="vocals" size={56} />
    </Item>
  </Row>
)

/**
 * The distinction this component exists to keep straight.
 *
 * A tier of `0` means charted and never rated — 205 of 4,168 songs in the
 * library this was measured against. `null` means the part is not there at
 * all. They are one notch apart on screen and nothing alike in meaning, so a
 * card that showed only one of them would teach the wrong lesson.
 */
export const AbsenceVersusUntiered = () => (
  <Row>
    <Item label="drums, tier 4">
      <LensDifficulty song={FULL_BAND} lens="drums" size={56} />
    </Item>
    <Item label="bass, tier 0 (unrated)">
      <LensDifficulty song={LONG_TITLE} lens="bass" size={56} />
    </Item>
    <Item label="drums, not charted">
      <LensDifficulty song={SPARSE} lens="drums" size={56} />
    </Item>
    <Item label="vocals, instrumental">
      <LensDifficulty song={INSTRUMENTAL} lens="vocals" size={56} />
    </Item>
  </Row>
)

/**
 * The ceiling, which reads without counting notches.
 *
 * At tier 6 the whole ring turns red rather than lighting a sixth notch, so a
 * chart at the top of the scale is recognisable at the 26px the banner draws.
 */
export const Ceiling = () => (
  <Row>
    <Item label="band, expert">
      <LensDifficulty song={EXPERT} lens="band" size={56} />
    </Item>
    <Item label="guitar, expert">
      <LensDifficulty song={EXPERT} lens="guitar" size={56} />
    </Item>
    <Item label="vocals, expert">
      <LensDifficulty song={EXPERT} lens="vocals" size={56} />
    </Item>
  </Row>
)
