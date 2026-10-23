/**
 * Editing YARG's setlist from this browser, and knowing which entries are its own.
 *
 * The server keeps the real record of who added what, and enforces it; this is
 * the browser's copy, kept only so it knows which songs to offer remove and
 * move on. It can't be sent down with the setlist: that event goes to every
 * phone in the room, and naming each entry's browser there would hand every
 * guest the token of every other.
 *
 * So the browser remembers the entries its own adds returned, as YARG's entry
 * ID with the song's hash beside it — IDs start again at 1 when YARG restarts,
 * and the pair is what survives that.
 */

import type {
  SetlistEditResult,
  SetlistPlacement,
  SetlistState,
} from '@shared/types'

const GUEST_KEY = 'yass.guest'
const MINE_KEY = 'yass.setlist.mine'

/** More than YARG's own 500-song cap on remote adds, so it never cuts a real one. */
const MAX_REMEMBERED = 600

let guest: string | null = null

/**
 * This browser's name to the server: 128 random bits, made once and kept.
 *
 * `getRandomValues` rather than `randomUUID`, which only exists in a secure
 * context — and a phone on the LAN reaches YASS over plain `http://`.
 *
 * Kept in memory as well, because `localStorage` can refuse (Safari's private
 * browsing, a locked-down profile); a browser that can't store it still edits
 * its own songs for as long as the tab is open.
 */
export function guestToken(): string {
  if (guest !== null) return guest

  try {
    const stored = window.localStorage.getItem(GUEST_KEY)
    if (stored !== null && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) {
      guest = stored
      return guest
    }
  } catch {
    // Fall through to a fresh one.
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  guest = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  try {
    window.localStorage.setItem(GUEST_KEY, guest)
  } catch {
    // See above.
  }

  return guest
}

// --- Which entries are mine -------------------------------------------------

type Mine = Array<[id: number, hash: string]>

let mine: Mine | null = null
const mineListeners = new Set<() => void>()

function readMine(): Mine {
  if (mine !== null) return mine

  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MINE_KEY) ?? '[]')
    mine = Array.isArray(parsed)
      ? parsed.filter(
          (pair): pair is [number, string] =>
            Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'string',
        )
      : []
  } catch {
    mine = []
  }

  return mine
}

function writeMine(next: Mine): void {
  mine = next.slice(-MAX_REMEMBERED)

  try {
    window.localStorage.setItem(MINE_KEY, JSON.stringify(mine))
  } catch {
    // Kept in memory regardless.
  }

  for (const listener of mineListeners) listener()
}

export function subscribeMine(listener: () => void): () => void {
  mineListeners.add(listener)
  return () => mineListeners.delete(listener)
}

/** The IDs of the entries in `state` this browser added. */
export function mineIn(state: SetlistState): ReadonlySet<number> {
  const remembered = new Map(readMine())
  const ids = new Set<number>()

  for (const entry of state.entries) {
    if (entry.id !== null && remembered.get(entry.id) === entry.hash) ids.add(entry.id)
  }

  return ids
}

/**
 * Forget entries a whole, active setlist no longer holds.
 *
 * Not on an inactive one, which sends no songs and can come back exactly as it
 * was, and not on one too long to have been sent whole.
 */
export function pruneMine(state: SetlistState): void {
  if (state.link !== 'connected' || !state.active || state.entries.length < state.totalCount) {
    return
  }

  const current = readMine()
  const held = new Map(state.entries.map((entry) => [entry.id, entry.hash]))
  const kept = current.filter(([id, hash]) => held.get(id) === hash)
  if (kept.length !== current.length) writeMine(kept)
}

// --- Edits ------------------------------------------------------------------

/**
 * What an edit came to, from here.
 *
 * `offline` is the one outcome the server can't send: the phone never heard
 * back from YASS at all. That is a different message from YASS losing YARG
 * mid-command — the first is the guest's Wi-Fi, the second is nobody's fault —
 * and the guest is told which.
 */
export type EditOutcome = SetlistEditResult | { ok: false; reason: 'offline'; entryId: null }

/** Long enough for YASS to wait out YARG's own five seconds, and no longer. */
const EDIT_TIMEOUT_MS = 8_000

async function edit(path: string, method: string, body?: unknown): Promise<EditOutcome> {
  try {
    const response = await fetch(path, {
      method,
      headers: {
        Accept: 'application/json',
        'X-YASS-Guest': guestToken(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(EDIT_TIMEOUT_MS),
    })

    const result = (await response.json()) as Partial<SetlistEditResult>
    if (typeof result.ok === 'boolean') return result as SetlistEditResult
  } catch {
    // The phone lost YASS, or YASS answered with something that isn't a result.
  }

  return { ok: false, reason: 'offline', entryId: null }
}

export async function addToSetlist(hash: string): Promise<EditOutcome> {
  const result = await edit('/api/setlist/entries', 'POST', { hash })
  if (result.ok) writeMine([...readMine(), [result.entryId, hash]])
  return result
}

export async function removeFromSetlist(entryId: number): Promise<EditOutcome> {
  const result = await edit(`/api/setlist/entries/${entryId}`, 'DELETE')
  if (result.ok) writeMine(readMine().filter(([id]) => id !== entryId))
  return result
}

export function moveInSetlist(
  entryId: number,
  placement: SetlistPlacement,
): Promise<EditOutcome> {
  return edit(`/api/setlist/entries/${entryId}/move`, 'POST', placement)
}
