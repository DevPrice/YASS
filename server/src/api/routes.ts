/**
 * HTTP API.
 *
 * Everything is served under `/api` from the same origin as the client, so the
 * browser never needs an absolute URL and the whole thing works unchanged
 * behind a reverse proxy on a custom domain.
 */

import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { ServerStatus, SetlistEditError, Settings } from '@shared/types.js'
import { normalizeHash } from '../core/hash.js'
import type { SetlistEditResult } from '../core/setlistBridge.js'
import type { AppState } from '../state.js'
import { canFetchFfmpeg, FFMPEG_INSTALL_HINT } from '../media/ffmpeg.js'
import { isArtSize } from '../media/store.js'
import { serveFile } from '../static.js'
import { isLocalRequest, localOnly } from './local.js'

/** Heartbeat interval for the SSE stream, to keep proxies from idling it out. */
const SSE_KEEPALIVE_MS = 15_000

/**
 * HTTP status for each way a setlist edit can be refused.
 *
 * 409 for "the setlist is not in a state that allows this" and 503 for "YARG
 * can't take edits right now", so a client can tell "change what you asked"
 * from "ask again in a moment" without reading the code.
 */
const SETLIST_ERROR_STATUS: Record<SetlistEditError, 400 | 404 | 409 | 502 | 503 | 504> = {
  invalid: 400,
  unknown_song: 404,
  not_found: 404,
  duplicate: 409,
  locked: 409,
  full: 409,
  conflict: 409,
  busy: 503,
  unavailable: 503,
  failed: 502,
  timeout: 504,
}

/** An optional non-negative integer from a body or query, or `undefined`; `false` when present but malformed. */
function optionalIndex(raw: unknown): number | undefined | false {
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = typeof raw === 'string' ? Number(raw) : raw
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : false
}

/** The address this process listens on, which no amount of saving can change. */
export interface Binding {
  host: string
  port: number
}

