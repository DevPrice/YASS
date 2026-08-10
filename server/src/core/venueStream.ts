/**
 * YARG's venue lighting broadcast.
 *
 * YARG can emit a UDP datagram describing what its stage lighting is doing —
 * the feed YALCY consumes to drive real lights. We listen to the same broadcast
 * and forward a four-field summary so the browser can tint itself to match the
 * room.
 *
 * **This is read-only and best-effort.** Nothing here is required for the app
 * to work: if the stream never arrives, `streaming` stays false and the UI
 * simply never tints. That matters because the sending side is off by default
 * and lives under YARG's *Experimental* settings.
 *
 * Three properties of the source shape everything below:
 *
 * 1. **It is a true broadcast** to 255.255.255.255, not a unicast to one host,
 *    so binding with `reuseAddr` lets us sit alongside a running YALCY rather
 *    than competing with it for the port.
 * 2. **It sends ~88 packets a second**, unconditionally, from the moment the
 *    setting is enabled — through menus, pause and the score screen. Almost all
 *    of them say exactly what the last one said.
 * 3. **Every field we want sits below offset 36**, which is the part of the
 *    layout that has not moved since datagram version 3. We can therefore read
 *    the current version and the two older ones with one set of offsets, and
 *    the version byte only needs checking for a *newer* format that might
 *    renumber them.
 */

import { createSocket } from 'node:dgram'
import type { Socket } from 'node:dgram'

import { LIGHTING_CUES, POST_PROCESSING } from '@shared/types.js'
import type { LightingCue, PostProcessing, VenueState } from '@shared/types.js'

/** Hardcoded in YARG; there is no setting for it. */
const PORT = 36107

/** `0x59415247` — "YARG" as a little-endian uint32, so the bytes read `G R A Y`. */
const HEADER = 0x59415247

/** Datagram version 3 and up. Shorter than this cannot contain the fields we read. */
const MIN_PACKET_BYTES = 47

/**
 * The newest layout we have checked the offsets against.
 *
 * A newer sender is *probably* still compatible — every version so far has
 * appended or inserted after offset 36 — but "probably" is not a thing to
 * assert about a byte offset, so we stop reading instead of rendering a colour
 * from whatever now lives at byte 34.
 */
const MAX_KNOWN_VERSION = 5

const OFFSET = {
  header: 0,
  version: 4,
  scene: 6,
  paused: 7,
  bpm: 9,
  section: 13,
  cue: 34,
  grade: 35,
} as const

const SCENE_GAMEPLAY = 2
const PAUSE_PAUSED = 2

/** The two `LightingCue` values YARG diverts into the song-section byte. */
const SECTION_CHORUS = 2
const SECTION_VERSE = 5

/**
 * Longest gap before we call the stream dead.
 *
 * At 88 Hz a packet is due every 11ms, so this is ~175 missed packets. It is
 * generous on purpose: the cost of declaring death early is the tint snapping
 * off mid-song, and the cost of declaring it late is a colour lingering two
 * seconds after YARG quits.
 */
const STALE_MS = 2_000

/**
 * Floor on how often a change reaches the browser.
 *
 * Two jobs. The obvious one is not turning an 88 Hz feed into 88 SSE frames a
 * second per phone. The other is a hard guarantee about flashing: a tint that
 * cannot change more than twice a second cannot approach the three-per-second
 * threshold in WCAG 2.3.1, no matter what the chart does. That guarantee is
 * structural rather than a promise about which cues we map — which is why the
 * throttle lives here and not in the client's CSS.
 */
const MIN_PUBLISH_INTERVAL_MS = 500

export const IDLE_VENUE: VenueState = {
  streaming: false,
  cue: null,
  grade: null,
  section: null,
  bpm: null,
}

function sameState(a: VenueState, b: VenueState): boolean {
  return (
    a.streaming === b.streaming &&
    a.cue === b.cue &&
    a.grade === b.grade &&
    a.section === b.section &&
    a.bpm === b.bpm
  )
}

/**
 * Tempo, rounded and sanity-checked.
 *
 * Rounding alone is not enough to make this field quiet — see `stableBpm`.
 */
function readBpm(packet: Buffer): number | null {
  const bpm = Math.round(packet.readFloatLE(OFFSET.bpm))
  return Number.isFinite(bpm) && bpm > 0 && bpm < 1000 ? bpm : null
}

/**
 * How far the tempo has to move before we admit it changed.
 *
 * Measured against a live chart, YARG's reported tempo wanders across a 6 BPM
 * spread packet to packet — 175 through 181 on a song sitting at about 178 —
 * because it is derived from note timing rather than read from the tempo map.
 * Without a deadband every one of those wobbles is a state change, and this
 * field alone would hold the publisher at its 2 Hz ceiling for the whole song.
 *
 * That is not just wasted bandwidth. The client re-times its colour drift when
 * the tempo changes, so a value that never settles means a timer that is
 * always being restarted and a wash that never advances — the field intended
 * to pace the effect would stop it instead.
 *
 * Eight is wide enough to swallow that spread including its outliers, and the
 * cost of being wrong by eight is a drift step off by five percent, on an
 * effect that takes seconds to cross. The tempo changes worth catching are
 * half-time drops and section changes, which are far larger than this.
 */
