/**
 * SourceBadge — the icon and name for a chart's origin, resolved through
 * YARG's own OpenSource registry (see `client/src/lib/sources.ts`).
 *
 * Every other card in this batch attaches a source to an invented song, and
 * for that reason stays inside `yarg` / `yargdlc` / `$DEFAULT$` — the ids
 * that don't read as a claim about a licensed release. `SourceBadge` never
 * takes a song at all; it renders a registry entry standing alone. That's
 * this card's documented exception: `Registry` below shows real ids the
 * registry actually carries, licensed ones included (`Rock Band 3 DLC`,
 * `Guitar Hero II`), because naming a real game by its real id with no
 * fabricated song attributed to it is just... naming the game.
 *
 * `NoGlyph` is the other real-world case worth showing: only `base/` icons
 * ship in this bundle (the official games), not `extra/` (charter groups and
 * community packs), so an `extra/`-only id resolves its name correctly and
 * draws no icon. That's the intended graceful path, not a missing asset.
 */

import { SourceBadge } from '@yass/client'

/** With the name, at the detail pane's size — the icon and the name both carrying weight. */
export const WithName = () => (
  <SourceBadge source="yarg" size={22} nameClassName="text-[15px] leading-tight text-content-muted" />
)

/** Icon only: the row's own setting, where the name would be one more thing competing for the column. */
export const IconOnly = () => <SourceBadge source="yargdlc" size={26} showName={false} />

/**
 * The registry's range, unattached to any song — the one place this batch
 * shows a licensed catalogue id, because there's no invented record beside it
 * to mistake for a real one.
 */
export const Registry = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <SourceBadge source="yarg" size={20} nameClassName="text-[15px] text-content-muted" />
    <SourceBadge source="rb3dlc" size={20} nameClassName="text-[15px] text-content-muted" />
    <SourceBadge source="gh2" size={20} nameClassName="text-[15px] text-content-muted" />
    <SourceBadge source="$default$" size={20} nameClassName="text-[15px] text-content-muted" />
  </div>
)

/** An `extra/`-only id: the name resolves, the icon is graceful about not existing here. */
export const NoGlyph = () => (
  <SourceBadge source="rbtp_vol_1" size={20} nameClassName="text-[15px] text-content-muted" />
)
