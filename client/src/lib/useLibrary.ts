/**
 * Loads the song library, and reloads it when the server says the CSV moved.
 *
 * The whole index is fetched up front and filtered client-side: ~4,000 songs is
 * a few MB of JSON, and doing it in the browser makes search and sort instant
 * with no round trip per keystroke.
 *
 * There is no reload button. YARG only writes the CSV when someone picks
 * Settings → Export Songs List, so the server watches that file and pushes a
 * `library` event when it changes; nobody at a party should have to know the
 * list is stale, let alone press something about it.
 */

import { useCallback, useEffect, useState } from 'react'

import type { LibraryMeta, SongLibrary } from '@shared/types'
import { fetchLibrary } from './api'
import { onServerEvent } from './events'

export interface LibraryState {
  library: SongLibrary | null
  loading: boolean
  error: string | null
  /** Re-fetch now. Conditional, so an unchanged list costs a 304. */
  refresh: () => Promise<void>
}

export function useLibrary(): LibraryState {
  const [library, setLibrary] = useState<SongLibrary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setLibrary(await fetchLibrary())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    // The event carries only metadata; the list itself comes back over the
    // conditional GET, so a spurious notification is nearly free.
    return onServerEvent<LibraryMeta>('library', () => {
      void load()
    })
  }, [load])

  return { library, loading, error, refresh: load }
}