const BPM_DEADBAND = 8

/** Carry the previous tempo forward unless this one is genuinely different. */
export function stableBpm(next: number | null, previous: number | null): number | null {
  if (next === null || previous === null) return next
  return Math.abs(next - previous) < BPM_DEADBAND ? previous : next
}

/**
 * Decode one datagram, or null if it isn't one of ours.
 *
 * Exported for the tests: this is pure, and a fixture packet is a much better
 * way to pin the offsets than a socket is.
 */
export function parseVenuePacket(packet: Buffer): VenueState | null {
  if (packet.length < MIN_PACKET_BYTES) return null
  if (packet.readUInt32LE(OFFSET.header) !== HEADER) return null

  const version = packet.readUInt8(OFFSET.version)
  if (version > MAX_KNOWN_VERSION) return null

  // Outside gameplay the lighting fields still carry values — menu cues, the
  // score screen — and none of them describe a room anyone is in.
  const inGameplay =
    packet.readUInt8(OFFSET.scene) === SCENE_GAMEPLAY &&
    packet.readUInt8(OFFSET.paused) !== PAUSE_PAUSED

  if (!inGameplay) {
    return { streaming: true, cue: null, grade: null, section: null, bpm: null }
  }

  const section = packet.readUInt8(OFFSET.section)

  return {
    streaming: true,
    cue: (LIGHTING_CUES[packet.readUInt8(OFFSET.cue)] as LightingCue | undefined) ?? null,
    grade: (POST_PROCESSING[packet.readUInt8(OFFSET.grade)] as PostProcessing | undefined) ?? null,
    section: section === SECTION_CHORUS ? 'chorus' : section === SECTION_VERSE ? 'verse' : null,
    bpm: readBpm(packet),
  }
}

export class VenueStream {
  #socket: Socket | null = null
  #subscribers = new Set<(state: VenueState) => void>()

  /** What subscribers were last told. */
  #published: VenueState = IDLE_VENUE
  /** What the last packet said, which may not have been published yet. */
  #pending: VenueState = IDLE_VENUE

  #lastPublishedAt = 0
  #lastPacketAt = 0
  #trailing: NodeJS.Timeout | null = null
  #staleTimer: NodeJS.Timeout | null = null

  /** Logged once — a bind failure repeats identically forever otherwise. */
  #reportedError = false

  get current(): VenueState {
    return this.#published
  }

  subscribe(listener: (state: VenueState) => void): () => void {
    this.#subscribers.add(listener)
    return () => this.#subscribers.delete(listener)
  }

  start(): void {
    if (this.#socket !== null) return

    // `reuseAddr` is the whole reason we can coexist with YALCY: both processes
    // want the same broadcast on the same port, and without it the second one
    // to start gets EADDRINUSE.
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    this.#socket = socket

    socket.on('message', (packet) => {
      const state = parseVenuePacket(packet)
      if (state === null) return

      this.#lastPacketAt = Date.now()
      this.#pending = { ...state, bpm: stableBpm(state.bpm, this.#published.bpm) }
      this.#publishThrottled()
    })

    socket.on('error', (error) => {
      // A dead lighting socket must never take the song list down with it.
      if (!this.#reportedError) {
        this.#reportedError = true
        console.error('[yass] venue stream:', error.message)
      }
      this.stop()
    })

    socket.bind(PORT)

    this.#staleTimer = setInterval(() => this.#checkStale(), STALE_MS / 2)
    this.#staleTimer.unref?.()
  }

  stop(): void {
    if (this.#trailing !== null) {
      clearTimeout(this.#trailing)
      this.#trailing = null
    }

    if (this.#staleTimer !== null) {
      clearInterval(this.#staleTimer)
      this.#staleTimer = null
    }

    const socket = this.#socket
    this.#socket = null
    socket?.close()

    this.#publish(IDLE_VENUE)
  }

  /** Publish now if we're allowed to, otherwise schedule the latest value. */
  #publishThrottled(): void {
    if (sameState(this.#pending, this.#published)) return

    const waited = Date.now() - this.#lastPublishedAt
    if (waited >= MIN_PUBLISH_INTERVAL_MS) {
      this.#publish(this.#pending)
      return
    }

    if (this.#trailing !== null) return

    this.#trailing = setTimeout(() => {
      this.#trailing = null
      // Publish whatever is current *then*, not what was current when this was
      // scheduled — during a fast cue run the newest value is the true one.
      if (!sameState(this.#pending, this.#published)) this.#publish(this.#pending)
    }, MIN_PUBLISH_INTERVAL_MS - waited)

    this.#trailing.unref?.()
  }

  #publish(state: VenueState): void {
    this.#published = state
    this.#lastPublishedAt = Date.now()

    for (const listener of this.#subscribers) {
      try {
        listener(state)
      } catch (error) {
        console.error('[yass] venue subscriber:', error)
      }
    }
  }

  #checkStale(): void {
    if (!this.#published.streaming) return
    if (Date.now() - this.#lastPacketAt < STALE_MS) return

    this.#pending = IDLE_VENUE
    this.#publish(IDLE_VENUE)
  }
}
