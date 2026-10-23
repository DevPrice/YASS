/**
 * YARG's setlist as phones see it, and the rules for changing it from one.
 *
 * `SetlistClient` speaks to YARG; this decides what a phone may ask of it.
 * Every edit passes through here and nowhere else, which is the point: the
 * rules today are short — anyone adds, a browser removes or moves only what it
 * added, and the host can switch the lot off — but per-guest limits and fair
 * ordering are coming, and both belong at this one door.
 *
 * ## Who added what
 *
 * A browser is named by a random token it makes for itself (`X-YASS-Guest`). It
 * is not authentication — anyone who reads a token off a phone can act as that
 * phone — and needn't be: it guards a party's queue against accidents and
 * mischief, not against an attacker, and the host can always fix the setlist in
 * YARG.
 *
 * Ownership is kept by YARG's entry ID with the song's hash beside it. IDs are
 * stable while YARG runs and restart at 1 when it does, so after a restart an
 * old ID can name a new entry; the hash is what tells those apart. Entries leave
 * this map when a complete, active setlist no longer holds them. An inactive or
 * truncated one proves nothing — an inactive setlist sends no songs at all, and
 * it can come back exactly as it was.
 *
 * Ownership is held in memory. A YASS restart forgets it, after which nobody
 * can edit the songs already queued from a phone; the host still can, in YARG.
 * Tokens never leave this process: the setlist event goes to every phone, so
 * each browser works out which entries are its own from the IDs its adds
 * returned.
 */

import type {
  SetlistEditResult,
  SetlistPlacement,
  SetlistRefusal,
  SetlistState,
} from '@shared/types.js'
import {
  SetlistConnectionLostError,
  SetlistUnavailableError,
  type SetlistClient,
  type SetlistFeed,
} from './setlistClient.js'
import { Position, type Command, type Result } from './setlistProtocol.js'

/** 128 bits of base64url and some slack, and nothing a header could smuggle. */
const GUEST_TOKEN = /^[A-Za-z0-9_-]{16,64}$/

export function isGuestToken(value: string | undefined): value is string {
  return value !== undefined && GUEST_TOKEN.test(value)
}

/** Statuses YARG can answer with that a phone is told about by name. */
const PASSED_THROUGH = new Set<string>([
  'inactive',
  'entryNotFound',
  'anchorNotFound',
  'songNotFound',
  'alreadyInSetlist',
  'locked',
  'full',
  'incompatible',
])

interface Owner {
  guest: string
  hash: string
}

/** The part of `SetlistClient` this needs, so the rules can be tested without a socket. */
export type SetlistConnection = Pick<SetlistClient, 'current' | 'subscribe' | 'send'>

export class Setlist {
  #client: SetlistConnection
  #guestEditsAllowed: () => boolean
  #owners = new Map<number, Owner>()
  /** The last feed that was active: what phones are shown while YARG isn't sharing. */
  #lastActive: SetlistFeed | null = null
  #listeners = new Set<(state: SetlistState) => void>()

  constructor(client: SetlistConnection, guestEditsAllowed: () => boolean) {
    this.#client = client
    this.#guestEditsAllowed = guestEditsAllowed

    client.subscribe((feed) => {
      if (feed.link === 'connected' && feed.active) this.#lastActive = feed
      this.#prune(feed)
      this.#publish()
    })
  }

