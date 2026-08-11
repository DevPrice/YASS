/**
 * "Is this request from the machine running the server?"
 *
 * Configuration is host-only: it exposes absolute filesystem paths (which leak
 * the user's account name) and lets the caller repoint the app. Nobody browsing
 * from a phone should see or change it.
 *
 * The reverse-proxy case is the whole difficulty. A proxy connects over
 * loopback, so remote-address alone reports every LAN visitor as local — it
 * fails *open*, which is the wrong direction. Any sign of a proxy hop therefore
 * counts as remote, even though that also hides settings from a host browsing
 * through its own domain. Losing access on the host is recoverable; exposing
 * configuration to the party is not.
 */

import type { Context, MiddlewareHandler } from 'hono'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** Headers a proxy adds. Any of them means the request was forwarded. */
const PROXY_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
]

/** Dig the peer address out of the Node request @hono/node-server exposes. */
function remoteAddress(c: Context): string | null {
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming

  return incoming?.socket?.remoteAddress ?? null
}

export function isLocalRequest(c: Context): boolean {
  for (const header of PROXY_HEADERS) {
    if (c.req.header(header)) return false
  }

  const address = remoteAddress(c)
  if (!address) return false

  return LOOPBACK.has(address)
}

/**
 * 404 rather than 403 for remote callers — a "forbidden" reply confirms there
 * is a settings endpoint worth probing.
 */
export function requireLocal(c: Context): Response | null {
  return isLocalRequest(c) ? null : c.json({ error: 'Not found' }, 404)
}

/**
 * `requireLocal` as middleware, which is the form these routes want.
 *
 * Passing `requireLocal` itself to `app.post(path, …)` looks like it works and
 * does not: returning `null` for an allowed request neither finalizes the
 * context nor calls `next()`, so Hono raises "Context is not finalized" and
 * every *permitted* caller gets a 500 while blocked ones get their 404. The
 * guard has to hand control on explicitly.
 */
export const localOnly: MiddlewareHandler = async (c, next) => {
  const denied = requireLocal(c)
  if (denied) return denied

  await next()
}
