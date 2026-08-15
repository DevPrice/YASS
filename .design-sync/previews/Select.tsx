/**
 * Select — a plain native `<select>`, restyled to the sunken chrome and 38px
 * control height every other library control uses, with an optional label
 * caption drawn above it.
 *
 * Nothing in the shipped app calls `Select` yet — every sort and filter
 * control in `Filters.tsx` is built from `ToggleChip` instead, because a
 * chip can be pointed at with a thumb without opening a native picker. This
 * primitive exists for the places a chip run doesn't fit (a long list of
 * options, or a spot with no room for one-per-value). The two cells use the
 * app's own vocabulary rather than invented option lists — `sort by` reuses
 * `COMPACT_SORTS` from `Filters.tsx` verbatim, and the genre list matches the
 * `genre` values on the fixture songs in `_fixtures.ts` — so the difference
 * being shown is only the `label` prop, not the content around it.
 */

import { Select } from '@yass/client'

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 220 }}>{children}</div>
)

/** `label` set — draws the small caption above the control, as `ColumnPicker.tsx` does for its own controls. */
export const SortBy = () => (
  <Frame>
    <Select label="sort by" defaultValue="artist" aria-label="Sort songs by">
      <option value="artist">Artist</option>
      <option value="name">Title</option>
      <option value="year">Year</option>
      <option value="difficulty">Difficulty</option>
      <option value="length">Length</option>
    </Select>
  </Frame>
)

/** No `label` — a bare control, for a spot that already carries its own caption elsewhere on the sheet. */
export const Unlabeled = () => (
  <Frame>
    <Select defaultValue="rock" aria-label="Filter by genre">
      <option value="rock">Rock</option>
      <option value="metal">Metal</option>
      <option value="folk">Folk</option>
      <option value="electronic">Electronic</option>
      <option value="soul">Soul</option>
    </Select>
  </Frame>
)
