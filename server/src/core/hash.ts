/**
 * Song hash normalization.
 *
 * YARG writes the same SHA-1 two different ways:
 *   - `currentSong.json` serializes `HashWrapper` structurally, yielding
 *     `{ "Hash": { "HashBytes": "<base64>" } }` — confirmed against a live
 *     capture (see `fixtures/currentSong.playing.json`).
 *   - Everywhere else (CSV export, playlists, logs) it is `HashWrapper.ToString()`,
 *     i.e. uppercase hex, 40 characters.
 *
 * Canonical form here is uppercase hex, and comparisons are case-insensitive.
 */

/** 20 bytes of SHA-1 → 40 hex characters. */
const HEX_LENGTH = 40

/** Convert the base64 `HashBytes` from `currentSong.json` to canonical uppercase hex. */
export function base64HashToHex(base64: string | null | undefined): string | null {
  if (!base64) return null

  try {
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length === 0) return null
    return bytes.toString('hex').toUpperCase()
  } catch {
    return null
  }
}

/**
 * Normalize a hash from any source to canonical form.
 *
 * Accepts hex of any case; returns null for anything that isn't plausible hex,
 * so a malformed cell in the CSV degrades to "no hash" rather than a bad join key.
 */
export function normalizeHash(raw: string | null | undefined): string | null {
  if (!raw) return null

  const trimmed = raw.trim()
  if (trimmed.length !== HEX_LENGTH) return null
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) return null

  return trimmed.toUpperCase()
}

/**
 * Pull the hash out of a parsed `currentSong.json`, tolerating both the
 * structural shape we observed and a plain-string shape in case YARG ever wires
 * up `JsonHashWrapperConverter` on this path.
 */
export function extractCurrentSongHash(hashField: unknown): string | null {
  if (typeof hashField === 'string') {
    return normalizeHash(hashField)
  }

  if (hashField && typeof hashField === 'object') {
    const bytes = (hashField as { HashBytes?: unknown }).HashBytes
    if (typeof bytes === 'string') {
      return base64HashToHex(bytes)
    }
  }

  return null
}
