import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import faviconUrl from '@opensource/base/icons/yarg.png'

import { App } from './App'
import { installMock } from './mock'
import './lib/viewportHeight'
import './index.css'

/*
 * The demo build's fake server, stood up before anything can ask for a song.
 *
 * `import.meta.env.VITE_MOCK` is a literal `false` in every build but
 * `--mode mock` (see `vite.config.ts`), so this whole branch and the module it
 * reaches are removed from the normal bundle. Synchronous rather than a dynamic
 * import, because `fetch` and `EventSource` have to be replaced before React
 * mounts — an awaited import would let the first request race the shim.
 */
if (import.meta.env.VITE_MOCK === true) {
  installMock()
}

/*
 * Favicon: YARG's own mark, from the OpenSource submodule.
 *
 * Attached here rather than written into index.html, because a `<link href>`
 * pointing out of the Vite root only works in one of the two modes. The build
 * rewrites the relative path and emits the file content-hashed; the dev server
 * has no route for it and answers with the SPA fallback, so the tab shows a
 * broken icon for the entire time anyone is actually developing.
 *
 * Going through the module graph resolves in both, and matches how the rest of
 * the artwork here is reached — nothing in this app lives in `public/`, so that
 * a one-year immutable cache stays safe. The bytes are free: `lib/sources.ts`
 * already globs this directory, so this import reuses that same emitted asset.
 */
const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/png'
favicon.href = faviconUrl
document.head.append(favicon)

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
