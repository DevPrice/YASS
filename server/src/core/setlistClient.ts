/**
 * Follows YARG's live setlist over its loopback setlist socket, and carries
 * commands to it.
 *
 * One connection for the whole server, fanned out to every phone over SSE.
 * YARG serves at most four clients, so a socket per browser was never an
 * option — and one is also all it takes.
 *
 * Five things about the other end shape this:
 *
 *  1. **The socket comes and goes with YARG**, and with a toggle in its
 *     Experimental settings. A refused connect on loopback costs nothing, so
 *     this just keeps trying, backing off to a few seconds, and lets
 *     `settings.json` explain the failures rather than decide when to try. The
 *     file can be behind the toggle for as long as the settings menu stays open.
 *
 *  2. **YARG sends no snapshot until the last one is acked.** A snapshot this
 *     cannot decode therefore can't be skipped — acking its token would claim
 *     it was read — so the only way to get the setlist moving again is to drop
 *     the connection and take the fresh snapshot a reconnect always starts with.
 *
 *  3. **An ack echoes the token of the last frame read**, and YARG drops a
 *     client that falls 192 KB behind or leaves a snapshot unacked for ten
 *     seconds. So every chunk that completes a frame is acked with the token of
 *     the last one; the frames before it are acknowledged along with it.
 *
 *  4. **Accepts are rate-limited on YARG's side**, four a second shared by
 *     every app, so the retry floor is a second and carries jitter.
 *
 *  5. **Inactive arrives as an empty snapshot.** YARG hides the setlist outside
 *     the music library and shows; see `SetlistState` for why that is not the
 *     same as cleared.
 */

import { createConnection, type Socket } from 'node:net'

import type { SetlistLink, SetlistState } from '@shared/types.js'
import {
  decodeResult,
  decodeServerHello,
  decodeSnapshot,
  encodeAck,
  encodeClientHello,
  encodeCommand,
  FrameType,
  HelloStatus,
  MAX_PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
  ProtocolError,
  readFrame,
  SERVER_HELLO_BYTES,
  type Command,
  type Result,
  type Snapshot,
} from './setlistProtocol.js'
import { DEFAULT_SETLIST_PORT, type SetlistSocketSettings } from './yargSettings.js'

/**
 * `127.0.0.1`, never `localhost`: newer Node tries `::1` first, and YARG only
 * listens on IPv4.
 */
const HOST = '127.0.0.1'

export interface SetlistClientTimings {
  /** First retry after a failed or dropped connection. */
  retryMinMs: number
  /** Where the doubling stops. */
  retryMaxMs: number
  /** After "no common version" — only a YARG update will change the answer. */
  retryIncompatibleMs: number
  /** How long YARG has to answer our hello. It replies at once when it is there at all. */
  helloTimeoutMs: number
  /**
   * How long a command may wait for its result, and then for the snapshot
   * showing it. YARG answers in tens of milliseconds; this only catches a
   * connection that has stopped moving.
   */
  commandTimeoutMs: number
}

const DEFAULT_TIMINGS: SetlistClientTimings = {
  retryMinMs: 1_000,
  retryMaxMs: 5_000,
  retryIncompatibleMs: 60_000,
  helloTimeoutMs: 5_000,
  commandTimeoutMs: 5_000,
}

/** The setlist as this connection sees it: everything but YASS's own policy. */
export type SetlistFeed = Omit<SetlistState, 'guestEdits' | 'seenAt'> & {
  /** The negotiated protocol version, or 0 while not connected. Commands need 2. */
  version: number
  /** Whether `entries` is the whole setlist, which ownership pruning needs to know. */
  complete: boolean
}

/** No connection, or one to a YARG that can't take commands. */
export class SetlistUnavailableError extends Error {}

/**
 * The connection closed with the command unanswered. YARG may still have
 * applied it, so the caller can't know; the next snapshot will say.
 */
export class SetlistConnectionLostError extends Error {}

