/**
 * YARG's setlist, over the shared server event stream.
 *
 * Only ever `available` when the host runs the YARG Setlist Bridge plugin, so
 * every consumer has to treat the unavailable state as the normal one and draw
 * nothing for it.
 *
 * No polling fallback, unlike now-playing: this is a nicety layered onto the
 * banner, and while the stream is down the banner already says so.
 */

import { useEffect, useState } from 'react'

import type { Setlist } from '@shared/types'
import { onServerEvent } from './events'

const UNAVAILABLE: Setlist = { available: false, mode: 'idle', index: null, songs: [], updatedAt: 0 }

export function useSetlist(): Setlist {
  const [setlist, setSetlist] = useState<Setlist>(UNAVAILABLE)

  useEffect(() => onServerEvent<Setlist>('setlist', setSetlist), [])

  return setlist
}
