/**
 * Subscribes to now-playing over SSE.
 *
 * SSE gives us automatic browser reconnection, which matters here because YARG
 * restarts, network blips, and proxy idle-timeouts are all routine. A polling
 * fallback kicks in only if the stream can't be established at all.
 */

import { useEffect, useRef, useState } from 'react'

import type { NowPlaying } from '@shared/types'
import { fetchNowPlaying } from './api'

const POLL_FALLBACK_MS = 2000

const INITIAL: NowPlaying = { playing: false, song: null, updatedAt: 0 }

export interface NowPlayingState {
  nowPlaying: NowPlaying
  /** False while the stream is down and we're falling back to polling. */
  connected: boolean
}

export function useNowPlaying(): NowPlayingState {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>(INITIAL)
  const [connected, setConnected] = useState(false)

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
            if (!disposed) setNowPlaying(state)
          })
          .catch(() => {
            /* Server down; the next tick retries. */
          })
      }, POLL_FALLBACK_MS)
    }

    const source = new EventSource('/api/now-playing/stream')

    source.addEventListener('open', () => {
      if (disposed) return
      setConnected(true)
      stopPolling()
    })

    source.addEventListener('now-playing', (event) => {
      if (disposed) return
      try {
        setNowPlaying(JSON.parse((event as MessageEvent<string>).data) as NowPlaying)
        setConnected(true)
      } catch {
        /* Ignore a malformed frame rather than tearing down the stream. */
      }
    })

    source.addEventListener('error', () => {
      if (disposed) return
      // EventSource reconnects on its own; poll meanwhile so the UI stays live.
      setConnected(false)
      startPolling()
    })

    return () => {
      disposed = true
      stopPolling()
      source.close()
    }
  }, [])

  return { nowPlaying, connected }
}
