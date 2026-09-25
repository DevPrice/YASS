/**
 * YARG's setlist, from the YARG Setlist Bridge plugin.
 *
 * YARG holds its setlist in memory and writes it nowhere, so no file of the
 * game's can tell us what is queued. The bridge is a separate BepInEx plugin
 * (sibling repo `YARG-Setlist-Bridge`, contract in its `PROTOCOL.md`) that runs
 * inside the game and publishes the setlist over newline-delimited JSON on
 * 127.0.0.1. This is the client for it.
 *
 * **Optional in the same way the venue stream is.** Most hosts will never
 * install a mod, and for them nothing here does anything but watch for a file
 * that never appears. `available: false` is the resting state, not an error.
 *
 * Three properties of the other end shape this:
 *
 *  1. **It is found through a file, not a fixed port.** The plugin writes
 *     `setlist-bridge.json` into YARG's data folder — the folder this app
 *     already follows — with the port and a token that changes every launch.
 *     So the file is the trigger, watched like `currentSong.json`, and a slow
 *     poll is the backstop for a watch that went deaf.
 *  2. **It can vanish without saying so.** YARG can crash and leave the file
 *     behind, pointing at a port nobody holds. A refused connection is
 *     therefore "unavailable, try again later", never a reason to stop.
 *  3. **Every message is the whole state.** There is no diff to apply and
 *     nothing to reconcile after a reconnect: the first `state` after the
 *     handshake is simply the truth.
 *
 * Nothing is ever sent to the plugin except the handshake: protocol version 1
 * is read-only.
 */

import { readFile } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { createInterface } from 'node:readline'

import type { Setlist } from '@shared/types.js'
import { FileWatcher } from './fileWatcher.js'
import { setlistBridgePath } from './paths.js'

/** The only protocol version this client speaks. */
export const PROTOCOL_VERSION = 1

/** Quiet period after the discovery file changes; it is written atomically, so this only collapses the event burst. */
const WATCH_SETTLE_MS = 100

/**
 * How often to re-check without being told.
 *
 * Covers a watch that died silently, and a plugin that restarted its listener
 * without rewriting the file. Each check is one small file read, plus a connect
 * attempt only when we are not already connected.
 */
const BACKSTOP_MS = 5_000

/** Give up on a connect or handshake that hangs; the next check retries. */
const CONNECT_TIMEOUT_MS = 3_000

export const UNAVAILABLE: Setlist = {
  available: false,
  mode: 'idle',
  index: null,
  songs: [],
  updatedAt: 0,
}

export interface BridgeDiscovery {
  port: number
  token: string
  pid: number | null
}

/**
 * Validate the discovery file. Null for anything this client can't use —
 * including a newer protocol, which it must not guess at.
 *
 * Exported for the tests.
 */
export function parseDiscovery(text: string): BridgeDiscovery | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null

  const { protocol, port, token, pid } = raw as Record<string, unknown>
  if (protocol !== PROTOCOL_VERSION) return null
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (typeof token !== 'string' || token === '') return null

  return { port, token, pid: typeof pid === 'number' ? pid : null }
}

const HASH = /^[0-9A-F]{40}$/
const MODES = new Set<Setlist['mode']>(['idle', 'building', 'playing'])

/** The parts of a `state` message worth keeping, before the library join. */
export interface BridgeState {
  mode: Setlist['mode']
  index: number | null
  hashes: string[]
}

/**
 * Validate one `state` message. Null for any other message type, or for a
 * state that doesn't hold together — the next one will be whole again.
 *
 * Exported for the tests.
 */
export function parseStateMessage(raw: unknown): BridgeState | null {
  if (!raw || typeof raw !== 'object') return null
  const message = raw as Record<string, unknown>
  if (message.type !== 'state') return null

  const mode = message.mode
  if (typeof mode !== 'string' || !MODES.has(mode as Setlist['mode'])) return null

  const songs = message.songs
  if (!Array.isArray(songs) || !songs.every((hash) => typeof hash === 'string' && HASH.test(hash))) {
    return null
  }

  let index: number | null = null
  if (mode === 'playing') {
    const raw = message.index
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw >= songs.length) return null
    index = raw
  }

  return { mode: mode as Setlist['mode'], index, hashes: songs as string[] }
}

export interface SetlistBridgeOptions {
  /** Read lazily so a settings change takes effect without a restart. */
  getDataDir: () => string
  /** Join a setlist hash to a library song, when the library has one. */
  resolveLibraryId: (hash: string) => string | null
  /** Override for tests. */
  backstopMs?: number
}

export class SetlistBridge {
  #options: SetlistBridgeOptions
  #state: Setlist = { ...UNAVAILABLE, updatedAt: Date.now() }
  /** The last state message, kept so a library reload can redo the join. */
  #raw: BridgeState | null = null
  #listeners = new Set<(state: Setlist) => void>()

  #file: FileWatcher
  #timer: NodeJS.Timeout | null = null
  #stopped = true

  #socket: Socket | null = null
  /** `port:token` of the connection in hand, so an unchanged file is a no-op. */
  #connectedTo: string | null = null
  /** Serialises checks: a watch event and the backstop can land together. */
  #checking = false
  #pending = false
  /** Logged once per discovery, not on every five-second retry. */
  #reported: string | null = null