  get current(): SetlistState {
    const feed = this.#client.current

    // See `SetlistState`: the last active setlist stands in until YARG says otherwise.
    const shown = feed.active ? feed : (this.#lastActive ?? feed)

    return {
      link: feed.link,
      guestEdits: this.#guestEdits(feed.version),
      active: feed.active,
      showInProgress: shown.showInProgress,
      currentIndex: shown.currentIndex,
      totalCount: shown.totalCount,
      entries: shown.entries,
      seenAt: this.#lastActive?.updatedAt ?? null,
      updatedAt: feed.updatedAt,
    }
  }

  subscribe(listener: (state: SetlistState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Tell every phone again, after the host's switch moves. */
  republish(): void {
    this.#publish()
  }

  async add(guest: string, hash: string): Promise<SetlistEditResult> {
    const refused = this.#refuseEdits()
    if (refused) return refused

    const result = await this.#send({ op: 'add', hash, ...this.#placeAdd() })
    if (result.ok) this.#owners.set(result.entryId, { guest, hash })
    return result
  }

  async remove(guest: string, entryId: number): Promise<SetlistEditResult> {
    const refused = this.#refuseEdits() ?? this.#refuseUnowned(guest, entryId)
    if (refused) return refused

    const result = await this.#send({ op: 'remove', entryId })
    if (result.ok) this.#owners.delete(entryId)
    return result
  }

  async move(
    guest: string,
    entryId: number,
    placement: SetlistPlacement,
  ): Promise<SetlistEditResult> {
    const refused = this.#refuseEdits() ?? this.#refuseUnowned(guest, entryId)
    if (refused) return refused

    return this.#send({
      op: 'move',
      entryId,
      position:
        placement.position === 'start'
          ? Position.Start
          : placement.position === 'end'
            ? Position.End
            : Position.After,
      anchorId: placement.position === 'after' ? placement.anchorId : 0,
    })
  }

  /**
   * Where a guest's add lands.
   *
   * The end, for now. This is where fair ordering goes — "after this guest's
   * last song plus everyone else's next one", say — which is why YARG takes an
   * anchor at all.
   */
  #placeAdd(): { position: typeof Position.End; anchorId: number } {
    return { position: Position.End, anchorId: 0 }
  }

  #guestEdits(version: number): SetlistState['guestEdits'] {
    // A connected YARG that can't take commands is the one case worth naming;
    // with no connection, `link` already says why and the switch is the answer.
    if (this.#client.current.link === 'connected' && version < 2) return 'unsupported'
    return this.#guestEditsAllowed() ? 'on' : 'off'
  }

  #refuseEdits(): SetlistEditResult | null {
    const feed = this.#client.current
    if (feed.link !== 'connected' || feed.version < 2) return refusal('unavailable')
    if (!this.#guestEditsAllowed()) return refusal('editsOff')
    return null
  }

  #refuseUnowned(guest: string, entryId: number): SetlistEditResult | null {
    const owner = this.#owners.get(entryId)
    if (owner === undefined || owner.guest !== guest) return refusal('notYours')

    // The ID may have been reused by a YARG that restarted since.
    const entry = this.#client.current.entries.find((candidate) => candidate.id === entryId)
    if (entry !== undefined && entry.hash !== owner.hash) {
      this.#owners.delete(entryId)
      return refusal('notYours')
    }

    return null
  }

  async #send(command: Command): Promise<SetlistEditResult> {
    let result: Result
    try {
      result = await this.#client.send(command)
    } catch (error) {
      if (error instanceof SetlistUnavailableError) return refusal('unavailable')
      if (error instanceof SetlistConnectionLostError) return refusal('connectionLost')
      throw error
    }

    if (result.status === 'ok') return { ok: true, entryId: result.entryId }

    const reason: SetlistRefusal =
      typeof result.status === 'string' && PASSED_THROUGH.has(result.status)
        ? (result.status as SetlistRefusal)
        : 'failed'
    if (reason === 'failed') console.warn('[setlist] YARG refused a command:', result.status)

    return { ok: false, reason, entryId: result.entryId === 0 ? null : result.entryId }
  }

  #prune(feed: SetlistFeed): void {
    if (feed.link !== 'connected' || !feed.active || !feed.complete) return

    const held = new Map(feed.entries.map((entry) => [entry.id, entry.hash]))
    for (const [id, owner] of this.#owners) {
      if (held.get(id) !== owner.hash) this.#owners.delete(id)
    }
  }

  #publish(): void {
    const state = this.current
    for (const listener of this.#listeners) {
      try {
        listener(state)
      } catch (error) {
        console.error('[setlist] subscriber:', error)
      }
    }
  }
}

function refusal(reason: SetlistRefusal): SetlistEditResult {
  return { ok: false, reason, entryId: null }
}
