/**
 * The Setlist Bridge client.
 *
 * The parsers are pinned with literal messages from the plugin's PROTOCOL.md.
 * The client is driven against a stand-in for the plugin: a real TCP server on
 * loopback and a real discovery file in a temp directory, so what is tested is
 * the actual socket and watch path rather than a mock of it.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, beforeEach, describe, it } from 'node:test'

import type { Setlist } from '@shared/types.js'
import { parseDiscovery, parseStateMessage, SetlistBridge } from './setlistBridge.js'

const TIMEOUT_MS = 4000
const A = '52302429C0ACBCD1612B144FCCB3565BB2C20109'
const B = '33D3D0D05A9D7C1D2E9A2FE59C23EDCB370A6A29'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(what: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(10)
  }
  assert.fail(`timed out waiting for ${what}`)
}

describe('parseDiscovery', () => {
  it('accepts the file the plugin writes', () => {
    assert.deepEqual(
      parseDiscovery('{"protocol":1,"port":36110,"token":"abc","pid":42,"plugin":"0.1.1","yarg":"b4076"}\n'),
      { port: 36110, token: 'abc', pid: 42 },
    )
  })

  it('refuses a newer protocol rather than guessing at it', () => {
    assert.equal(parseDiscovery('{"protocol":2,"port":36110,"token":"abc"}'), null)
  })

  it('refuses a torn or incomplete file', () => {
    assert.equal(parseDiscovery('{"protocol":1,"po'), null)
    assert.equal(parseDiscovery('{"protocol":1,"port":36110}'), null)
    assert.equal(parseDiscovery('{"protocol":1,"port":0,"token":"abc"}'), null)
  })
})

describe('parseStateMessage', () => {
  it('reads a show in progress', () => {
    assert.deepEqual(
      parseStateMessage({ type: 'state', version: 6, mode: 'playing', index: 1, songs: [A, B], current: B, scene: 'Gameplay' }),
      { mode: 'playing', index: 1, hashes: [A, B] },
    )
  })

  it('drops the index outside a show', () => {
    assert.deepEqual(
      parseStateMessage({ type: 'state', version: 2, mode: 'building', index: null, songs: [A], current: null, scene: 'Menu' }),
      { mode: 'building', index: null, hashes: [A] },
    )
  })

  it('refuses a state that does not hold together', () => {
    assert.equal(parseStateMessage({ type: 'state', mode: 'playing', index: 2, songs: [A, B] }), null)
    assert.equal(parseStateMessage({ type: 'state', mode: 'building', songs: ['not-a-hash'] }), null)
    assert.equal(parseStateMessage({ type: 'state', mode: 'dancing', songs: [] }), null)
  })

  it('ignores every other message type', () => {
    assert.equal(parseStateMessage({ type: 'hello', protocol: 1 }), null)
  })
})

/** Just enough of the plugin: auth, hello, then whatever `send` pushes. */
class FakeBridge {
  server: Server
  clients = new Set<Socket>()
  token = 'secret'
  port = 0
  #latest: string | null = null

  constructor() {
    this.server = createServer((socket) => {
      createInterface({ input: socket }).once('line', (line) => {
        const auth = JSON.parse(line) as { token?: string }
        if (auth.token !== this.token) {
          socket.end('{"type":"error","code":"unauthorized"}\n')
          return
        }
        this.clients.add(socket)
        socket.on('close', () => this.clients.delete(socket))
        socket.write('{"type":"hello","protocol":1,"plugin":"test"}\n')
        if (this.#latest !== null) socket.write(this.#latest)
      })
    })
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as { port: number }).port
  }

