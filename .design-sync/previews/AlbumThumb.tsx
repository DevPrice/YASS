/**
 * AlbumThumb — the cover, or nothing at all.
 *
 * Read against `client/src/ui/library.tsx`, the component itself draws
 * exactly one thing: an `<img>`, and only when `song.hasArt` is true, the
 * hash is present, and that image hasn't already failed to load. Every other
 * case — `hasArt: false`, a null hash, a fetch that 404s — returns `null`.
 * There is no drawn placeholder, no typographic plate, no broken-image glyph:
 * "when it fails, it disappears" is the JSDoc's own words for it, and the
 * caller is the one that reserves a square for the thumb to sit in (see
 * `WideRow` and `NarrowRow` in `SongList.tsx`, and the comment on
 * `NarrowRow`: "An empty square is the honest state of a song whose cover has
 * not arrived.").
 *
 * None of the fixtures set `hasArt: true` with a hash the dev server actually
 * serves, and this preview is captured with no server behind it at all — so
 * every cell below renders that same empty result. That is not a broken
 * preview; it is the component's real, documented common case (`hasArt` is
 * false on every fixture in the set), and the honest way to show a component
 * that mostly draws nothing is to make the *nothing* visible: each cell wraps
 * it in a dashed slot — glue this file owns, not anything `AlbumThumb`
 * renders — sized the way a real row reserves it, so what's on screen is
 * "this square, and it's empty" rather than a blank card that looks
 * unfinished.
 *
 * A `hasArt: true` cell was tried and dropped: it takes the `<img>` branch
 * instead of returning immediately, but the URL it requests has no server to
 * answer it in this static capture, so the request fails and `onError` lands
 * on the exact same empty result as `hasArt: false` — pixel-identical to
 * `NoArt` in the screenshot. Per the brief, that's a cell to skip rather than
 * ship two that look alike; see `.design-sync/learnings/music.md`.
 */

import type { ReactNode } from 'react'

import { AlbumThumb } from '@yass/client'

import { FULL_BAND, SPARSE } from './_fixtures'

/** The reserved square a real row draws around the thumb, made visible. */
const Slot = ({ size, children }: { size: number; children: ReactNode }) => (
  <div
    style={{
      width: size,
      height: size,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-sm)',
      border: '1px dashed var(--color-border-strong)',
      background: 'var(--color-surface-sunken)',
    }}
  >
    {children}
  </div>
)

const Labeled = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
    {children}
    <span style={{ fontSize: 12, color: 'var(--color-content-muted)', maxWidth: 160, textAlign: 'center' }}>
      {label}
    </span>
  </div>
)

/**
 * The ordinary case: no art on record. This is what 100% of a library with
 * no covers filled in looks like, and it's what most of these fixtures are.
 */
export const NoArt = () => (
  <Labeled label="hasArt: false — the 48px row slot, empty">
    <Slot size={48}>
      <AlbumThumb song={FULL_BAND} size={48} />
    </Slot>
  </Labeled>
)

/**
 * `size` only ever reaches the `<img>`'s own width/height attributes, so with
 * no art to draw it changes nothing about the thumb — only the slot the
 * caller built around it. Two real callers, two real sizes: `WideRow` reserves
 * 48px, `NarrowRow`'s phone layout reserves 44px.
 */
export const Sizes = () => (
  <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
    <Labeled label="44px — the phone row">
      <Slot size={44}>
        <AlbumThumb song={SPARSE} size={44} />
      </Slot>
    </Labeled>
    <Labeled label="96px — a larger placement">
      <Slot size={96}>
        <AlbumThumb song={SPARSE} size={96} />
      </Slot>
    </Labeled>
  </div>
)
