/**
 * ToggleChip — the filter and sort pill used throughout `Filters.tsx`,
 * `FacetPicker.tsx` and `ColumnPicker.tsx`.
 *
 * Both cells pair an active chip with an inactive one, per the brief's own
 * instruction, because the two states share almost no visible surface —
 * dimmed outline text versus a filled accent tint — and a single chip alone
 * proves only that one of the two renders. `SortChip` goes further than a
 * plain on/off: in the real sort row (`Filters.tsx` lines ~426-448) the
 * `SortArrow` glyph is rendered *only* on the active chip, so an inactive
 * chip isn't a grayed-out copy of the active one, it is missing a whole
 * child. Pairing them is the only way to show that the icon is conditional
 * rather than merely recolored.
 */

import { SortArrow, ToggleChip } from '@yass/client'

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
)

/** An instrument-part filter row (`has parts`): one part switched on, its neighbor still off. */
export const InstrumentFilters = () => (
  <Row>
    <ToggleChip active onClick={() => {}} label="Only songs with a drums part">
      Drums
    </ToggleChip>
    <ToggleChip active={false} onClick={() => {}} label="Only songs with a keys part">
      Keys
    </ToggleChip>
  </Row>
)

/** The sort row: the active chip carries the direction arrow, the inactive one carries only the word. */
export const SortChip = () => (
  <Row>
    <ToggleChip
      active
      onClick={() => {}}
      label="Currently sorted by artist, ascending. Tap to reverse"
    >
      Artist
      <SortArrow direction="asc" />
    </ToggleChip>
    <ToggleChip active={false} onClick={() => {}} label="Sort by title">
      Title
    </ToggleChip>
  </Row>
)
