/**
 * Badge — the small status mark used in `NowPlayingBar.tsx` and
 * `SongDetail.tsx`. Two tones cover every real call site: `accent` is
 * reserved for the one fact worth lighting up ("this is playing right now"),
 * and the default `neutral` covers everything else, here shown as `offline`
 * — the one badge in the app that carries a `title` tooltip because its
 * three-word sentence ("live updates interrupted") doesn't fit the pill.
 *
 * `Combined` reproduces the actual pairing from `NowPlayingBar.tsx` (lines
 * ~100-104): both badges sitting side by side is a real composition, not an
 * invented one, and it's the only cell that shows the two tones sharing a
 * baseline.
 */

import { Badge } from '@yass/client'

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{children}</div>
)

/** `tone="accent"` — the gradient-tinted mark for the song currently playing. */
export const NowPlaying = () => (
  <Row>
    <Badge tone="accent">Now playing</Badge>
  </Row>
)

/** The default `neutral` tone, carrying the full sentence in `title` rather than in the two words shown. */
export const Offline = () => (
  <Row>
    <Badge title="Live updates interrupted">offline</Badge>
  </Row>
)

/** Both tones as they actually appear together, stacked above a playing song's title. */
export const Combined = () => (
  <Row>
    <Badge tone="accent">Now playing</Badge>
    <Badge title="Live updates interrupted">offline</Badge>
  </Row>
)
