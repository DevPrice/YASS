/**
 * The shared event stream's up/down reporting, against a fake `EventSource`.
 *
 * `useNowPlaying` starts its polling fallback on the transition to "down", so a
 * failure this module swallows is a banner that never updates. Module state is
 * global — one stream per page — so each case imports a fresh copy through a
 * cache-busting query.
 *
 * The stall cases run on mocked timers: the watchdog is measured in tens of
 * seconds, and a buffering proxy is a stream that simply never emits.
 */

import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'

const MODULE = new URL('./events.ts', import.meta.url).href

/** `STALL_MS` in `events.ts`. */
const STALL_MS = 37_500
const KEEPALIVE_MS = 15_000

class FakeEventSource {
  static instances: FakeEventSource[] = []

  closed = false
  private listeners = new Map<string, Array<(event: { data: string }) => void>>()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  emit(type: string, data = ''): void {
    if (this.closed) return
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }

  close(): void {
    this.closed = true
  }
}

let caseNumber = 0

/**
 * A fresh module, on mocked timers.
 *
 * Every case needs the mock, not only the stall cases: a subscription left open
 * holds a real watchdog that re-arms itself forever, and would keep the test
 * process alive.
 */
async function load(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  FakeEventSource.instances = []
  ;(globalThis as unknown as Record<string, unknown>).EventSource = FakeEventSource

  caseNumber += 1
  const events = (await import(`${MODULE}?case=${caseNumber}`)) as typeof import('./events')

  const stream = (): FakeEventSource => {
    const latest = FakeEventSource.instances.at(-1)
    assert.ok(latest, 'no EventSource was ever constructed')
    return latest
  }

  return { events, stream }
}

describe('event stream connection', () => {
  /*
   * The flag starts false, so a stream that never comes up at all — a proxy
   * that answers `/api/events` with an error page — produced no transition,
   * and nothing downstream ever learned it should poll instead.
   */
  it('reports a stream that fails on its very first attempt', async (t) => {
    const { events, stream } = await load(t)
    const heard: boolean[] = []

    events.onConnectionChange((up) => heard.push(up))
    stream().emit('error')

    assert.deepEqual(heard, [false])
    assert.equal(events.isConnected(), false)
  })

  it('reports a failed first attempt after the stream was closed and reopened', async (t) => {
    const { events, stream } = await load(t)

    const leave = events.onConnectionChange(() => {})
    stream().emit('error')
    leave()

    const heard: boolean[] = []
    events.onConnectionChange((up) => heard.push(up))
    assert.equal(FakeEventSource.instances.length, 2)
    stream().emit('error')

    assert.deepEqual(heard, [false])
  })

  it('reports each transition once', async (t) => {
    const { events, stream } = await load(t)
    const heard: boolean[] = []

    events.onConnectionChange((up) => heard.push(up))
    stream().emit('now-playing', '{}')
    stream().emit('ping')
    stream().emit('error')
    stream().emit('error')

    assert.deepEqual(heard, [true, false])
  })
})

describe('a stream that opens and then says nothing', () => {
  /*
   * A buffering proxy sends the response headers on at once, so the browser
   * fires `open`, and then holds every event behind them. Believing `open`
   * showed "connected" on a page whose banner never moved again.
   */
  it('does not count an opened socket as connected', async (t) => {
    const { events, stream } = await load(t)
    const heard: boolean[] = []

    events.onConnectionChange((up) => heard.push(up))
    stream().emit('open')

    assert.deepEqual(heard, [])
    assert.equal(events.isConnected(), false)
  })

  it('counts a keepalive as proof the stream is arriving', async (t) => {
    const { events, stream } = await load(t)
    const heard: boolean[] = []

    events.onConnectionChange((up) => heard.push(up))
    stream().emit('ping')

    assert.deepEqual(heard, [true])
  })

  it('gives up on it, and opens another', async (t) => {
    const { events, stream } = await load(t)
    const heard: boolean[] = []

    events.onConnectionChange((up) => heard.push(up))
    const first = stream()
    first.emit('open')

    t.mock.timers.tick(STALL_MS - 1)
    assert.deepEqual(heard, [])

    t.mock.timers.tick(1)
    assert.deepEqual(heard, [false])
    assert.equal(first.closed, true)
    assert.equal(FakeEventSource.instances.length, 2)

    // A stall that was only transient: the replacement gets through.
    stream().emit('now-playing', '{}')
    assert.deepEqual(heard, [false, true])
  })

  it('leaves a stream alone while the keepalives keep coming', async (t) => {
    const { events, stream } = await load(t)
    const heard: boolean[] = []

    events.onConnectionChange((up) => heard.push(up))
    stream().emit('now-playing', '{}')

    for (let beat = 0; beat < 8; beat += 1) {
      t.mock.timers.tick(KEEPALIVE_MS)
      stream().emit('ping')
    }

    assert.deepEqual(heard, [true])
    assert.equal(FakeEventSource.instances.length, 1)
  })

  /*
   * Behind a proxy that buffers for good, every replacement stalls too. That
   * has to read as one long outage rather than a connection that flickers up
   * and down every forty seconds.
   */
  it('reports a stream that never gets through as down once, not once a cycle', async (t) => {
    const { events, stream } = await load(t)
    const heard: boolean[] = []

    events.onConnectionChange((up) => heard.push(up))

    for (let cycle = 0; cycle < 5; cycle += 1) {
      stream().emit('open')
      t.mock.timers.tick(STALL_MS)
    }

    assert.deepEqual(heard, [false])
    assert.equal(FakeEventSource.instances.length, 6)
    assert.equal(FakeEventSource.instances.filter((source) => !source.closed).length, 1)
  })

  it('stops watching once the last subscriber has gone', async (t) => {
    const { events } = await load(t)

    const leave = events.onConnectionChange(() => {})
    leave()
    t.mock.timers.tick(STALL_MS * 4)

    assert.equal(FakeEventSource.instances.length, 1)
  })
})
