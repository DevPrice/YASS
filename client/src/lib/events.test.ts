/**
 * The shared event stream's up/down reporting, against a fake `EventSource`.
 *
 * `useNowPlaying` starts its polling fallback on the transition to "down", so a
 * failure this module swallows is a banner that never updates. Module state is
 * global — one stream per page — so each case imports a fresh copy through a
 * cache-busting query.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const MODULE = new URL('./events.ts', import.meta.url).href

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
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }

  close(): void {
    this.closed = true
  }
}

let caseNumber = 0

async function load() {
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
  it('reports a stream that fails on its very first attempt', async () => {
    const { events, stream } = await load()
    const heard: boolean[] = []

    events.onConnectionChange((up) => heard.push(up))
    stream().emit('error')

    assert.deepEqual(heard, [false])
    assert.equal(events.isConnected(), false)
  })

  it('reports a failed first attempt after the stream was closed and reopened', async () => {
    const { events, stream } = await load()

    const leave = events.onConnectionChange(() => {})
    stream().emit('error')
    leave()

    const heard: boolean[] = []
    events.onConnectionChange((up) => heard.push(up))
    assert.equal(FakeEventSource.instances.length, 2)
    stream().emit('error')

    assert.deepEqual(heard, [false])
  })

  it('reports each transition once', async () => {
    const { events, stream } = await load()
    const heard: boolean[] = []

    events.onConnectionChange((up) => heard.push(up))
    stream().emit('open')
    stream().emit('now-playing', '{}')
    stream().emit('error')
    stream().emit('error')

    assert.deepEqual(heard, [true, false])
  })
})
