/**
 * Playing a song's preview, of which there is exactly one at a time.
 *
 * **One `<audio>` element, at module scope.** Not one per row and not one per
 * component: the rule "starting a preview stops the previous one" is not a
 * behaviour to coordinate between components, it is a property of there being
 * a single element. It also means a preview survives the detail sheet closing
 * and the list re-rendering around it, and that a virtualized row scrolling out
 * of the DOM cannot cut the audio off mid-note.
 *
 * State is published through `useSyncExternalStore` so the list row and the
 * detail sheet always agree about what is playing — they are two controls for
 * the same thing, and a pause button that says "play" is worse than no button.
 *
 * ## The one-second problem
 *
 * A preview that has never been requested is generated on the spot, which takes
 * about a second on a cold cache. A second of nothing after a tap reads as a
 * tap that missed. Two things cover it: `prefetchPreview` warms the file as
 * soon as a song is *selected* — before anybody has asked to hear it, using the
 * gap between choosing a song and deciding to play it — and `status` reports
 * `loading` so the control can say something in the meantime.
 */

import { useCallback, useSyncExternalStore } from 'react'

import { previewUrl } from './api'

export type PreviewStatus = 'idle' | 'loading' | 'playing'

interface PreviewState {
  hash: string | null
  status: PreviewStatus
}

let state: PreviewState = { hash: null, status: 'idle' }
const listeners = new Set<() => void>()

function publish(next: PreviewState): void {
  // Reference equality is the store's change signal, so only replace when
  // something actually moved.
  if (next.hash === state.hash && next.status === state.status) return

  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = (): PreviewState => state

/**
 * The element, created lazily.
 *
 * Lazily because this module is imported during server-side-free but still
 * module-scoped evaluation, and because a browser that never plays a preview
 * has no reason to hold a media element at all.
 */
let element: HTMLAudioElement | null = null

function audio(): HTMLAudioElement {
  if (element !== null) return element

  const created = new Audio()
  created.preload = 'auto'

  created.addEventListener('playing', () => {
    publish({ hash: state.hash, status: 'playing' })
  })

  // All three mean "we are no longer playing this". `ended` is the common one;
  // `error` covers a file that 404s between the prefetch and the tap.
  created.addEventListener('ended', () => publish({ hash: null, status: 'idle' }))
  created.addEventListener('pause', () => {
    if (state.status !== 'idle') publish({ hash: null, status: 'idle' })
  })
  created.addEventListener('error', () => publish({ hash: null, status: 'idle' }))

  element = created
  return created
}

/** Stop whatever is playing and forget it. */
export function stopPreview(): void {
  const player = element
  if (player === null) return

  player.pause()
  // Releases the connection and stops any in-flight buffering, which matters on
  // a phone that just walked out of Wi-Fi range.
  player.removeAttribute('src')
  player.load()

  publish({ hash: null, status: 'idle' })
}

/**
 * Start a song's preview, or stop it if it is the one already playing.
 *
 * Must be called from a user gesture: browsers refuse to start audio otherwise,
 * and every caller here is a click handler.
 */
export function togglePreview(hash: string): void {
  if (state.hash === hash && state.status !== 'idle') {
    stopPreview()
    return
  }

  const player = audio()
  player.pause()
  player.src = previewUrl(hash)

  publish({ hash, status: 'loading' })

  void player.play().catch(() => {
    // Autoplay refused, the file 404'd, or the format is unsupported. The
    // `error` listener usually fires too; this catches the rejection so it
    // doesn't surface as an unhandled promise.
    publish({ hash: null, status: 'idle' })
  })
}

/** Hashes we have already asked the server to warm, so we ask once. */
const prefetched = new Set<string>()

/**
 * Ask the server to generate a preview without playing it.
 *
 * `HEAD`, so the response is a status line rather than 200 KB of audio nobody
 * has asked to hear — the point is to pay the generation cost early, not to
 * download every song somebody scrolls past.
 */
export function prefetchPreview(hash: string | null | undefined): void {
  if (!hash || prefetched.has(hash)) return
  prefetched.add(hash)

  void fetch(previewUrl(hash), { method: 'HEAD' }).catch(() => {
    // A failed warm-up is not worth reporting: the real request will fail the
    // same way and that path already handles it. Allow a retry.
    prefetched.delete(hash)
  })
}

/**
 * Subscribe to preview state.
 *
 * Returns the same three things every control needs: whether *this* song is the
 * one playing, what it is doing, and how to toggle it.
 */
export function usePreview(hash: string | null): {
  isActive: boolean
  status: PreviewStatus
  toggle: () => void
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const isActive = hash !== null && current.hash === hash

  const toggle = useCallback(() => {
    if (hash !== null) togglePreview(hash)
  }, [hash])

  return { isActive, status: isActive ? current.status : 'idle', toggle }
}
