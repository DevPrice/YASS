/**
 * Subscribes to now-playing over the shared server event stream.
 *
 * SSE gives us automatic browser reconnection, which matters here because YARG
 * restarts, network blips, and proxy idle-timeouts are all routine. A polling
 * fallback kicks in only if the stream can't be established at all.
 */

import { useEffect, useRef, useState } from 'react'

import type { NowPlaying } from '@shared/types'
import { fetchNowPlaying } from './api'
import { isConnected, onConnectionChange, onServerEvent } from './events'

const POLL_FALLBACK_MS = 2000

const INITIAL: NowPlaying = { playing: false, song: null, updatedAt: 0 }

export interface NowPlayingState {
  nowPlaying: NowPlaying
  /** False while the stream is down and we're falling back to polling. */
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

    const startPolling = () => {
      if (pollTimer.current !== null) return

      pollTimer.current = window.setInterval(() => {
        void fetchNowPlaying()
          .then((state) => {
            if (disposed) return
            setNowPlaying(state)
            setSettled(true)
          })
          .catch(() => {
            /* Server down; the next tick retries. */
          })
      }, POLL_FALLBACK_MS)
    }

    const unsubscribeState = onServerEvent<NowPlaying>('now-playing', (next) => {
      if (disposed) return
      setNowPlaying(next)
      setSettled(true)
    })

    const unsubscribeConnection = onConnectionChange((next) => {
      if (disposed) return
      setConnected(next)

      if (next) {
        stopPolling()
      } else {
        // EventSource reconnects on its own; poll meanwhile so the UI stays live.
        setSettled(true)
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
