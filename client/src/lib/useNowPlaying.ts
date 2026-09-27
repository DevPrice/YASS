/**
 * Subscribes to now-playing over the shared server event stream.
 *
 * SSE gives us automatic browser reconnection, which matters here because YARG
 * restarts, network blips, and proxy idle-timeouts are all routine. A polling
 * fallback takes over whenever the stream is down, including open but silent
 * behind a buffering proxy (see `events.ts`).
 */

import { useEffect, useRef, useState } from 'react'

import type { NowPlaying } from '@shared/types'
import { fetchNowPlaying } from './api'
import { isConnected, onConnectionChange, onServerEvent } from './events'

const POLL_FALLBACK_MS = 2000

const INITIAL: NowPlaying = { playing: false, song: null, updatedAt: 0 }

export interface NowPlayingState {
  nowPlaying: NowPlaying
  /**
   * Whether the server is reachable, not whether the stream is: behind a proxy
   * that buffers for good, polling is the connection, and a guest whose polls
   * succeed shouldn't see "offline" all night.
   */
  connected: boolean
  /**
   * False until the first answer arrives, either way.
   *
   * Without this the idle state can't tell "we've never heard from the server"
   * apart from "we heard, and nothing is playing" — and it was rendering
   * "Reconnecting to the server" to every guest before the first connection
   * had even been attempted.
   */
  settled: boolean
}

export function useNowPlaying(): NowPlayingState {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>(INITIAL)
  const [connected, setConnected] = useState(isConnected)
  const [settled, setSettled] = useState(false)

  // Held in a ref so the polling fallback can be started and cleared without
  // re-running the effect.
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    let disposed = false

    const stopPolling = () => {
      if (pollTimer.current !== null) {
        window.clearInterval(pollTimer.current)
        pollTimer.current = null
      }
    }

    const poll = () => {
      // A poll that lands after the stream is back would overwrite newer state.
      const current = () => !disposed && pollTimer.current !== null

      void fetchNowPlaying()
        .then((state) => {
          if (!current()) return
          setNowPlaying(state)
          setConnected(true)
          setSettled(true)
        })
        .catch(() => {
          if (!current()) return
          setConnected(false)
          setSettled(true)
        })
    }

    const startPolling = () => {
      if (pollTimer.current !== null) return

      pollTimer.current = window.setInterval(poll, POLL_FALLBACK_MS)
      poll()
    }

    const unsubscribeState = onServerEvent<NowPlaying>('now-playing', (next) => {
      if (disposed) return
      setNowPlaying(next)
      setSettled(true)
    })

    const unsubscribeConnection = onConnectionChange((next) => {
      if (disposed) return

      if (next) {
        setConnected(true)
        stopPolling()
      } else {
        // `connected` waits for a poll to fail, so a dropped stream on a
        // reachable server never flashes "offline".
        startPolling()
      }
    })

    return () => {
      disposed = true
      stopPolling()
      unsubscribeState()
      unsubscribeConnection()
    }
  }, [])

  return { nowPlaying, connected, settled }
}
