/**
 * YARG's setlist and YASS's rules for editing it, both played by the page.
 *
 * In the real app these are two processes: YARG holds the setlist and answers
 * commands on its socket, and `server/src/core/setlist.ts` stands between it
 * and the phones, deciding who may ask for what and keeping the last active
 * setlist on the wire while YARG shares nothing. This file keeps the same two
 * layers apart — the private fields with no owner in them are YARG, the owner
 * map and `#lastActive` are the server — because the client was written
 * against what comes out of the pair, and only a copy of the pair produces
 * every state it has to draw: the stale setlist after a show, the cleared one,
 * and each refusal in `SetlistRefusal` that a guest can reach.
 *
 * What it does not copy is everything that can't go wrong in a page: there is
 * no socket to lose, no YARG too old to edit through, and no host to switch
 * guest edits off, so `unavailable`, `connectionLost`, `editsOff` and `failed`
 * never happen here. IDs are never reused either, since this YARG never
 * restarts, so ownership is matched by ID alone.
 *
 * ## Where the server's rules stop and the demo's start
 *
 * The YASS half follows `core/setlist.ts` exactly. The YARG half is a guess at
 * YARG's own behaviour where its protocol only names the outcome:
 *
 * - **Checks run in a fixed order**: inactive, then players choosing parts,
 *   then the song or entry itself. A remove of somebody else's entry is
 *   `notYours` even while inactive, because YASS refuses it before YARG is
 *   ever asked — which is also the real order.
 * - **A move never lands among played songs.** Mid-show, `start` means the
 *   first slot after the current song, and `after` a played entry clamps to
 *   the same place, rather than refusing a move whose intent is plain.
 * - **`incompatible` is the demo band's singer.** Somebody in the simulated
 *   show is always on vocals, so mid-show a song with no vocal part is refused
 *   — the case the refusal exists for, and common enough in the demo library
 *   (about a third of it) that a visitor adding songs during a show meets it
 *   without looking. Before a show anything goes, as in YARG; the host's own
 *   picks are drawn from songs with vocals all the same, so the demo isn't
 *   forever playing songs its own band would be turned away from.
 */

import type {
  SetlistEditResult,
  SetlistEntry,
  SetlistPlacement,
  SetlistRefusal,
  SetlistState,
  Song,
} from '@shared/types'

/** YARG's cap on remote adds. The host can queue past it in YARG; a phone can't. */
const MAX_REMOTE_ENTRIES = 500

/** What YARG's socket would send: no songs at all while inactive. */
interface Feed {
  active: boolean
  showInProgress: boolean
  currentIndex: number | null
  entries: SetlistEntry[]
  updatedAt: number
}

export class MockSetlist {
  readonly #songs: ReadonlyMap<string, Song>
  readonly #publish: (state: SetlistState) => void

  #entries: SetlistEntry[] = []
  #active = true
  #show = false
  #current: number | null = null
  /**
   * Players choosing parts before a show's first song, when YARG holds every
   * edit. On the wire this looks like any other moment of the show, which is
   * why it is its own flag rather than a value of `#current`.
   */
  #choosingParts = false
  #nextId = 1

  #owners = new Map<number, { guest: string; hash: string }>()
  #lastActive: Feed | null = null
  #state: SetlistState

  constructor(songs: readonly Song[], publish: (state: SetlistState) => void) {
    this.#songs = hashIndex(songs)
    this.#publish = publish
    this.#state = this.#observe()
  }

  get state(): SetlistState {
    return this.#state
  }

  // --- YARG, driven by the show machine in `backend.ts` ----------------------

  /** The host queueing a song in YARG. Not a remote add, so neither cap nor band applies. */
  hostAdd(song: Song): boolean {
    const { hash } = song
    if (!this.#active || hash === null || this.#entries.some((entry) => entry.hash === hash)) {
      return false
    }

    this.#entries.push(this.#entryFor(song, hash))
    this.#changed()
    return true
  }

  /** Start a show on the setlist as it stands. False when there is nothing to play. */
  beginShow(): boolean {
    if (this.#entries.length === 0) return false

    this.#show = true
    this.#current = 0
    this.#choosingParts = true
    this.#changed()
    return true
  }

  /**
   * The current entry's song starting.
   *
   * Nothing on the wire moves — `currentIndex` already points here — so this
   * publishes nothing; it only lets edits through again.
   */
  startSong(): SetlistEntry | null {
    this.#choosingParts = false
    return this.#current === null ? null : (this.#entries[this.#current] ?? null)
  }

  /** The score screen's Continue. False when that was the last song. */
  continueShow(): boolean {
    if (this.#current === null || this.#current + 1 >= this.#entries.length) return false

    this.#current += 1
    this.#changed()
    return true
  }

  /**
   * The show over and YARG back in its menus: inactive, and wiped.
   *
   * YARG wipes the setlist on the menu-scene load, but an inactive setlist
   * sends no songs, so the wipe can't be seen until it comes back active —
   * and until then the server keeps showing the show that just finished.
   */
  endShow(): void {
    this.#active = false
    this.#show = false
    this.#current = null
    this.#choosingParts = false
    this.#entries = []
    this.#changed()
  }

  /** The host opening the music library again: active and empty, which is "cleared". */
  reopen(): void {
    this.#active = true
    this.#changed()
  }

  // --- YASS, as `core/setlist.ts` --------------------------------------------

  add(guest: string, hash: string): SetlistEditResult {
    const result = this.#yargAdd(hash)
    if (result.ok) this.#owners.set(result.entryId, { guest, hash })
    return this.#answer(result)
  }

  remove(guest: string, entryId: number): SetlistEditResult {
    const refused = this.#refuseUnowned(guest, entryId)
    if (refused) return refused

    const result = this.#yargRemove(entryId)
    if (result.ok) this.#owners.delete(entryId)
    return this.#answer(result)
  }

  move(guest: string, entryId: number, placement: SetlistPlacement): SetlistEditResult {
    return this.#refuseUnowned(guest, entryId) ?? this.#answer(this.#yargMove(entryId, placement))
  }

  #refuseUnowned(guest: string, entryId: number): SetlistEditResult | null {
    return this.#owners.get(entryId)?.guest === guest ? null : refusal('notYours')
  }

  /**
   * Tell every phone before answering the one that asked.
   *
   * The real route answers only after the setlist event showing the change has
   * gone out, so a phone never hears "added" ahead of the list it was added to
   * — and `useSetlist` is written to that order.
   */
  #answer(result: SetlistEditResult): SetlistEditResult {
    if (result.ok) this.#changed()
    return result
  }

