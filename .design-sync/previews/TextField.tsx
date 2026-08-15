/**
 * TextField — the sunken pill input that backs every free-text search in the
 * app (`Filters.tsx`'s song search, `FacetPicker.tsx`'s per-facet filter).
 *
 * Three cells, not the usual "one per prop": the component has exactly one
 * real job — search — so the axis worth showing is *state*, not invented
 * variants. Empty proves the leading glyph and placeholder read correctly on
 * their own; Typing proves a value doesn't collide with the leading glyph's
 * gap; WithTrailing proves the `trailing` slot actually renders, which
 * matters because nothing shipped in the app fills it today and an unused
 * slot is the one most likely to silently rot.
 */

import { TextField } from '@yass/client'

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ClearGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
      <path d="M1 1L8 8M8 1L1 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 320 }}>{children}</div>
)

/** Resting state: nobody has typed yet, so the placeholder and glyph carry the field alone. */
export const Empty = () => (
  <Frame>
    <TextField
      type="search"
      placeholder="Search title, artist, charter..."
      leading={<SearchGlyph />}
      aria-label="Search songs"
    />
  </Frame>
)

/** A real query typed in, showing the value sits clear of the leading glyph and the placeholder is gone. */
export const Typing = () => (
  <Frame>
    <TextField
      type="search"
      defaultValue="vaultbreaker"
      leading={<SearchGlyph />}
      aria-label="Search songs"
    />
  </Frame>
)

/** `trailing` filled with a clear control, alongside `leading` — both slots at once. */
export const WithTrailing = () => (
  <Frame>
    <TextField
      type="search"
      defaultValue="nine volt hymn"
      leading={<SearchGlyph />}
      trailing={
        <button
          type="button"
          aria-label="Clear search"
          style={{
            display: 'flex',
            color: 'var(--yarg-text-count-muted)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          <ClearGlyph />
        </button>
      }
      aria-label="Search songs"
    />
  </Frame>
)