function linkFromSettings(settings: SetlistSocketSettings): SetlistLink {
  switch (settings.enabled) {
    case 'absent':
      return 'unsupported'
    case 'off':
      return 'off'
    default:
      return 'unreachable'
  }
}

function idleFeed(link: SetlistLink): SetlistFeed {
  return {
    link,
    version: 0,
    active: false,
    showInProgress: false,
    currentIndex: null,
    totalCount: 0,
    entries: [],
    complete: true,
    updatedAt: Date.now(),
  }
}

export function feedFromSnapshot(snapshot: Snapshot, version: number): SetlistFeed {
  return {
    link: 'connected',
    version,
    active: snapshot.active,
    showInProgress: snapshot.showInProgress,
    currentIndex:
      snapshot.showInProgress && snapshot.currentIndex >= 0 ? snapshot.currentIndex : null,
    totalCount: snapshot.totalCount,
    entries: snapshot.entries.map((entry) => ({
      id: entry.id,
      hash: entry.hash,
      name: entry.title,
      artist: entry.artist,
      album: entry.album,
      // YARG clamps an unknown length to zero.
      lengthSeconds: entry.lengthMs > 0 ? entry.lengthMs / 1000 : null,
    })),
    complete: snapshot.entries.length >= snapshot.totalCount,
    updatedAt: Date.now(),
  }
}

type Failure = 'dropped' | 'incompatible'

interface PendingCommand {
  resolve: (result: Result) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** One open connection and everything that dies with it. */
interface Connection {
  socket: Socket
  version: number
  /** The latest snapshot revision applied. */
  revision: number
  pending: Map<number, PendingCommand>
  /** Results waiting for the snapshot that shows them. */
  awaitingSnapshot: Array<{ result: Result; pending: PendingCommand }>
}

export class SetlistClient {
  #timings: SetlistClientTimings
  #settings: SetlistSocketSettings = { enabled: 'unknown', port: DEFAULT_SETLIST_PORT }
  #feed: SetlistFeed = idleFeed('unreachable')
  #listeners = new Set<(feed: SetlistFeed) => void>()

  #socket: Socket | null = null
  /** Set once YARG's hello says ok; cleared when that socket closes. */
  #connection: Connection | null = null
  #nextRequestId = 1
  #retryTimer: NodeJS.Timeout | null = null
  /** Consecutive failures, for the backoff. Reset by a hello that says ok. */
  #failures = 0
  #stopped = true
  /** Logged once per kind until a connection succeeds, so a closed YARG is not a log line every five seconds. */
  #reported = new Set<string>()

  constructor(timings: Partial<SetlistClientTimings> = {}) {
    this.#timings = { ...DEFAULT_TIMINGS, ...timings }
  }

  get current(): SetlistFeed {
    return this.#feed
  }

