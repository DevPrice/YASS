/**
 * The setlist client against a fake YARG on an ephemeral loopback port.
 *
 * The fake only does what a test tells it to, so these are about YASS's half
 * of the conversation: what it sends, what it acks, and what it does when the
 * other end refuses, stalls or sends something it can't read.
 */

import assert from 'node:assert/strict'
import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, it } from 'node:test'

import {
  SetlistClient,
  SetlistConnectionLostError,
  SetlistUnavailableError,
  type SetlistFeed,
} from './setlistClient.js'
import { FIXTURE_HASH, resultFrame, serverHello, snapshotFrame } from './setlistFrames.fixture.js'
import { Position } from './setlistProtocol.js'
import type { SetlistSocketSettings } from './yargSettings.js'

const FAST = {
  retryMinMs: 20,
  retryMaxMs: 40,
  retryIncompatibleMs: 40,
  helloTimeoutMs: 500,
  commandTimeoutMs: 1_000,
}

interface FakeYarg {
  port: number
  /** Each connection as it arrives, with everything it has sent so far. */
  next(): Promise<{ socket: Socket; received: () => Buffer }>
  close(): Promise<void>
}

async function fakeYarg(): Promise<FakeYarg> {
  const waiting: Array<(connection: { socket: Socket; received: () => Buffer }) => void> = []
  const arrived: Array<{ socket: Socket; received: () => Buffer }> = []
  const sockets = new Set<Socket>()

  const server: Server = createServer((socket) => {
    sockets.add(socket)
    let received = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk])
    })
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))

    const connection = { socket, received: () => received }
    const waiter = waiting.shift()
    if (waiter) waiter(connection)
    else arrived.push(connection)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')

  return {
    port: address.port,
    next: () =>
      new Promise((resolve) => {
        const ready = arrived.shift()
        if (ready) resolve(ready)
        else waiting.push(resolve)
      }),
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

/** The first state the client publishes that satisfies `predicate`. */
function stateWhere(
  client: SetlistClient,
  predicate: (state: SetlistFeed) => boolean,
): Promise<SetlistFeed> {
  if (predicate(client.current)) return Promise.resolve(client.current)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out; last state ${JSON.stringify(client.current)}`))
    }, 2_000)
    const unsubscribe = client.subscribe((state) => {
      if (!predicate(state)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(state)
    })
  })
}

async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition(); waited += 5) {
    if (waited > 2_000) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const ACK_V1 = (revision: number): number[] => [4, 0, 0, 0, 2, revision, 0, 0, 0]
const ACK_V2 = (bytes: number): number[] => [8, 0, 0, 0, 2, bytes & 0xff, bytes >> 8, 0, 0, 0, 0, 0, 0]
const HELLO = [0x59, 0x53, 0x45, 0x54, 1, 0, 2, 0]

const settings = (port: number, enabled: SetlistSocketSettings['enabled'] = 'on') => ({
  enabled,
  port,
})

const cleanup: Array<() => unknown> = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

async function setup(): Promise<{ yarg: FakeYarg; client: SetlistClient }> {
  const yarg = await fakeYarg()
  const client = new SetlistClient(FAST)
  cleanup.push(() => yarg.close(), () => client.stop())
  return { yarg, client }
}

describe('the setlist client', () => {
  it('offers both versions, and acks a version 1 snapshot by revision', async () => {
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const { socket, received } = await yarg.next()
    await until(() => received().length >= 8)
    assert.deepEqual([...received()], HELLO)

    socket.write(serverHello())
    socket.write(
      snapshotFrame({
        revision: 3,
        showInProgress: true,
        currentIndex: 0,
        entries: [{ title: 'Everlong', lengthMs: 250_000 }],
      }),
    )

    const state = await stateWhere(client, (s) => s.entries.length === 1)
    assert.equal(state.link, 'connected')
    assert.equal(state.active, true)
    assert.equal(state.currentIndex, 0)
    assert.equal(state.entries[0]?.name, 'Everlong')
    assert.equal(state.entries[0]?.lengthSeconds, 250)

    await until(() => received().length >= 17)
    assert.deepEqual([...received().subarray(8)], ACK_V1(3))
  })

  it('acks version 2 by every byte read, results included', async () => {
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const { socket, received } = await yarg.next()
    const snapshot = snapshotFrame({ entries: [{ id: 4 }] }, 2)
    socket.write(Buffer.concat([serverHello(0, 2), snapshot]))

    const state = await stateWhere(client, (s) => s.entries.length === 1)
    assert.equal(state.version, 2)
    assert.equal(state.entries[0]?.id, 4)

    await until(() => received().length >= 8 + 13)
    assert.deepEqual([...received().subarray(8, 21)], ACK_V2(snapshot.length))

    // A result is acked too: YARG drops a client 192 KB behind.
    socket.write(resultFrame(999, 0, 0, 1))
    await until(() => received().length >= 8 + 26)
    assert.deepEqual([...received().subarray(21, 34)], ACK_V2(snapshot.length + 18))
  })

  it("answers a command once the snapshot showing it is out", async () => {
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const { socket, received } = await yarg.next()
    socket.write(Buffer.concat([serverHello(0, 2), snapshotFrame({ revision: 1 }, 2)]))
    await stateWhere(client, (s) => s.version === 2)

    const answer = client.send({ op: 'add', hash: FIXTURE_HASH, position: Position.End, anchorId: 0 })

    // Hello, then the ack for revision 1, then the command.
    await until(() => received().length >= 8 + 13 + 35)
    const command = received().subarray(8 + 13)
    assert.equal(command.readUInt8(4), 0x10)
    const requestId = command.readUInt32LE(5)

    let settled = false
    void answer.then(() => (settled = true))

    socket.write(resultFrame(requestId, 0, 12, 2))
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(settled, false, 'answered before the snapshot that shows it')

    socket.write(snapshotFrame({ revision: 2, entries: [{ id: 12 }] }, 2))
    const result = await answer
    assert.deepEqual(result, { requestId, status: 'ok', entryId: 12, revision: 2 })
    assert.equal(client.current.entries[0]?.id, 12)
  })

  it('fails a command left unanswered when the connection drops', async () => {
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const { socket, received } = await yarg.next()
    socket.write(Buffer.concat([serverHello(0, 2), snapshotFrame({}, 2)]))
    await stateWhere(client, (s) => s.version === 2)

    const answer = client.send({ op: 'remove', entryId: 3 })
    await until(() => received().length >= 8 + 13 + 14)
    socket.destroy()

    await assert.rejects(answer, SetlistConnectionLostError)
  })

  it('refuses commands to a YARG that only speaks version 1', async () => {
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const { socket } = await yarg.next()
    socket.write(Buffer.concat([serverHello(0, 1), snapshotFrame()]))
    await stateWhere(client, (s) => s.link === 'connected')

    await assert.rejects(client.send({ op: 'clear' }), SetlistUnavailableError)
  })

  it('reads a hello and a snapshot that arrive in one chunk', async () => {
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const { socket } = await yarg.next()
    socket.write(Buffer.concat([serverHello(), snapshotFrame({ entries: [{}, {}] })]))

    const state = await stateWhere(client, (s) => s.entries.length === 2)
    assert.equal(state.currentIndex, null)
  })

  it('reconnects rather than sit on a snapshot it cannot read', async () => {
    // YARG sends nothing more until the last snapshot is acked, and there is
    // no correct revision to ack for one that didn't decode.
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const first = await yarg.next()
    const broken = snapshotFrame({ entries: [{}] })
    broken.writeUInt32LE(5, 19)
    first.socket.write(Buffer.concat([serverHello(), broken]))

    const second = await yarg.next()
    second.socket.write(Buffer.concat([serverHello(), snapshotFrame({ revision: 1, entries: [{}] })]))
    await stateWhere(client, (s) => s.entries.length === 1)
  })

  it('backs off and tries again when YARG is busy', async () => {
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const first = await yarg.next()
    first.socket.end(serverHello(2))

    const second = await yarg.next()
    second.socket.write(Buffer.concat([serverHello(), snapshotFrame({ entries: [{}] })]))
    await stateWhere(client, (s) => s.link === 'connected' && s.entries.length === 1)
  })

  it('goes back to explaining itself when YARG closes the socket', async () => {
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const { socket } = await yarg.next()
    socket.write(Buffer.concat([serverHello(), snapshotFrame({ entries: [{}] })]))
    await stateWhere(client, (s) => s.entries.length === 1)

    socket.destroy()
    const state = await stateWhere(client, (s) => s.link !== 'connected')
    assert.equal(state.link, 'unreachable')
    assert.deepEqual(state.entries, [])
  })

  it("explains a refused connection with what YARG's settings say", async () => {
    // Bind and release a port so nothing is listening on it.
    const gone = await fakeYarg()
    const port = gone.port
    await gone.close()

    const client = new SetlistClient(FAST)
    cleanup.push(() => client.stop())

    client.start(settings(port, 'off'))
    assert.equal(client.current.link, 'off')

    client.configure(settings(port, 'absent'))
    assert.equal(client.current.link, 'unsupported')

    client.configure(settings(port, 'on'))
    assert.equal(client.current.link, 'unreachable')
  })

  it('moves to a new port when the setting changes', async () => {
    const { yarg: first, client } = await setup()
    const second = await fakeYarg()
    cleanup.push(() => second.close())

    client.start(settings(first.port))
    const old = await first.next()
    old.socket.write(Buffer.concat([serverHello(), snapshotFrame({ entries: [{}] })]))
    await stateWhere(client, (s) => s.entries.length === 1)

    client.configure(settings(second.port))
    const moved = await second.next()
    moved.socket.write(Buffer.concat([serverHello(), snapshotFrame({ entries: [{}, {}] })]))
    await stateWhere(client, (s) => s.entries.length === 2)
  })

  it('treats an inactive snapshot as connected but empty', async () => {
    const { yarg, client } = await setup()
    client.start(settings(yarg.port))

    const { socket } = await yarg.next()
    socket.write(Buffer.concat([serverHello(), snapshotFrame({ entries: [{}] })]))
    await stateWhere(client, (s) => s.active)

    socket.write(snapshotFrame({ revision: 2, active: false }))
    const state = await stateWhere(client, (s) => !s.active)
    assert.equal(state.link, 'connected')
    assert.deepEqual(state.entries, [])
  })
})
