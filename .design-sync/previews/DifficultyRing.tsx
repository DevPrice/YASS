/**
 * DifficultyRing — six notches around whatever the caller puts in the middle.
 * See the long comment on it in `ui/library.tsx`: unlit notches are drawn
 * (not omitted, so "3 of 6" reads as a comparison against a track), and at
 * tier 6 the whole ring turns red rather than just the last notch, because 6
 * is the ceiling and a ceiling should read without counting.
 *
 * The bundle's `.d.ts` types `tier` as a plain `number` (the real component
 * also accepts `null` — "not charted" — but that's `LensDifficulty`'s
 * concern; this card sticks to tiers a chart actually carries).
 *
 * `Sweep` and `WithGlyph` are the component's whole point per the brief: the
 * same six-plus-one values, bare and then wrapping something. `Overflow` and
 * `Sizes` are the two other axes the source spends real length justifying
 * (charts past 6, and the ring being stated in `viewBox` units specifically
 * so it can be any size) — worth a cell each since both are easy to get wrong
 * silently.
 */

import type { ReactNode } from 'react'

import { DifficultyRing, GROUP_ART } from '@yass/client'

const Tick = ({ tier, children }: { tier: number; children?: ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
    <DifficultyRing tier={tier} size={48}>
      {children}
    </DifficultyRing>
    <span style={{ fontSize: 12, color: 'var(--color-content-muted)' }}>{tier}</span>
  </div>
)

/**
 * The real instrument art, which `GROUP_ART` exposes as data URIs.
 *
 * An earlier draft of this card used a lettered monogram, on the belief that
 * the artwork was not reachable from a preview. It is — the same lookup
 * `PartsGrid` and `InstrumentStrip` use is exported from the bundle — and it
 * matters here more than anywhere, because this component draws a ring around
 * whatever the *caller* supplies. A card that wraps a placeholder demonstrates
 * the ring but not the composition anyone actually writes.
 */
const Glyph = ({ group }: { group: 'guitar' | 'bass' | 'drums' | 'keys' | 'vocals' }) => (
  <img
    src={GROUP_ART[group]}
    alt=""
    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
  />
)

/** Bare: 0 through 6, notches filling clockwise until the ring turns red at the ceiling. */
export const Sweep = () => (
  <div style={{ display: 'flex', gap: 20 }}>
    {[0, 1, 2, 3, 4, 5, 6].map((tier) => (
      <Tick key={tier} tier={tier} />
    ))}
  </div>
)

/**
 * The same ring around a glyph — the shape `LensDifficulty` and `PartsGrid`
 * both actually use it for. At the ceiling the notches still go red; past it
 * (see `Overflow`) the number would move to the bottom edge instead of here.
 */
export const WithGlyph = () => (
  <div style={{ display: 'flex', gap: 20 }}>
    <Tick tier={2}>
      <Glyph group="guitar" />
    </Tick>
    <Tick tier={4}>
      <Glyph group="bass" />
    </Tick>
    <Tick tier={6}>
      <Glyph group="drums" />
    </Tick>
  </div>
)

/**
 * Past the six-notch ceiling: the ring maxes out red and the actual number is
 * written over it — centred when bare, on the bottom edge (outlined, so it
 * survives a white glyph and a red notch under it) when something's inside.
 */
export const Overflow = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end' }}>
    <Tick tier={9} />
    <Tick tier={12}>
      <Glyph group="drums" />
    </Tick>
  </div>
)

/**
 * One `viewBox` serves every size the app actually draws this at — a 26px
 * banner stat up to a 68px parts-grid cell — because nothing inside is sized
 * in CSS.
 */
export const Sizes = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end' }}>
    <DifficultyRing tier={5} size={26} />
    <DifficultyRing tier={5} size={42} />
    <DifficultyRing tier={5} size={68}>
      <Glyph group="vocals" />
    </DifficultyRing>
  </div>
)
