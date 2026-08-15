/**
 * EmptyState — three real messages, not one invented one, because the
 * component reads as a different thing depending on which. All three are
 * copied verbatim from `App.tsx` / `SongList.tsx` rather than paraphrased,
 * since the exact wording is part of what a design agent should be able to
 * imitate.
 *
 * `EmptyState` deliberately fills its container (`flex-1`) instead of sizing
 * to its text — see the component's own JSDoc for why an empty state that
 * shrank to its message once pulled the phone's control bar 333px up the
 * screen. A bare render would collapse to nothing, so every cell here gets a
 * fixed-height flex parent standing in for the column it normally owns.
 */

import { EmptyState } from '@yass/client'

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', width: 420, height: 260 }}>
    {children}
  </div>
)

/** `SongList.tsx`, zero rows after filtering — the everyday case. */
export const NoResults = () => (
  <Frame>
    <EmptyState title="No songs match">
      Try clearing a filter or searching for something shorter.
    </EmptyState>
  </Frame>
)

/** `App.tsx`, before the host has ever pointed YASS at a library. */
export const NoLibrary = () => (
  <Frame>
    <EmptyState title="No songs loaded">
      Nobody has exported the song list yet. In YARG: Settings &rarr; Export Songs List &rarr;
      CSV. Whoever is running it points YASS at the file once, and it keeps up from there.
    </EmptyState>
  </Frame>
)

/** `App.tsx`, the fetch itself failing &mdash; a different voice from "empty." */
export const LoadError = () => (
  <Frame>
    <EmptyState title="Could not load the song list">
      <p>Could not read songcache.bin. Check the library path in Settings.</p>
    </EmptyState>
  </Frame>
)
