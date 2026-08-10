/**
 * Static file serving for the built client.
 *
 * Deliberately not `@hono/node-server`'s `serveStatic`: that resolves its root
 * relative to `process.cwd()`, which we can't rely on. The server is started
 * from the repo root in dev, from the workspace in `npm run dev`, and will be
 * started from wherever the tray executable happens to live. Resolving against
 * an absolute directory we computed ourselves removes that coupling.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

import type { Context, MiddlewareHandler } from 'hono'

const MIME_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
])

function contentTypeFor(path: string): string {
  return MIME_TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream'
}

/**
 * Resolve a URL path inside the root, or null if it escapes.
 *
 * Vite emits hashed filenames so traversal isn't expected, but this is a server
 * bound to `0.0.0.0` by design — anything on the LAN can call it.
 */
function safeResolve(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }

  // Strip the query/hash and any leading slashes before joining.
  const cleaned = normalize(decoded.split('?')[0]!.split('#')[0]!).replace(/^[/\\]+/, '')
  if (cleaned.includes('\0')) return null

  const resolved = resolve(join(root, cleaned))
  const rootWithSep = root.endsWith(sep) ? root : root + sep

  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null

  return resolved
}

async function sendFile(c: Context, path: string, immutable: boolean): Promise<Response | null> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch {
    return null
  }

  if (!info.isFile()) return null

  const etag = `"${info.mtimeMs}-${info.size}"`
  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304)
  }

  c.header('ETag', etag)
  c.header('Content-Type', contentTypeFor(path))
  c.header('Content-Length', String(info.size))
  // Vite fingerprints asset filenames, so those can be cached hard. index.html
  // must not be, or a rebuild never reaches an open tab.
  c.header(
    'Cache-Control',
    immutable ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
  )

  if (c.req.method === 'HEAD') return c.body(null, 200)

  return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream)
}

/**
 * Serve `root`, falling back to `index.html` so client-side routes deep-link.
 *
 * Only GET and HEAD are handled; anything else falls through.
 */
export function serveClient(root: string): MiddlewareHandler {
  const indexPath = join(root, 'index.html')

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()

    const urlPath = new URL(c.req.url).pathname

    // Hashed build output is safe to cache forever.
    const immutable = urlPath.startsWith('/assets/')

    const resolved = safeResolve(root, urlPath)
    if (resolved) {
      const response = await sendFile(c, resolved, immutable)
      if (response) return response
    }

    // A missing file under /assets/ is a genuine 404, not a client route —
    // returning HTML there is what silently breaks a stale index.html.
    if (immutable) return c.text('Not found', 404)

    const fallback = await sendFile(c, indexPath, false)
    if (fallback) return fallback

    return next()
  }
}
