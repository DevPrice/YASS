/**
 * The key check for tunnel traffic, and the first thing every request meets.
 *
 * Mounted ahead of the API and the static client in `index.ts`, so nothing —
 * not the song list, not a cover, not `index.html` — is served over the tunnel
 * to a caller without the key. LAN and loopback requests pass straight through:
 * the tunnel is what is public, and the LAN keeps working exactly as it did.
 *
 * ## Which requests are tunnel requests
 *
 * The ones that arrived on the tunnel's own listener — see `viaTunnel` in
 * `api/local.ts` and the reasoning in `tunnel.ts`. Never decided by headers.
 *
 * ## Query first, then a cookie
 *
 * The guest's first request carries `?key=…` from the QR code. It is answered
 * with an HttpOnly cookie and a redirect to the same address without the key,
 * so the key does not sit in the address bar, in the history, in a screenshot
 * somebody posts, or in a `Referer` sent to a third-party image host. Every
 * request after that — the API, the covers, the audio element's range
 * requests — rides on the cookie, because they are same-origin.
 *
 * A wrong or missing key gets the same bare 404 as any path that does not
 * exist, for the reason `api/local.ts` gives: "forbidden" confirms there is
 * something worth probing.
 */

import { createHash, timingSafeEqual } from 'node:crypto'

import type { MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

import { viaTunnel } from '../api/local.js'

export const KEY_PARAM = 'key'
export const KEY_COOKIE = 'yass_key'

/**
 * A party, not a week. The key rotates on every server start regardless, so
 * this only bounds a phone that stays in somebody's pocket after they leave.
 */
const COOKIE_MAX_AGE_S = 24 * 60 * 60

/** Compare without leaking how much of the key matched, through timing. */
function matches(candidate: string | undefined, key: string): boolean {
  if (candidate === undefined || candidate.length === 0) return false

  // Hashing first makes the lengths equal, which `timingSafeEqual` requires.
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(candidate), digest(key))
}

export function tunnelGate(currentKey: () => string): MiddlewareHandler {
  return async (c, next) => {
    if (!viaTunnel(c)) {
      await next()
      return
    }

    const key = currentKey()
    const offered = c.req.query(KEY_PARAM)

    if (matches(offered, key)) {
      setCookie(c, KEY_COOKIE, key, {
        path: '/',
        httpOnly: true,
        // The tunnel is always HTTPS at Cloudflare's edge, which is what the
        // guest's browser sees, whatever the hop to this listener is.
        secure: true,
        sameSite: 'Lax',
        maxAge: COOKIE_MAX_AGE_S,
      })

      if (c.req.method === 'GET' || c.req.method === 'HEAD') {
        const clean = new URL(c.req.url)
        clean.searchParams.delete(KEY_PARAM)
        // Relative, because the host this listener sees is 127.0.0.1 and the
        // one the guest typed is Cloudflare's.
        c.header('Cache-Control', 'no-store')
        return c.redirect(`${clean.pathname}${clean.search}`, 302)
      }

      await next()
      return
    }

    if (matches(getCookie(c, KEY_COOKIE), key)) {
      await next()
      return
    }

    c.header('Cache-Control', 'no-store')
    return c.text('Not found', 404)
  }
}
