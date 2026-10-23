/**
 * YARG's live setlist, as pushed down the event stream, which of its entries
 * this browser added, and whether it was just wiped.
 *
 * The server sends the whole setlist on every change and on every new stream,
 * so this holds the latest and never merges.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { SetlistState } from '@shared/types'
import type { Cleared } from '../features/setlist/SetlistPanel'
import { lostToClearing, wasCleared } from '../features/setlist/model'
import { onServerEvent } from './events'
import { mineIn, pruneMine, subscribeMine } from './setlist'

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
  /** Set from the moment YARG shows a wiped setlist until songs reappear in it. */
  cleared: Cleared | null
}

export function useSetlist(): SetlistView {
  const [setlist, setSetlist] = useState<SetlistState>(INITIAL)
  const [cleared, setCleared] = useState<Cleared | null>(null)
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
          setCleared({ lost: lostToClearing(was, mineIn(was)), at: next.updatedAt })
        } else if (next.totalCount > 0) {
          setCleared(null)
        }

        pruneMine(next)
        setSetlist(next)
      }),
    [],
  )

  useEffect(() => subscribeMine(() => setMineVersion((version) => version + 1)), [])

  // `mineVersion` is the dependency that matters when an add lands after the
  // event that shows it, which the server's ordering makes the usual case.
  const mine = useMemo(() => mineIn(setlist), [setlist, mineVersion])

  return { setlist, mine, cleared }
}
