/**
 * HTTP API.
 *
 * Everything is served under `/api` from the same origin as the client, so the
 * browser never needs an absolute URL and the whole thing works unchanged
 * behind a reverse proxy on a custom domain.
 */

import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'

import type {
  ServerStatus,
  SetlistEditResult,
  SetlistPlacement,
  Settings,
} from '@shared/types.js'
import { normalizeHash } from '../core/hash.js'
import { isGuestToken } from '../core/setlist.js'
import type { AppState } from '../state.js'
import { canFetchFfmpeg, FFMPEG_INSTALL_HINT } from '../media/ffmpeg.js'
import { isArtSize } from '../media/store.js'
import { serveFile } from '../static.js'
import { isLocalRequest, localOnly } from './local.js'

/**
 * Heartbeat interval for the SSE stream, to keep proxies from idling it out.
 * `STALL_MS` in `client/src/lib/events.ts` is a multiple of this; change them
 * together.
 */
const SSE_KEEPALIVE_MS = 15_000

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
    const { entries: _entries, ...setlist } = state.setlist.current

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
      setlist,
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
     *
     * YARG's own settings are in it for the same reason: toggling censorship or
     * the Genrelizer rewrites every rating or genre in the payload without
     * touching the cache file, and a 304 then would strand phones on the old
     * ones.
     */
    const media = state.charts.meta
    const yarg = `${state.previewMix}-${state.yargSettings.genrelizer}`
    const etag = `W/"songs-${library.meta.generatedAt ?? 0}-${library.meta.count}-${media.builtAt}-${media.count}-${yarg}"`
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
   * YARG's live setlist.
   *
   * Open to everyone, unlike the settings: it carries song hashes and titles,
   * which every phone already has, and `link`, which names a state rather than
   * a path.
   */
  api.get('/setlist', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(state.setlist.current)
  })

  /*
   * Editing it, from a phone.
   *
   * Each answers with a `SetlistEditResult` only after the setlist event that
   * shows the change has gone out, so a phone never hears "added" ahead of the
   * list it was added to. Who may do what is `core/setlist.ts`'s business.
   *
   * **The guest header is also the CSRF guard.** A page on another origin can't
   * send a custom header without a CORS preflight, and nothing here answers
   * one, so a hostile site open on a guest's phone can't queue songs through
   * it. That is why the token rides a header and never a cookie.
   */

  api.post('/setlist/entries', async (c) => {
    const guest = c.req.header(GUEST_HEADER)
    if (!isGuestToken(guest)) return c.json({ error: GUEST_HEADER_HINT }, 400)

    const body = await readJson(c)
    const hash = normalizeHash(typeof body?.hash === 'string' ? body.hash : null)
    if (hash === null) return c.json({ error: 'Body must name a song hash.' }, 400)

    return editResponse(c, await state.setlist.add(guest, hash))
  })

  api.delete('/setlist/entries/:id', async (c) => {
    const guest = c.req.header(GUEST_HEADER)
    if (!isGuestToken(guest)) return c.json({ error: GUEST_HEADER_HINT }, 400)

    const entryId = parseEntryId(c.req.param('id'))
    if (entryId === null) return c.json({ error: 'Not an entry ID.' }, 400)

    return editResponse(c, await state.setlist.remove(guest, entryId))
  })

  api.post('/setlist/entries/:id/move', async (c) => {
    const guest = c.req.header(GUEST_HEADER)
    if (!isGuestToken(guest)) return c.json({ error: GUEST_HEADER_HINT }, 400)

    const entryId = parseEntryId(c.req.param('id'))
    if (entryId === null) return c.json({ error: 'Not an entry ID.' }, 400)

    const placement = parsePlacement(await readJson(c))
    if (placement === null) {
      return c.json({ error: 'Body must be {position: start|end} or {position: after, anchorId}.' }, 400)
    }

    return editResponse(c, await state.setlist.move(guest, entryId, placement))
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
   *   `setlist`      YARG's whole setlist, on every change; never a diff
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
   * Generated on first request and kept on disk after, so the first person to
   * open a song waits roughly a second and nobody else does.
   *
   * **Range support is load-bearing here.** iOS Safari refuses to play an
   * `<audio>` source from a server that answers a range request with a `200`,
   * so `serveFile` handles `Range`, `206` and `416` — see `static.ts`.
   *
   * **Revalidated, not `immutable`, unlike art.** The hash does not decide the
   * audio on its own: YARG's censorship setting does too, and the host can flip
   * it mid-party. One URL whose answer the server picks is the only shape a
   * phone cannot get wrong. A URL per mix, cached for a year, would let a phone
   * that missed the library event — a dropped stream, a sleeping tab — keep
   * playing the uncensored file straight out of its own cache, with nothing on
   * the server able to stop it. The price is one conditional request per play,
   * answered `304` on a LAN. Each mix is its own file, so the default
   * `mtime-size` ETag already tells them apart.
   */
  api.get('/preview/:hash', async (c) => {
    const path = await state.media.previewFile(c.req.param('hash'), state.previewMix)
    if (path === null) return c.body(null, 404)

    const response = await serveFile(c, path, {
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

const GUEST_HEADER = 'x-yass-guest'
const GUEST_HEADER_HINT = 'Send X-YASS-Guest: a random token this browser keeps.'

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json()
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** YARG's IDs are u32 and start at 1. */
function parseEntryId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null
  const id = Number(raw)
  return id >= 1 && id <= 0xffffffff ? id : null
}

function parsePlacement(body: Record<string, unknown> | null): SetlistPlacement | null {
  if (body?.position === 'start' || body?.position === 'end') return { position: body.position }

  if (body?.position === 'after' && typeof body.anchorId === 'number') {
    const anchorId = parseEntryId(String(body.anchorId))
    return anchorId === null ? null : { position: 'after', anchorId }
  }

  return null
}

/**
 * The HTTP status for an edit's outcome.
 *
 * The body says what happened either way; the status is for anything between
 * here and the phone that only reads that. 409 for YARG declining on the
 * setlist's own terms, 403 for YASS declining on the host's, 503 for no YARG
 * to ask.
 */
function editResponse(c: Context, result: SetlistEditResult): Response {
  c.header('Cache-Control', 'no-store')
  if (result.ok) return c.json(result, 200)

  switch (result.reason) {
    case 'editsOff':
    case 'notYours':
      return c.json(result, 403)
    case 'unavailable':
    case 'connectionLost':
      return c.json(result, 503)
    case 'failed':
      return c.json(result, 502)
    default:
      return c.json(result, 409)
  }
}
