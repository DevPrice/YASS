/**
 * Loads the song library once and exposes a manual reload.
 *
 * The whole index is fetched up front and filtered client-side: ~3,400 songs is
 * a few MB of JSON, and doing it in the browser makes search and sort instant
 * with no round trip per keystroke.
 */

import { useCallback, useEffect, useState } from 'react'

import type { SongLibrary } from '@shared/types'
import { fetchLibrary, reloadLibrary } from './api'

export interface LibraryState {
  library: SongLibrary | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function useLibrary(): LibraryState {
  const [library, setLibrary] = useState<SongLibrary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (fresh: boolean) => {
    setLoading(true)
    setError(null)

    try {
      setLibrary(fresh ? await reloadLibrary() : await fetchLibrary())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const reload = useCallback(() => load(true), [load])

  return { library, loading, error, reload }
}
