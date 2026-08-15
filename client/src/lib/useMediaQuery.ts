/**
 * Subscribes to a CSS media query.
 *
 * Used for the breakpoints CSS cannot resolve on its own: whether a song's
 * details live in a pane or in a modal sheet, and which of the two rows the
 * virtualized list is laying out. Both are decisions JavaScript has to make
 * before anything is painted — a `<dialog>` traps focus and takes the top layer
 * where a pane must do neither, so hiding one with `display:none` would leave a
 * second invisible dialog in the tree; and the virtualizer needs a row height
 * as a number before there is a layout to measure.
 *
 * Everything else in the app stays in CSS, where it belongs. Layout density is
 * a container query (how wide is the list?), touch sizing is a `pointer` query
 * (is there a mouse?), and neither needs React to know.
 */

import { useCallback, useSyncExternalStore } from 'react'

/**
 * No height to spend — a phone held sideways, or a window dragged short.
 *
 * The same 500px as the `short` variant in `index.css`, which is where the
 * reasoning lives. Exported so the three places that have to ask this in
 * JavaScript quote one number rather than three copies of it: the row shape in
 * `SongList`, the sheet's edge in `SongDetailSheet`, and the helper bar in
 * `App`. A landscape phone crossing the line has to change all three together
 * or the sort control disappears with the table header that replaced it.
 */
export const SHORT_QUERY = '(height <= 500px)'

/**
 * One `MediaQueryList` per query string, shared by every caller.
 *
 * `matchMedia` returns a fresh object each call, so without this two components
 * asking the same question would each hold their own listener — and
 * `useSyncExternalStore` would see a new snapshot source on every render.
 */
const lists = new Map<string, MediaQueryList>()

function listFor(query: string): MediaQueryList {
  const existing = lists.get(query)
  if (existing !== undefined) return existing

  const created = window.matchMedia(query)
  lists.set(query, created)
  return created
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = listFor(query)
      list.addEventListener('change', onStoreChange)
      return () => list.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  return useSyncExternalStore(subscribe, () => listFor(query).matches)
}
