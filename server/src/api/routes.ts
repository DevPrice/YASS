/**
 * HTTP API.
 *
 * Everything is served under `/api` from the same origin as the client, so the
 * browser never needs an absolute URL and the whole thing works unchanged
 * behind a reverse proxy on a custom domain.
 */

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { Settings } from '@shared/types.js'
import type { AppState } from '../state.js'

/** Heartbeat interval for the SSE stream, to keep proxies from idling it out. */
const SSE_KEEPALIVE_MS = 15_000

export function createApiRoutes(state: AppState): Hono {
  const api = new Hono()

  api.get('/health', (c) => c.json({ ok: true }))

  // --- Library ------------------------------------------------------------

  api.get('/songs', (c) => {
    const library = state.library

    // The index only changes when the CSV is reloaded, so let the browser
    // revalidate cheaply rather than re-downloading a few MB of JSON.
    const etag = `W/"songs-${library.meta.generatedAt ?? 0}-${library.meta.count}"`
    if (c.req.header('if-none-match') === etag) {
      return c.body(null, 304)
    }

    c.header('ETag', etag)
    c.header('Cache-Control', 'no-cache')
    return c.json(library)
  })

  api.post('/songs/reload', async (c) => {
    return c.json(await state.reloadLibrary())
  })

  // --- Now playing --------------------------------------------------------

  api.get('/now-playing', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(state.watcher.current)
  })

  /**
   * Server-sent events for now-playing changes.
   *
   * SSE rather than WebSockets: the data flows one way, it survives reverse
   * proxies with no upgrade handshake, and the browser reconnects on its own.
   */
  api.get('/now-playing/stream', (c) => {
    c.header('Cache-Control', 'no-store')
    // Tell nginx not to buffer, or events arrive in bursts.
    c.header('X-Accel-Buffering', 'no')

    return streamSSE(c, async (stream) => {
      let open = true
      stream.onAbort(() => {
        open = false
      })

      const send = async (data: unknown) => {
        if (!open) return
        await stream.writeSSE({ event: 'now-playing', data: JSON.stringify(data) })
      }

      // Send current state immediately so a fresh client isn't blank until the
      // next song change.
      await send(state.watcher.current)

      const unsubscribe = state.watcher.subscribe((next) => {
        void send(next)
      })

      try {
        while (open) {
          await stream.sleep(SSE_KEEPALIVE_MS)
          if (!open) break
          await stream.writeSSE({ event: 'ping', data: '' })
        }
      } finally {
        unsubscribe()
      }
    })
  })

  // --- Album art ----------------------------------------------------------

  /**
   * Album art for the currently playing song.
   *
   * Only `.ini` charts expose art as a sibling file; packed containers 404 and
   * the client falls back to a placeholder.
   */
  api.get('/art/current', (c) => {
    const art = state.watcher.currentArt
    if (!art) return c.body(null, 404)

    // Identity is the file itself, so a strong ETag lets the browser hold the
    // image across song changes and back again with a cheap 304.
    const etag = `"art-${art.mtimeMs}-${art.size}"`
    if (c.req.header('if-none-match') === etag) {
      return c.body(null, 304)
    }

    c.header('ETag', etag)
    c.header('Content-Type', art.contentType)
    c.header('Content-Length', String(art.size))
    // Private: this is one user's local library behind their own proxy.
    c.header('Cache-Control', 'private, max-age=3600, must-revalidate')

    if (c.req.method === 'HEAD') return c.body(null, 200)

    return c.body(Readable.toWeb(createReadStream(art.path)) as ReadableStream)
  })

  // --- Settings -----------------------------------------------------------

  api.get('/settings', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(state.settingsView)
  })

  api.put('/settings', async (c) => {
    let patch: Partial<Settings>
    try {
      patch = (await c.req.json()) as Partial<Settings>
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400)
    }

    if (!patch || typeof patch !== 'object') {
      return c.json({ error: 'Body must be a settings object.' }, 400)
    }

    try {
      return c.json(await state.updateSettings(patch))
    } catch (err) {
      console.error('[settings] save failed:', err)
      return c.json({ error: 'Could not save settings.' }, 500)
    }
  })

  return api
}
