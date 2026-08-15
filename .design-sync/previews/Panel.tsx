/**
 * Panel — the flat-fill, inset-stroke card (`yarg-card`: `--yarg-surface-card`
 * plus a 2px inset stroke, no drop shadow) that every raised surface in the
 * design system sits on.
 *
 * `Panel` supplies only the fill, the stroke and the radius — no padding —
 * so both cells add their own, at the same 20px/15px/10px rhythm the rest of
 * the app spaces its cards at (`HelperBar`, `SongDetail`'s panes). Real
 * content, not an empty box: `SongFacts` ports the `dt`/`dd` fact grid from
 * `SongDetail.tsx` almost verbatim (`year` / `length` / `genre` / `charted
 * by` / `rating`, using the same `FULL_BAND` fixture other cards in this
 * sync use), because an empty card proves nothing about how the fill and
 * stroke read against real text. `NowPlayingTile` shows the same surface
 * doing a different job — a compact status tile composing `Badge` inside it
 * — to prove `Panel` isn't a single-purpose "fact card" component.
 */

import { Badge, Panel } from '@yass/client'

import { FULL_BAND } from './_fixtures'

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 340 }}>{children}</div>
)

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <dt
        className="yarg-label"
        style={{ fontSize: 12, color: 'var(--yarg-text-count-muted)' }}
      >
        {label}
      </dt>
      <dd style={{ fontSize: 15, lineHeight: 1.2, color: 'var(--yarg-text-primary)', margin: 0 }}>
        {value}
      </dd>
    </div>
  )
}

/**
 * A song-facts card, the same five answers `SongDetail.tsx` shows below the
 * artwork.
 *
 * `Panel` takes only `className` and `children` — no `style` prop, so the
 * padding and layout have to live on an inner `div` rather than on `Panel`
 * itself.
 */
export const SongFacts = () => (
  <Frame>
    <Panel>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 15 }}>
        <p
          style={{
            fontSize: 20,
            fontWeight: 600,
            lineHeight: 1.2,
            color: 'var(--yarg-text-primary)',
            margin: 0,
          }}
        >
          {FULL_BAND.name}
        </p>
        <dl
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 25, rowGap: 15, margin: 0 }}
        >
          <Fact label="year" value={FULL_BAND.year} />
          <Fact label="length" value="4:03" />
          <Fact label="genre" value={`${FULL_BAND.genre} · ${FULL_BAND.subgenre}`} />
          <Fact label="charted by" value={FULL_BAND.charter} />
          <Fact label="rating" value={FULL_BAND.ageRating} />
        </dl>
      </div>
    </Panel>
  </Frame>
)

/** The same fill and stroke doing a smaller job: a status tile pairing a `Badge` with the title it's about. */
export const NowPlayingTile = () => (
  <Frame>
    <Panel>
      <div style={{ padding: 15, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <Badge tone="accent">Now playing</Badge>
        </div>
        <div>
          <p style={{ fontSize: 17, fontWeight: 600, color: 'var(--yarg-text-primary)', margin: 0 }}>
            Vaultbreaker
          </p>
          <p style={{ fontSize: 13, color: 'var(--yarg-text-cyan-soft)', margin: 0 }}>
            Nine Volt Hymn
          </p>
        </div>
      </div>
    </Panel>
  </Frame>
)