  subscribe(listener: (feed: SetlistFeed) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start(settings: SetlistSocketSettings): void {
    if (!this.#stopped) return
    this.#stopped = false
    this.#settings = settings
    this.#setFeed(idleFeed(linkFromSettings(settings)))
    this.#connect()
  }

  /**
   * Follow a new reading of YARG's settings.
   *
   * A port change is the only one that drops a working connection. Anything
   * else that might have opened the socket — the toggle going on, a different
   * install's file — is worth an immediate attempt rather than waiting out
   * the backoff.
   */
  configure(settings: SetlistSocketSettings): void {
    const previous = this.#settings
    this.#settings = settings
    if (this.#stopped) return

    if (settings.port !== previous.port) {
      this.#disconnect()
      this.#retryNow()
      return
    }

    if (this.#connection !== null) return

    this.#setFeed({ ...this.#feed, link: linkFromSettings(settings), updatedAt: Date.now() })
    // An attempt already in flight will do; otherwise skip the rest of the backoff.
    if (settings.enabled !== previous.enabled && this.#socket === null) this.#retryNow()
  }

  /**
   * Send a command and answer with its result, once the snapshot that reflects
   * it has been published — so a caller that replies to a phone never replies
   * ahead of the setlist the phone is about to be shown.
   */
  send(command: Command): Promise<Result> {
    const connection = this.#connection
    if (connection === null || connection.version < 2) {
      return Promise.reject(new SetlistUnavailableError('YARG is not taking setlist commands'))
    }

    const requestId = this.#nextRequestId
    // u32, and never 0: YARG uses 0 for "no request".
    this.#nextRequestId = requestId >= 0xffffffff ? 1 : requestId + 1

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(requestId)
        connection.awaitingSnapshot = connection.awaitingSnapshot.filter(
          (waiting) => waiting.pending.timer !== timer,
        )
        reject(new SetlistConnectionLostError('YARG did not answer in time'))
      }, this.#timings.commandTimeoutMs)
      timer.unref?.()

      connection.pending.set(requestId, { resolve, reject, timer })
      connection.socket.write(encodeCommand(requestId, command))
    })
  }

  stop(): void {
    this.#stopped = true
    this.#clearRetry()
    this.#disconnect()
  }

  #connect(): void {
    if (this.#stopped || this.#socket !== null) return

    const port = this.#settings.port
    const socket = createConnection({ host: HOST, port })
    this.#socket = socket

    let received = Buffer.alloc(0)
    let connection: Connection | null = null
    let failure: Failure = 'dropped'

    const helloTimer = setTimeout(() => {
      this.#report('hello', `[setlist] no hello from 127.0.0.1:${port}; is that YARG?`)
      socket.destroy()
    }, this.#timings.helloTimeoutMs)
    helloTimer.unref?.()

    socket.on('connect', () => {
      socket.write(encodeClientHello(MIN_PROTOCOL_VERSION, MAX_PROTOCOL_VERSION))
    })

    socket.on('data', (chunk) => {
      received = received.length === 0 ? chunk : Buffer.concat([received, chunk])

      try {
        if (connection === null) {
          if (received.length < SERVER_HELLO_BYTES) return
          clearTimeout(helloTimer)

          const hello = decodeServerHello(received)
          received = received.subarray(SERVER_HELLO_BYTES)

          if (hello.status === HelloStatus.NoCommonVersion) {
            failure = 'incompatible'
            this.#report(
              'version',
              `[setlist] YARG speaks no setlist protocol version YASS knows ` +
                `(YASS: ${MIN_PROTOCOL_VERSION}–${MAX_PROTOCOL_VERSION})`,
            )
            socket.destroy()
            return
          }
          if (hello.status === HelloStatus.Busy) {
            this.#report('busy', '[setlist] YARG is already serving as many setlist apps as it allows')
            socket.destroy()
            return
          }
          if (
            hello.status !== HelloStatus.Ok ||
            hello.version < MIN_PROTOCOL_VERSION ||
            hello.version > MAX_PROTOCOL_VERSION
          ) {
            throw new ProtocolError(`unexpected hello: status ${hello.status}, version ${hello.version}`)
          }

          connection = {
            socket,
            version: hello.version,
            revision: 0,
            pending: new Map(),
            awaitingSnapshot: [],
          }
          this.#connection = connection
          this.#failures = 0
          this.#reported.clear()
          console.log(
            `[setlist] following YARG's setlist on 127.0.0.1:${port} (protocol ${hello.version})`,
          )
        }

        let lastToken: number | null = null
        for (let frame = readFrame(received); frame !== null; frame = readFrame(received)) {
          received = received.subarray(frame.size)
          lastToken = this.#handleFrame(connection, frame.type, frame.payload) ?? lastToken
        }

        if (lastToken !== null) socket.write(encodeAck(lastToken))
      } catch (error) {
        // See the header: an unreadable frame can't be acked, so the
        // connection is stuck until it is replaced.
        const reason = error instanceof Error ? error.message : error
        console.warn('[setlist] dropping the connection:', reason)
        socket.destroy()
      }
    })

    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNREFUSED' && error.code !== 'ECONNRESET') {
        this.#report(`error:${error.code}`, `[setlist] ${error.message}`)
      }
    })

