/**
 * The demo build's one entry point.
 *
 * `vite build --mode mock` produces a static site with no server behind it —
 * that is what is published to GitHub Pages. Everything under `src/mock/` exists
 * only for that build:
 *
 * - `library.ts` invents the song list (seeded, so links out of the demo keep
 *   working).
 * - `art.ts` draws a cover per song, since there are no chart files to read one
 *   from.
 * - `backend.ts` replaces `fetch` and `EventSource`, and runs the simulated
 *   now-playing feed.
 * - `notice.ts` says that this is a demo.
 *
 * **None of it reaches a normal build.** `vite.config.ts` defines
 * `import.meta.env.VITE_MOCK` as a literal `false` outside mock mode, so the
 * call in `main.tsx` and the branches in `lib/api.ts` are dead code that Rollup
 * removes along with every module they were the only reference to. The check is
 * `npm run build` followed by a grep of `dist/assets` for a string from this
 * folder — nothing should match.
 */

import { installMockBackend } from './backend'
import { showDemoNotice } from './notice'

// `mockArtUrl` is deliberately *not* re-exported here. `lib/api.ts` imports it
// straight from `./mock/art`, which holds nothing but pure functions and colour
// tables — going through this module would drag the simulated server into the
// import graph of a file every build compiles.

/** Stand the fake server up. Called once, before React mounts. */
export function installMock(): void {
  installMockBackend()
  showDemoNotice()
}
