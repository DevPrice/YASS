/**
 * The single connection to the server's event stream.
 *
 * Several hooks need server pushes — now-playing, the song library, the venue
 * lighting — and a phone on LAN Wi-Fi should not hold a long-lived socket per
 * topic. This module owns one `EventSource` and fans it out, opening on the
 * first subscriber and closing after the last one leaves.
 *
 * `EventSource` reconnects on its own, which is most of why the stream is SSE.
 * It cannot notice a stream that is open but silent: a buffering proxy (nginx
 * without `X-Accel-Buffering`, a Cloudflare quick tunnel) passes the headers
 * through, so `open` fires, then holds back every event. So "connected" means an
 * event has arrived, not that the socket opened.
 */

const STREAM_URL = '/api/events'

/**
 * The server writes `now-playing` the moment a stream opens, so silence this
 * long means the stream is being held back. Subscribers hear "down" and poll,
 * but the stream is left to `STALL_MS` to replace: behind a proxy that buffers
 * for good, replacing it this often would be a new request every few seconds.
 */
const FIRST_EVENT_MS = 5_000

/**
 * 2.5× the server's `SSE_KEEPALIVE_MS` (`server/src/api/routes.ts`): one late
 * `ping` is jitter, two missing is a stall. Change them together.
 */
const STALL_MS = 37_500

type Listener<T> = (payload: T) => void

const listeners = new Map<string, Set<Listener<never>>>()
const connectionListeners = new Set<Listener<boolean>>()

let source: EventSource | null = null
/**
 * Null until the stream has first come up or failed, so that failing on the
 * very first attempt is still a transition — it is the one `useNowPlaying`
 * starts polling on.
 */
let connected: boolean | null = null
let watchdog: ReturnType<typeof setTimeout> | undefined
let firstEventDeadline: ReturnType<typeof setTimeout> | undefined

function setConnected(next: boolean): void {
  if (connected === next) return
  connected = next
  for (const listener of connectionListeners) listener(next)
}

function armWatchdog(): void {
  clearTimeout(watchdog)
  watchdog = setTimeout(restart, STALL_MS)
}

function heard(): void {
  clearTimeout(firstEventDeadline)
  setConnected(true)
  armWatchdog()
}

function restart(): void {
  source?.close()
  source = null
  setConnected(false)
  open()
}

/** Whether the stream is currently delivering events. */
export function isConnected(): boolean {
  return connected === true
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
  armWatchdog()
  clearTimeout(firstEventDeadline)
  firstEventDeadline = setTimeout(() => setConnected(false), FIRST_EVENT_MS)

  stream.addEventListener('error', () => setConnected(false))

  // Every event type the server sends has to be registered explicitly;
  // `EventSource` only fires `message` for frames with no `event:` line.
  for (const event of ['now-playing', 'library', 'venue'] as const) {
    stream.addEventListener(event, (raw) => {
      heard()
      dispatch(event, (raw as MessageEvent<string>).data)
    })
  }
  stream.addEventListener('ping', heard)

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

  clearTimeout(watchdog)
  clearTimeout(firstEventDeadline)
  source.close()
  source = null
  // Nobody is left to tell; the next subscriber starts from "not yet known".
  connected = null
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