export function createApiRoutes(state: AppState, binding: Binding): Hono {
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

  /**
   * Everything the tray's popover shows about the running server.
   *
   * Host-only, like the settings endpoints: the song count is harmless, but the
   * bound address is the tray's own business and this sits beside `/settings`
   * in what it is for.
   */
  api.get('/status', localOnly, (c) => {
    c.header('Cache-Control', 'no-store')

    const media = state.media.status

    const status: ServerStatus = {
      songs: state.library.meta,
      host: binding.host,
      port: binding.port,
      restartRequired: state.bindingChanged(state.settingsView, binding.host, binding.port),
      media: {
        // A boolean, not the path: the tray asks "does this work", and the
        // location of the binary is one more absolute path with nowhere to be.
        ffmpeg: media.ffmpeg !== null,
        canFetchFfmpeg: canFetchFfmpeg(),
        charts: media.charts,
        source: state.charts.meta.source,
        precomputing: media.precomputing,
        precomputed: media.precomputed,
        precomputeTotal: media.precomputeTotal,
      },
    }

    return c.json(status)
  })

  // --- Media -----------------------------------------------------------------
  //
  // Host-only, like the settings endpoints. Both of these spend real resources
  // on the host's machine — a 110 MB download and a rescan of the library — and
  // neither is something a guest browsing on their phone should be able to
  // start.

  /**
   * Rebuild the chart index from `songcache.bin`, or by scanning.
   *
   * The server watches the cache file and rebuilds on its own, so this is the
   * manual override for the case the watcher can't see: songs added to a folder
   * YARG has not rescanned yet.
   */
  api.post('/media/reindex', localOnly, async (c) => {
    return c.json(await state.rebuildChartIndex(true))
  })

  /**
   * Download ffmpeg into the app's own directory.
   *
   * Long-running by nature — it is a 110 MB download — so the tray's request
   * carries no timeout and the response is the outcome, not progress. There is
   * exactly one of these at a time; a second caller joins the first.
   */
  api.post('/media/ffmpeg', localOnly, async (c) => {
    // 501 rather than 500: there is nothing wrong here and retrying will not
    // help. This platform has no build to fetch, and the message says what to
    // do instead.
    if (!canFetchFfmpeg()) {
      return c.json({ ok: false, error: FFMPEG_INSTALL_HINT }, 501)
    }

    try {
      const path = await state.installFfmpeg()
      return c.json({ ok: true, installed: path !== null })
    } catch (error) {
      console.error('[media] ffmpeg install failed:', error)
      return c.json({ ok: false, error: String(error) }, 500)
    }
  })

  // --- Library ------------------------------------------------------------

  api.get('/songs', (c) => {
    const library = state.library

    /*
     * Cheap revalidation, keyed on everything that can change the payload.
     *
     * The song cache's own identity is not enough. `hasArt` and `hasPreview` are
     * stamped onto each song from the chart index, which is built *after* the
     * library loads and rebuilt whenever YARG rescans — so a browser that
     * fetched the list during the second before the index landed would
     * revalidate, get a 304, and hold a library where every song says it has no
     * cover. The whole list would stay grey until something forced a reload.
     *
     * `builtAt` moves on every rebuild, including ones that changed nothing.
     * That costs an occasional re-download of a payload the client asked to
     * revalidate anyway, which is the right side to be wrong on.
     */
    const media = state.charts.meta
    const etag = `W/"songs-${library.meta.generatedAt ?? 0}-${library.meta.count}-${media.builtAt}-${media.count}"`
    if (c.req.header('if-none-match') === etag) {
      return c.body(null, 304)
    }

    c.header('ETag', etag)
    c.header('Cache-Control', 'no-cache')
    return c.json(library)
  })

  /**
   * Force a re-read of the song cache.
   *
   * Host-only. The server watches the file and reloads on its own, so this is
   * a manual override for the host and the tray process — not something a
   * guest browsing on their phone should be able to trigger on the host's
   * machine.
   */
  api.post('/songs/reload', localOnly, async (c) => {
    return c.json(await state.reloadLibrary())
  })

  // --- Connected browsers ---------------------------------------------------

  /**
   * Tell every open page to reload itself.
   *
   * Host-only, and the reason it has to be: this reaches into a phone in
   * somebody else's hand. It is the tray's escape hatch for the party case
   * where a guest's tab has been open for hours and is showing something the
   * app can no longer talk it out of.
   */
  api.post('/clients/reload', localOnly, (c) => {
    state.broadcastReload()
    return c.json({ ok: true })
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
   *   `library`      just the metadata, when YARG rescans; the
   *                  client refetches `/api/songs` conditionally
   *   `venue`        YARG's stage lighting, at most twice a second
   *   `setlist`      YARG's setlist, on every change; only ever
   *                  `available: true` with the Setlist Bridge plugin
   *   `reload`       the host, via the tray, asking this page to reload
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
      await send('setlist', state.setlist.current)

      const unsubscribeNowPlaying = state.watcher.subscribe((next) => {
        void send('now-playing', next)
      })

      const unsubscribeLibrary = state.subscribeLibrary((meta) => {
        void send('library', meta)
      })

      const unsubscribeVenue = state.venue.subscribe((next) => {
        void send('venue', next)
      })

      const unsubscribeSetlist = state.setlist.subscribe((next) => {
        void send('setlist', next)
      })

      // The instruction is the whole message, but SSE frames still need a body
      // the client can `JSON.parse`, so send the timestamp it happened at.
      const unsubscribeReload = state.subscribeReload(() => {
        void send('reload', { at: Date.now() })
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
        unsubscribeSetlist()
        unsubscribeReload()
      }
    })
  })

  // --- Setlist ------------------------------------------------------------

  /**
   * YARG's setlist, when the Setlist Bridge plugin is running in the game.
   *
   * Always answers: `available: false` is the normal reply for a host without
   * the plugin, not an error.
   */
  api.get('/setlist', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(state.setlist.current)
  })

  /*
   * Editing the setlist.
   *
   * Open to everyone on the network, not host-only like settings: queueing songs
   * from a phone is the point, and at a party the host is the person least likely
   * to be holding one. Nothing here reveals a path or repoints the app — the worst
   * a guest can do is what any guest at the console could do too.
   *
   * Each route answers once YARG has taken or refused the edit. The new setlist
   * itself arrives over `/events` like every other change, so a client never has
   * to merge a response into what it is showing.
   *
   * `version` is the setlist version the caller was looking at. Send it with any
   * edit that depends on positions; if the setlist has moved on, the edit fails
   * with `conflict` instead of landing somewhere the caller didn't mean.
   */
  const reply = (c: Context, result: SetlistEditResult) =>
    result.ok
      ? c.json({ ok: true })
      : c.json({ ok: false, error: result.code }, SETLIST_ERROR_STATUS[result.code])

  const invalid = (c: Context) => c.json({ ok: false, error: 'invalid' }, 400)

  /** Add a song: `{ hash, index?, version? }`. Without `index`, it goes at the end. */
  api.post('/setlist/songs', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const hash = normalizeHash(typeof body?.hash === 'string' ? body.hash : null)
    const index = optionalIndex(body?.index)
    const version = optionalIndex(body?.version)
    if (hash === null || index === false || version === false) return invalid(c)

    return reply(c, await state.setlist.edit({ type: 'add', hash, index, version }))
  })

  /** Move a song so it ends up at `index`: `{ index, version? }`. */
  api.put('/setlist/songs/:hash/position', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    const hash = normalizeHash(c.req.param('hash'))
    const index = optionalIndex(body?.index)
    const version = optionalIndex(body?.version)
    if (hash === null || index === undefined || index === false || version === false) return invalid(c)

    return reply(c, await state.setlist.edit({ type: 'move', hash, index, version }))
  })

  /** Remove one song. `?version=` optional. */
  api.delete('/setlist/songs/:hash', async (c) => {
    const hash = normalizeHash(c.req.param('hash'))
    const version = optionalIndex(c.req.query('version'))
    if (hash === null || version === false) return invalid(c)

    return reply(c, await state.setlist.edit({ type: 'remove', hash, version }))
  })

  /** Remove every song that can be removed: all of them before a show, the ones not yet played during one. */
  api.delete('/setlist/songs', async (c) => {
    const version = optionalIndex(c.req.query('version'))
    if (version === false) return invalid(c)

    return reply(c, await state.setlist.edit({ type: 'clear', version }))
  })

  // --- Album art ----------------------------------------------------------

  /**
   * Album art for the currently playing song.
   *
   * Reads the file next to the chart directly rather than going through the
   * media cache, because this route predates the chart index and still works
   * when there isn't one — no ffmpeg, no derived thumbnail, just the bytes
   * YARG is looking at. `/art/:hash` is the route for everything else.
   */
  api.get('/art/current', async (c) => {
    const art = state.watcher.currentArt
    if (!art) return c.body(null, 404)

    // Identity is the file itself, so a strong ETag lets the browser hold the
    // image across song changes and back again with a cheap 304.
    const response = await serveFile(c, art.path, {
      contentType: art.contentType,
      etag: `"art-${art.mtimeMs}-${art.size}"`,
    })

    return response ?? c.body(null, 404)
  })

  /**
   * Album art for any song in the library, by hash.
   *
   * `size=sm` is a 256px thumbnail, precomputed for the whole library after
   * startup; `size=lg` is 640px and made the first time a song is opened. Both
   * are derived on demand if they are missing, so a cold cache costs the first
   * viewer a second rather than costing everyone a blank list.
   *
   * A 404 here is ordinary and expected: no chart on disk for that hash, no
   * cover inside it, or no ffmpeg to resize with. The client already knows how
   * to draw a song without a cover — it did that for every song until now.
   */
  api.get('/art/:hash', async (c) => {
    const requested = c.req.query('size') ?? 'sm'
    if (!isArtSize(requested)) {
      return c.json({ error: 'size must be sm or lg.' }, 400)
    }

    const path = await state.media.artFile(c.req.param('hash'), requested)
    if (path === null) return c.body(null, 404)

    /*
     * `immutable`, and honestly so.
     *
     * Unlike a Vite asset URL, where the hash is a fingerprint of a build, here
     * the hash *is* the identity of the chart and the size is the identity of
     * the rendering. The same URL cannot come to mean a different picture — a
     * re-charted song is a different SHA-1 and therefore a different URL.
     *
     * `private`, because this is one person's local library, possibly behind
     * their own reverse proxy, and none of it should land in a shared cache.
     */
    const response = await serveFile(c, path, { immutable: true, privateCache: true })
    return response ?? c.body(null, 404)
  })

  // --- Previews -------------------------------------------------------------

  /**
   * About thirty seconds of a song, as Opus.
   *
   * Generated on first request and cached forever after, so the first person to
   * open a song waits roughly a second and nobody else does. The client hides
   * even that by prefetching with a `HEAD` as soon as a song is selected.
   *
   * **Range support is load-bearing here.** iOS Safari refuses to play an
   * `<audio>` source from a server that answers a range request with a `200`,
   * so `serveFile` handles `Range`, `206` and `416` — see `static.ts`.
   */
  api.get('/preview/:hash', async (c) => {
    const path = await state.media.previewFile(c.req.param('hash'))
    if (path === null) return c.body(null, 404)

    // Same reasoning as art: the hash is the content key, so this URL can never
    // come to mean different audio.
    const response = await serveFile(c, path, {
      immutable: true,
      privateCache: true,
      contentType: 'audio/ogg',
    })

    return response ?? c.body(null, 404)
  })

  // --- Settings -------------------------------------------------------------
  //
  // Host-only. These responses carry absolute filesystem paths, which name the
  // user's account, and the PUT repoints the whole app — neither belongs on a
  // LAN-facing surface a room full of people is browsing.

  api.get('/settings', localOnly, (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(state.settingsView)
  })

  api.put('/settings', localOnly, async (c) => {
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