    socket.on('close', () => {
      clearTimeout(helloTimer)
      if (connection !== null) this.#abandon(connection)

      // A socket replaced by `#disconnect` has already been accounted for.
      if (this.#socket !== socket) return
      this.#socket = null
      this.#connection = null

      if (connection !== null) console.log('[setlist] YARG closed the setlist socket')
      this.#setFeed(idleFeed(linkFromSettings(this.#settings)))
      this.#scheduleRetry(failure)
    })
  }

  /** Returns the frame's ack token, or null for a frame type this version doesn't read. */
  #handleFrame(connection: Connection, type: number, payload: Buffer): number | null {
    if (type === FrameType.Snapshot) {
      const snapshot = decodeSnapshot(payload, connection.version)
      connection.revision = snapshot.revision
      this.#setFeed(feedFromSnapshot(snapshot, connection.version))

      const shown = connection.awaitingSnapshot.filter(
        ({ result }) => result.revision <= snapshot.revision,
      )
      connection.awaitingSnapshot = connection.awaitingSnapshot.filter(
        ({ result }) => result.revision > snapshot.revision,
      )
      for (const { result, pending } of shown) {
        clearTimeout(pending.timer)
        pending.resolve(result)
      }
      return snapshot.token
    }

    if (type === FrameType.Result) {
      const result = decodeResult(payload)
      const pending = connection.pending.get(result.requestId)
      if (pending === undefined) return result.token
      connection.pending.delete(result.requestId)

      // Snapshots and results share one ordered stream, so a revision already
      // applied has been published; a later one is on its way.
      if (result.revision <= connection.revision) {
        clearTimeout(pending.timer)
        pending.resolve(result)
      } else {
        connection.awaitingSnapshot.push({ result, pending })
      }
      return result.token
    }

    return null
  }

  /** Fail every command still waiting on a connection that has gone. */
  #abandon(connection: Connection): void {
    const error = new SetlistConnectionLostError('the connection to YARG closed')

    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    connection.pending.clear()

    // These were answered, just not yet shown: the answer still stands.
    for (const { result, pending } of connection.awaitingSnapshot) {
      clearTimeout(pending.timer)
      pending.resolve(result)
    }
    connection.awaitingSnapshot = []
  }

  #disconnect(): void {
    const socket = this.#socket
    if (socket === null) return
    const connection = this.#connection
    this.#socket = null
    this.#connection = null
    if (connection !== null) this.#abandon(connection)
    socket.destroy()
    this.#setFeed(idleFeed(linkFromSettings(this.#settings)))
  }

  #scheduleRetry(failure: Failure): void {
    if (this.#stopped) return
    this.#clearRetry()

    let delay: number
    if (failure === 'incompatible') {
      delay = this.#timings.retryIncompatibleMs
    } else {
      const { retryMinMs, retryMaxMs } = this.#timings
      delay = Math.min(retryMaxMs, retryMinMs * 2 ** this.#failures)
      this.#failures++
    }

    // ±20%, so YASS and any other app retrying alongside it don't arrive in step.
    delay *= 0.8 + Math.random() * 0.4

    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null
      this.#connect()
    }, delay)
    this.#retryTimer.unref?.()
  }

  #retryNow(): void {
    this.#clearRetry()
    this.#failures = 0
    this.#connect()
  }

  #clearRetry(): void {
    if (this.#retryTimer === null) return
    clearTimeout(this.#retryTimer)
    this.#retryTimer = null
  }

  #report(key: string, message: string): void {
    if (this.#reported.has(key)) return
    this.#reported.add(key)
    console.warn(message)
  }

  #setFeed(feed: SetlistFeed): void {
    const unchanged =
      feed.link === this.#feed.link &&
      feed.version === this.#feed.version &&
      !feed.active &&
      !this.#feed.active &&
      feed.entries.length === 0 &&
      this.#feed.entries.length === 0
    this.#feed = feed
    if (unchanged) return

    for (const listener of this.#listeners) {
      try {
        listener(feed)
      } catch (error) {
        console.error('[setlist] subscriber:', error)
      }
    }
  }
}
