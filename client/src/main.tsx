import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import faviconUrl from '@opensource/base/icons/yarg.png'

import { App } from './App'
import './index.css'

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