  send(state: Record<string, unknown>): void {
    this.#latest = `${JSON.stringify({ type: 'state', version: 1, current: null, scene: 'Menu', ...state })}\n`
    for (const client of this.clients) client.write(this.#latest)
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}

describe('SetlistBridge', () => {
  let dir: string
  let fake: FakeBridge
  let bridge: SetlistBridge
  let seen: Setlist[]

  const discoveryPath = () => join(dir, 'setlist-bridge.json')
  const writeDiscovery = (port = fake.port, token = fake.token) =>
    writeFile(discoveryPath(), JSON.stringify({ protocol: 1, port, token, pid: process.pid }))

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yass-setlist-'))
    fake = new FakeBridge()
    await fake.listen()
    seen = []
    bridge = new SetlistBridge({
      getDataDir: () => dir,
      resolveLibraryId: (hash) => (hash === A ? 'song-a' : null),
      // Short enough that a test relying on the backstop still finishes.
      backstopMs: 200,
    })
    bridge.subscribe((state) => seen.push(state))
  })

  afterEach(async () => {
    bridge.stop()
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('is unavailable, quietly, when there is no plugin', async () => {
    await bridge.start()
    await sleep(300)
    assert.equal(bridge.current.available, false)
    assert.equal(seen.length, 0)
  })

  it('connects through the discovery file and joins songs to the library', async () => {
    fake.send({ mode: 'building', index: null, songs: [A, B] })
    await writeDiscovery()
    await bridge.start()

    await waitFor('the first state', () => bridge.current.available)
    assert.equal(bridge.current.mode, 'building')
    assert.deepEqual(bridge.current.songs, [
      { hash: A, libraryId: 'song-a' },
      { hash: B, libraryId: null },
    ])
  })

  it('follows each state the plugin pushes', async () => {
    await writeDiscovery()
    await bridge.start()
    await waitFor('the connection', () => fake.clients.size === 1)

    fake.send({ mode: 'playing', index: 0, songs: [A, B], scene: 'Gameplay' })
    await waitFor('song 1', () => bridge.current.index === 0)

    fake.send({ mode: 'playing', index: 1, songs: [A, B], scene: 'Gameplay' })
    await waitFor('song 2', () => bridge.current.index === 1)
    assert.equal(bridge.current.mode, 'playing')
  })

  it('becomes unavailable when YARG quits and removes the file', async () => {
    fake.send({ mode: 'building', index: null, songs: [A] })
    await writeDiscovery()
    await bridge.start()
    await waitFor('the first state', () => bridge.current.available)

    await unlink(discoveryPath())
    await fake.close()
    await waitFor('unavailable', () => !bridge.current.available)
    assert.deepEqual(bridge.current.songs, [])
  })

  it('survives a file left behind by a crash, and connects once the game is back', async () => {
    // Nothing listens on the port the stale file names.
    const deadPort = fake.port
    await fake.close()
    await writeDiscovery(deadPort)
    await bridge.start()
    await sleep(400)
    assert.equal(bridge.current.available, false)

    fake = new FakeBridge()
    await fake.listen()
    fake.send({ mode: 'idle', index: null, songs: [] })
    await writeDiscovery()

    await waitFor('the relaunched bridge', () => bridge.current.available)
    assert.equal(bridge.current.mode, 'idle')
  })

  it('does not trust a stale token', async () => {
    fake.send({ mode: 'building', index: null, songs: [A] })
    await writeDiscovery(fake.port, 'from-last-launch')
    await bridge.start()
    await sleep(400)
    assert.equal(bridge.current.available, false)

    await writeDiscovery()
    await waitFor('the fresh token', () => bridge.current.available)
  })

  it('re-resolves the join after the library reloads', async () => {
    let known = new Set<string>()
    bridge.stop()
    bridge = new SetlistBridge({
      getDataDir: () => dir,
      resolveLibraryId: (hash) => (known.has(hash) ? `id-${hash.slice(0, 4)}` : null),
      backstopMs: 200,
    })

    fake.send({ mode: 'building', index: null, songs: [B] })
    await writeDiscovery()
    await bridge.start()
    await waitFor('the first state', () => bridge.current.available)
    assert.equal(bridge.current.songs[0]?.libraryId, null)

    known = new Set([B])
    bridge.refreshLibraryJoin()
    assert.equal(bridge.current.songs[0]?.libraryId, 'id-33D3')
  })
})