  // --- YARG's half of an edit ------------------------------------------------

  #yargAdd(hash: string): SetlistEditResult {
    const held = this.#refuseHeld()
    if (held) return held

    const song = this.#songs.get(hash)
    if (song === undefined) return refusal('songNotFound')

    const copy = this.#entries.find((entry) => entry.hash === hash)
    if (copy !== undefined) return { ok: false, reason: 'alreadyInSetlist', entryId: copy.id }

    if (this.#entries.length >= MAX_REMOTE_ENTRIES) return refusal('full')
    if (this.#show && song.vocalParts === 0) return refusal('incompatible')

    const entry = this.#entryFor(song, hash)
    this.#entries.push(entry)
    return { ok: true, entryId: entry.id as number }
  }

  #yargRemove(entryId: number): SetlistEditResult {
    const held = this.#refuseHeld()
    if (held) return held

    const index = this.#entries.findIndex((entry) => entry.id === entryId)
    if (index === -1) return refusal('entryNotFound')
    if (this.#isPlayed(index)) return refusal('locked')

    this.#entries.splice(index, 1)
    return { ok: true, entryId }
  }

  #yargMove(entryId: number, placement: SetlistPlacement): SetlistEditResult {
    const held = this.#refuseHeld()
    if (held) return held

    const index = this.#entries.findIndex((entry) => entry.id === entryId)
    if (index === -1) return refusal('entryNotFound')
    if (this.#isPlayed(index)) return refusal('locked')

    if (placement.position === 'after') {
      if (placement.anchorId === entryId) return { ok: true, entryId }
      if (!this.#entries.some((entry) => entry.id === placement.anchorId)) {
        return refusal('anchorNotFound')
      }
    }

    const [entry] = this.#entries.splice(index, 1)
    if (entry === undefined) return refusal('entryNotFound')

    const floor = this.#current === null ? 0 : this.#current + 1
    const target =
      placement.position === 'start'
        ? floor
        : placement.position === 'end'
          ? this.#entries.length
          : Math.max(
              floor,
              this.#entries.findIndex((candidate) => candidate.id === placement.anchorId) + 1,
            )

    this.#entries.splice(target, 0, entry)
    return { ok: true, entryId }
  }

  /** What YARG says before looking at the song or the entry at all. */
  #refuseHeld(): SetlistEditResult | null {
    if (!this.#active) return refusal('inactive')
    if (this.#choosingParts) return refusal('locked')
    return null
  }

  /** Played, or playing: everything up to and including the current entry. */
  #isPlayed(index: number): boolean {
    return this.#current !== null && index <= this.#current
  }

  #entryFor(song: Song, hash: string): SetlistEntry {
    const id = this.#nextId
    this.#nextId += 1

    return {
      id,
      hash,
      name: song.name,
      artist: song.artist,
      album: song.album,
      lengthSeconds: song.lengthSeconds,
    }
  }

  // --- The wire --------------------------------------------------------------

  #changed(): void {
    this.#state = this.#observe()
    this.#publish(this.#state)
  }

  /**
   * One snapshot from YARG, as the server turns it into a `SetlistState`.
   *
   * The same steps as the server's subscriber and `current` getter: remember
   * the feed if it is active, forget owners an active setlist no longer holds,
   * and stand the last active feed in while this one is inactive.
   */
  #observe(): SetlistState {
    const feed: Feed = this.#active
      ? {
          active: true,
          showInProgress: this.#show,
          currentIndex: this.#current,
          entries: this.#entries.map((entry) => ({ ...entry })),
          updatedAt: Date.now(),
        }
      : { active: false, showInProgress: false, currentIndex: null, entries: [], updatedAt: Date.now() }

    if (feed.active) {
      this.#lastActive = feed

      const held = new Map(feed.entries.map((entry) => [entry.id, entry.hash]))
      for (const [id, owner] of this.#owners) {
        if (held.get(id) !== owner.hash) this.#owners.delete(id)
      }
    }

    const shown = feed.active ? feed : (this.#lastActive ?? feed)

    return {
      link: 'connected',
      guestEdits: 'on',
      active: feed.active,
      showInProgress: shown.showInProgress,
      currentIndex: shown.currentIndex,
      totalCount: shown.entries.length,
      entries: shown.entries,
      seenAt: this.#lastActive?.updatedAt ?? null,
      updatedAt: feed.updatedAt,
    }
  }
}

/** Songs by hash, the key the setlist joins on. Every demo song has one. */
export function hashIndex(songs: readonly Song[]): ReadonlyMap<string, Song> {
  const index = new Map<string, Song>()
  for (const song of songs) if (song.hash !== null) index.set(song.hash, song)
  return index
}

function refusal(reason: SetlistRefusal): SetlistEditResult {
  return { ok: false, reason, entryId: null }
}
