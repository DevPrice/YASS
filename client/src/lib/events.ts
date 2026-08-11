/**
 * The single connection to the server's event stream.
 *
 * Several hooks need server pushes — now-playing, the song library, the venue
 * lighting — and a phone on LAN Wi-Fi should not hold a long-lived socket per
 * topic. This module owns one `EventSource` and fans it out, opening on the
 * first subscriber and closing after the last one leaves.
 *
 * `EventSource` reconnects on its own, which is most of why the stream is SSE.
 * The polling fallback below only exists for the case where the stream can't be
 * established at all — a proxy that strips `text/event-stream`, say.
 */

const STREAM_URL = '/api/events'

type Listener<T> = (payload: T) => void

const listeners = new Map<string, Set<Listener<never>>>()
const connectionListeners = new Set<Listener<boolean>>()

let source: EventSource | null = null
let connected = false

function setConnected(next: boolean): void {
  if (connected === next) return
  connected = next
  for (const listener of connectionListeners) listener(next)
}

/** Whether the stream is currently established. */
export function isConnected(): boolean {
  return connected
}

function dispatch(event: string, raw: string): void {
  const handlers = listeners.get(event)
  if (handlers === undefined || handlers.size === 0) return

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    // A torn frame is not worth tearing down the stream over.
    return
  }

  for (const handler of handlers) (handler as Listener<unknown>)(payload)
}

function open(): void {
  if (source !== null) return

  const stream = new EventSource(STREAM_URL)
  source = stream

  stream.addEventListener('open', () => setConnected(true))
  stream.addEventListener('error', () => setConnected(false))

  // Every event type the server sends has to be registered explicitly;
  // `EventSource` only fires `message` for frames with no `event:` line.
  for (const event of ['now-playing', 'library', 'venue'] as const) {
    stream.addEventListener(event, (raw) => {
      setConnected(true)
      dispatch(event, (raw as MessageEvent<string>).data)
    })
  }

  /*
   * The host, through the tray, asking this page to reload.
   *
   * Handled here rather than fanned out to a subscriber because nothing in the
   * app has an opinion about it — there is no state to save and no component
   * that would do anything different. Only the host can send it; the endpoint
   * behind it 404s for anyone who isn't on loopback.
   */
  stream.addEventListener('reload', () => {
    location.reload()
  })
}

function closeIfIdle(): void {
  const hasSubscribers =
    connectionListeners.size > 0 || [...listeners.values()].some((set) => set.size > 0)

  if (hasSubscribers || source === null) return

  source.close()
  source = null
  setConnected(false)
}

/** Subscribe to one server event type. Returns an unsubscribe function. */
export function onServerEvent<T>(event: string, listener: Listener<T>): () => void {
  const handlers = listeners.get(event) ?? new Set()
  handlers.add(listener as Listener<never>)
  listeners.set(event, handlers)
  open()

  return () => {
    handlers.delete(listener as Listener<never>)
    closeIfIdle()
  }
}

/** Subscribe to stream up/down transitions. */
export function onConnectionChange(listener: Listener<boolean>): () => void {
  connectionListeners.add(listener)
  open()

  return () => {
    connectionListeners.delete(listener)
    closeIfIdle()
  }
}
