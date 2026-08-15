/**
 * SortArrow — shown beside a sortable column heading, which is the only place
 * it appears (`SongList.tsx`'s table header and the mobile sort chips in
 * `Filters.tsx`). Rendered alone at 9x6px it is a single near-invisible
 * stroke, so both cells port a small table-header row — "title", "artist",
 * "year" — with the arrow beside whichever column is active.
 *
 * Two cells rather than one because the whole point of the direction prop is
 * that ascending and descending are the *same shape*, just rotated — proving
 * that requires two different active columns pointing opposite ways, not one
 * column toggled in place.
 */

import { SortArrow } from '@yass/client'

const COLUMNS = ['title', 'artist', 'year'] as const

const ColumnHeaderRow = ({
  active,
  direction,
}: {
  active: (typeof COLUMNS)[number]
  direction: 'asc' | 'desc'
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 25,
      width: 420,
      padding: '10px 20px',
      background: 'var(--yarg-surface-row)',
      borderBottom: '1px solid var(--color-border-strong)',
    }}
  >
    {COLUMNS.map((label) => {
      const isActive = label === active
      return (
        <span
          key={label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'var(--font-display)',
            fontWeight: 'var(--weight-extrabold)',
            textTransform: 'uppercase',
            fontSize: 13,
            color: isActive ? 'var(--yarg-white)' : 'var(--color-content-header)',
            opacity: isActive ? 1 : 0.7,
          }}
        >
          {label}
          {isActive ? <SortArrow direction={direction} /> : null}
        </span>
      )
    })}
  </div>
)

/** "title" ascending &mdash; the list's default order, arrow rotated to point up. */
export const Ascending = () => <ColumnHeaderRow active="title" direction="asc" />

/** "year" descending &mdash; newest first, same glyph unrotated and pointing down. */
export const Descending = () => <ColumnHeaderRow active="year" direction="desc" />
