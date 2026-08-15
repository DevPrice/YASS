/**
 * SongTitle — the title, with the asides that qualify it set quieter.
 *
 * The component emits no wrapper of its own: five different housings set the
 * size, colour and truncation around it. So each cell here supplies that
 * housing, which is also the only way to see that `notes="inline"` and
 * `notes="block"` differ.
 */

import { SongTitle } from '@yass/client'

import { ARTIST_CREDIT, FEATURED, FULL_BAND, LONG_TITLE } from './_fixtures'

/** A table cell: 22px, one line, truncated. This is the list's own setting. */
const Cell = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      fontSize: 22,
      fontWeight: 600,
      color: 'var(--yarg-text-primary)',
      maxWidth: 520,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </div>
)

/** `inline` — the guest credit trails on the title's own line, set quieter. */
export const Inline = () => (
  <Cell>
    <SongTitle song={FEATURED} notes="inline" />
  </Cell>
)

/**
 * `block` — the asides drop below, for the detail pane.
 *
 * This name carries both kinds at once: a recording qualifier, which stays part
 * of the title, and a guest credit, which does not.
 */
export const Block = () => (
  <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--yarg-text-primary)', maxWidth: 520 }}>
    <SongTitle song={LONG_TITLE} notes="block" />
  </div>
)

/** A plain name, which is most of a library: nothing to pull out, nothing dimmed. */
export const Plain = () => (
  <Cell>
    <SongTitle song={FULL_BAND} />
  </Cell>
)

/**
 * The same credit, filed in the artist field instead of the title.
 *
 * Renders identically to `Inline` on purpose — that equivalence is the point,
 * since the library's spelling should not change how the row reads.
 */
export const CreditFromArtist = () => (
  <Cell>
    <SongTitle song={ARTIST_CREDIT} notes="inline" />
  </Cell>
)

/** What the list actually does when the name outruns the column. */
export const Truncated = () => (
  <Cell>
    <SongTitle song={LONG_TITLE} notes="inline" />
  </Cell>
)
