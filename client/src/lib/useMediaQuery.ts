/**
 * Subscribes to a CSS media query.
 *
 * Used for the one breakpoint CSS cannot resolve on its own: whether a song's
 * details live in a pane or in a modal sheet. Those are different components
 * with different semantics — a `<dialog>` traps focus and takes the top layer,
 * a pane must do neither — so rendering both and hiding one with `display:none`
 * would leave a second, invisible dialog in the tree. The breakpoint has to
 * reach JavaScript so only one of them is ever built.
 *
 * Everything else in the app stays in CSS, where it belongs. Layout density is
 * a container query (how wide is the list?), touch sizing is a `pointer` query
 * (is there a mouse?), and neither needs React to know.
 */

import { useCallback, useSyncExternalStore } from 'react'

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
