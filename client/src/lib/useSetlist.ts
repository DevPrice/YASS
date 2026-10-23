/**
 * YARG's live setlist, as pushed down the event stream, which of its entries
 * this browser added, and whether it was just wiped.
 *
 * The server sends the whole setlist on every change and on every new stream,
 * so this holds the latest and never merges.
 *
 * A wipe is told twice, and the two tellings end differently. The panel's
 * cleared state is news about the last show, so it goes once the panel has
 * shown it, after `CLEARED_MS` regardless, or when songs come back. The toast's
 * notice of lost songs outlives songs coming back, because re-adding them from
 * the toast is exactly what brings them back, and the toast still has to say
 * how that went.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SetlistState } from '@shared/types'
import type { Cleared } from '../features/setlist/SetlistPanel'
import { lostToClearing, wasCleared } from '../features/setlist/model'
import { onServerEvent } from './events'
import { mineIn, pruneMine, subscribeMine } from './setlist'

/** How long "cleared" stays up in a panel nobody looks at. */
const CLEARED_MS = 3 * 60_000

const INITIAL: SetlistState = {
  link: 'unreachable',
  guestEdits: 'off',
  active: false,
  showInProgress: false,
  currentIndex: null,
  totalCount: 0,
  entries: [],
  seenAt: null,
  updatedAt: 0,
}

export interface SetlistView {
  setlist: SetlistState
  /** Entry IDs this browser added. */
  mine: ReadonlySet<number>
  /** The panel's cleared state, while it is still news. */
  cleared: Cleared | null
  /** The panel has shown that clearing and moved on; it, and its toast, are done. */
  seenCleared: (at: number) => void
  /** A clearing that took this browser's unplayed songs, until the toast is done with it. */
  lostNotice: Cleared | null
  dismissLostNotice: (at: number) => void
}

export function useSetlist(): SetlistView {
  const [setlist, setSetlist] = useState<SetlistState>(INITIAL)
  const [cleared, setCleared] = useState<Cleared | null>(null)
  const [lostNotice, setLostNotice] = useState<Cleared | null>(null)
  const [mineVersion, setMineVersion] = useState(0)
  const previous = useRef<SetlistState>(INITIAL)

  useEffect(
    () =>
      onServerEvent<SetlistState>('setlist', (next) => {
        const was = previous.current
        previous.current = next

        if (wasCleared(was, next)) {
          // Before pruning: once the wiped songs are forgotten there is no
          // telling which of them were this browser's.
          const clearing = { lost: lostToClearing(was, mineIn(was)), at: next.updatedAt }
          setCleared(clearing)
          setLostNotice(clearing.lost.length > 0 ? clearing : null)
        } else if (next.totalCount > 0) {
          setCleared(null)
        }

        pruneMine(next)
        setSetlist(next)
      }),
    [],
  )

  const seenCleared = useCallback((at: number) => {
    setCleared((current) => (current?.at === at ? null : current))
    setLostNotice((current) => (current?.at === at ? null : current))
  }, [])

  const dismissLostNotice = useCallback((at: number) => {
    setLostNotice((current) => (current?.at === at ? null : current))
  }, [])

  // One timer for both: a notice the toast never got to show (guest edits
  // were off) shouldn't surface minutes later when they come back on.
  const clearedAt = cleared?.at ?? lostNotice?.at ?? null
  useEffect(() => {
    if (clearedAt === null) return
    const timer = window.setTimeout(() => seenCleared(clearedAt), CLEARED_MS)
    return () => window.clearTimeout(timer)
  }, [clearedAt, seenCleared])

  useEffect(() => subscribeMine(() => setMineVersion((version) => version + 1)), [])

  // `mineVersion` is the dependency that matters when an add lands after the
  // event that shows it, which the server's ordering makes the usual case.
  const mine = useMemo(() => mineIn(setlist), [setlist, mineVersion])

  return { setlist, mine, cleared, seenCleared, lostNotice, dismissLostNotice }
}
