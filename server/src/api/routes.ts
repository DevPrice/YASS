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
import { isLocalRequest, requireLocal } from './local.js'

/** Heartbeat interval for the SSE stream, to keep proxies from idling it out. */
const SSE_KEEPALIVE_MS = 15_000

export function createApiRoutes(state: AppState): Hono {
  const api = new Hono()

  api.get('/health', (c) => c.json({ ok: true }))

  /**
   * What this caller is allowed to do.
   *
   * The client asks first so it can decide whether to render a settings tab at
   * all, rather than showing one that 404s.
   */
  api.get('/capabilities', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ settings: isLocalRequest(c) })
  })

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

  /**
   * Force a re-read of the CSV.
   *
   * Host-only. The server watches the file and reloads on its own, so this is
   * a manual override for the host and the tray process — not something a
   * guest browsing on their phone should be able to trigger on the host's
   * machine.
   */
  api.post('/songs/reload', requireLocal, async (c) => {
    return c.json(await state.reloadLibrary())
  })

  // --- Now playing --------------------------------------------------------

  api.get('/now-playing', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(state.watcher.current)
  })

  /**
   * The live channel.
   *
   * SSE rather than WebSockets: the data flows one way, it survives reverse
   * proxies with no upgrade handshake, and the browser reconnects on its own.
   *
   * Several event types share one connection, because a phone on LAN Wi-Fi
   * holding a socket per topic is a worse trade than one stream with a
   * discriminator:
   *
   *   `now-playing`  full NowPlaying state, on every change
   *   `library`      just the metadata, when the CSV is re-exported; the
   *                  client refetches `/api/songs` conditionally
   *   `venue`        YARG's stage lighting, at most twice a second
   *   `ping`         keepalive, so idle proxies don't hang up
   */
  api.get('/events', (c) => {
    c.header('Cache-Control', 'no-store')
    // Tell nginx not to buffer, or events arrive in bursts.
    c.header('X-Accel-Buffering', 'no')

    return streamSSE(c, async (stream) => {
      let open = true
      stream.onAbort(() => {
        open = false
      })

      const send = async (event: string, data: unknown) => {
        if (!open) return
        await stream.writeSSE({ event, data: JSON.stringify(data) })
      }

      // Send current state immediately so a fresh client isn't blank until the
      // next song change.
      await send('now-playing', state.watcher.current)
      await send('venue', state.venue.current)

      const unsubscribeNowPlaying = state.watcher.subscribe((next) => {
        void send('now-playing', next)
      })

      const unsubscribeLibrary = state.subscribeLibrary((meta) => {
        void send('library', meta)
      })

      const unsubscribeVenue = state.venue.subscribe((next) => {
        void send('venue', next)
      })

      try {
        while (open) {
          await stream.sleep(SSE_KEEPALIVE_MS)
          if (!open) break
          await stream.writeSSE({ event: 'ping', data: '' })
        }
      } finally {
        unsubscribeNowPlaying()
        unsubscribeLibrary()
        unsubscribeVenue()
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

  // --- Settings -------------------------------------------------------------
  //
  // Host-only. These responses carry absolute filesystem paths, which name the
  // user's account, and the PUT repoints the whole app — neither belongs on a
  // LAN-facing surface a room full of people is browsing.

  api.get('/settings', (c) => {
    const denied = requireLocal(c)
    if (denied) return denied

    c.header('Cache-Control', 'no-store')
    return c.json(state.settingsView)
  })

  api.put('/settings', async (c) => {
    const denied = requireLocal(c)
    if (denied) return denied

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