  constructor(options: SetlistBridgeOptions) {
    this.#options = options

    this.#file = new FileWatcher({
      getPath: () => {
        const dir = this.#options.getDataDir()
        return dir === '' ? '' : setlistBridgePath(dir)
      },
      settleMs: WATCH_SETTLE_MS,
      // The file going away is the plugin saying YARG quit.
      notifyOnMissing: true,
      onChange: () => this.#check(),
      onError: (error) => {
        console.warn('[setlist] watch failed, falling back to polling:', error)
      },
    })
  }

  get current(): Setlist {
    return this.#state
  }

  subscribe(listener: (state: Setlist) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async start(): Promise<void> {
    if (!this.#stopped) return
    this.#stopped = false

    await this.#file.start()

    this.#timer = setInterval(() => void this.#check(), this.#options.backstopMs ?? BACKSTOP_MS)
    this.#timer.unref?.()

    void this.#check()
  }

  /** Follow a new data directory: a different install, so a different game to talk to. */
  async rearm(): Promise<void> {
    if (this.#stopped) return
    this.#disconnect()
    await this.#file.start()
    await this.#check()
  }

  stop(): void {
    this.#stopped = true
    this.#file.stop()
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }
    this.#disconnect()
  }

  /** Re-resolve the library join, e.g. after the song list is reloaded. */
  refreshLibraryJoin(): void {
    if (this.#raw !== null) this.#publishRaw(this.#raw)
  }

  async #check(): Promise<void> {
    if (this.#stopped) return
    if (this.#checking) {
      // The file moved mid-check, and the read in flight may be from before it.
      this.#pending = true
      return
    }
    this.#checking = true

    try {
      const discovery = await this.#readDiscovery()

      if (discovery === null) {
        this.#disconnect()
        return
      }

      const key = `${discovery.port}:${discovery.token}`
      if (this.#socket !== null && this.#connectedTo === key) return

      this.#disconnect()
      this.#connect(discovery, key)
    } finally {
      this.#checking = false
    }

    if (this.#pending) {
      this.#pending = false
      await this.#check()
    }
  }

  async #readDiscovery(): Promise<BridgeDiscovery | null> {
    const dir = this.#options.getDataDir()
    if (dir === '') return null

    let text: string
    try {
      text = await readFile(setlistBridgePath(dir), 'utf8')
    } catch {
      // No plugin, or YARG isn't running. The ordinary case.
      return null
    }

    const discovery = parseDiscovery(text)
    if (discovery === null) this.#reportOnce('unusable', '[setlist] setlist-bridge.json is unreadable or a newer protocol; ignoring it')
    return discovery
  }

  #connect(discovery: BridgeDiscovery, key: string): void {
    const socket = connect({ host: '127.0.0.1', port: discovery.port })
    this.#socket = socket
    this.#connectedTo = key

    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.on('timeout', () => socket.destroy())

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ type: 'auth', token: discovery.token })}\n`)
    })

    socket.on('error', (error: NodeJS.ErrnoException) => {
      // ECONNREFUSED here is usually a file left behind by a YARG that crashed.
      this.#reportOnce(key, `[setlist] cannot reach the bridge on port ${discovery.port}: ${error.code ?? error.message}`)
    })

    socket.on('close', () => {
      // A newer connection may already have replaced this one.
      if (this.#socket !== socket) return
      this.#socket = null
      this.#connectedTo = null
      this.#setUnavailable()
    })

    const lines = createInterface({ input: socket })
    // readline re-emits its input's errors, and an unhandled one throws. The
    // socket's own handler above is where they are dealt with.
    lines.on('error', () => {})
    lines.on('line', (line) => {
      if (this.#socket !== socket) return

      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        return
      }

      const type = (message as { type?: unknown } | null)?.type

      if (type === 'hello') {
        // Authenticated. From here the plugin only speaks when something
        // changes, which can be hours at a quiet party.
        socket.setTimeout(0)
        this.#reported = null
        console.log(`[setlist] connected to the YARG Setlist Bridge on port ${discovery.port}`)
        return
      }

      if (type === 'error') {
        // `unauthorized` means the token is stale — a relaunch rewrote the file
        // after we read it. Drop the connection; the watch brings the new one.
        this.#reportOnce(key, `[setlist] bridge refused the connection: ${String((message as { code?: unknown }).code)}`)
        socket.destroy()
        return
      }

      const state = parseStateMessage(message)
      if (state !== null) this.#publishRaw(state)
    })
  }

  #disconnect(): void {
    const socket = this.#socket
    this.#socket = null
    this.#connectedTo = null
    socket?.destroy()
    this.#setUnavailable()
  }

  #publishRaw(raw: BridgeState): void {
    this.#raw = raw
    this.#setState({
      available: true,
      mode: raw.mode,
      index: raw.index,
      songs: raw.hashes.map((hash) => ({ hash, libraryId: this.#options.resolveLibraryId(hash) })),
      updatedAt: Date.now(),
    })
  }

  #setUnavailable(): void {
    this.#raw = null
    if (!this.#state.available) return
    this.#setState({ ...UNAVAILABLE, updatedAt: Date.now() })
  }

  #setState(state: Setlist): void {
    if (this.#stopped && state.available) return
    if (sameSetlist(this.#state, state)) return

    this.#state = state
    for (const listener of this.#listeners) {
      try {
        listener(state)
      } catch (error) {
        console.warn('[setlist] listener failed:', error)
      }
    }
  }

  #reportOnce(key: string, message: string): void {
    if (this.#reported === key) return
    this.#reported = key
    console.warn(message)
  }
}

/** Field-wise comparison, so subscribers only hear about a real change. */
function sameSetlist(a: Setlist, b: Setlist): boolean {
  return (
    a.available === b.available &&
    a.mode === b.mode &&
    a.index === b.index &&
    a.songs.length === b.songs.length &&
    a.songs.every((song, i) => song.hash === b.songs[i]?.hash && song.libraryId === b.songs[i]?.libraryId)
  )
}
