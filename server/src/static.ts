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

/**
 * A `Range: bytes=…` header, resolved against a known file size.
 *
 * Only single ranges are honoured. Multi-range requests are legal and would
 * need a `multipart/byteranges` body; no browser sends one for media playback,
 * and answering the whole file is a valid response to a range request.
 *
 * Returns `'unsatisfiable'` for a syntactically valid range that falls outside
 * the file, which is a 416 rather than a silent full-body response — the
 * difference matters to a player trying to seek past the end.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null

  const [, rawStart, rawEnd] = match

  // `bytes=-500` means the *last* 500 bytes, not "up to 500".
  if (rawStart === '') {
    if (rawEnd === '') return null
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return 'unsatisfiable'
    return { start: Math.max(0, size - length), end: size - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return 'unsatisfiable'

  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(end) || end < start) return 'unsatisfiable'

  return { start, end }
}

export interface SendFileOptions {
  /** `public, max-age=31536000, immutable` instead of revalidating. */
  immutable?: boolean
  /** Override the type derived from the extension. */
  contentType?: string
  /** Strong ETag to use instead of the `mtime-size` one. */
  etag?: string
  /** `private` rather than `public`, for one user's own library. */
  privateCache?: boolean
}

/**
 * Serve a file, honouring conditional and range requests.
 *
 * **Range support is not optional here.** iOS Safari will not play an `<audio>`
 * source from a server that ignores `Range` — it issues a range request, and a
 * `200` with the whole body makes it give up rather than fall back. So the
 * audio preview route needs this, and once it exists the album art and the
 * now-playing image get it for free.
 */
async function sendFile(
  c: Context,
  path: string,
  options: SendFileOptions = {},
): Promise<Response | null> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch {
    return null
  }

  if (!info.isFile()) return null

  const etag = options.etag ?? `"${info.mtimeMs}-${info.size}"`
  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304)
  }

  c.header('ETag', etag)
  c.header('Content-Type', options.contentType ?? contentTypeFor(path))
  // Advertised on every response, not just ranged ones: it is how a client
  // knows it may seek at all.
  c.header('Accept-Ranges', 'bytes')
  // Vite fingerprints asset filenames, so those can be cached hard. index.html
  // must not be, or a rebuild never reaches an open tab.
  c.header(
    'Cache-Control',
    options.immutable
      ? `${options.privateCache ? 'private' : 'public'}, max-age=31536000, immutable`
      : 'no-cache, must-revalidate',
  )

  const range = parseRange(c.req.header('range'), info.size)

  if (range === 'unsatisfiable') {
    c.header('Content-Range', `bytes */${info.size}`)
    return c.body(null, 416)
  }

  if (range === null) {
    c.header('Content-Length', String(info.size))
    if (c.req.method === 'HEAD') return c.body(null, 200)
    return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream)
  }

  c.header('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`)
  c.header('Content-Length', String(range.end - range.start + 1))
  if (c.req.method === 'HEAD') return c.body(null, 206)

  return c.body(
    Readable.toWeb(createReadStream(path, { start: range.start, end: range.end })) as ReadableStream,
    206,
  )
}

/** `sendFile` for routes outside the static client — art, previews. */
export function serveFile(
  c: Context,
  path: string,
  options: SendFileOptions = {},
): Promise<Response | null> {
  return sendFile(c, path, options)
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
      const response = await sendFile(c, resolved, { immutable })
      if (response) return response
    }

    // A missing file under /assets/ is a genuine 404, not a client route —
    // returning HTML there is what silently breaks a stale index.html.
    if (immutable) return c.text('Not found', 404)

    const fallback = await sendFile(c, indexPath)
    if (fallback) return fallback

    return next()
  }
}
