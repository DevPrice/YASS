/**
 * Display formatting.
 *
 * Every YARG numeric field has a sentinel that means "unset", and the loader
 * already maps those to null — so these helpers only have to render null well.
 */

/** Seconds → `M:SS`, matching how YARG itself writes lengths. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'

  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  const remainder = whole % 60

  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function formatYear(year: number | null): string {
  return year === null ? '—' : String(year)
}

/** Difficulty tiers are 0-6 in practice; null means the part isn't charted. */
export function formatDifficulty(tier: number | null): string {
  return tier === null ? '—' : String(tier)
}

// Source display lives in `lib/sources.ts` now: the CSV's ids resolve through
// YARG's own OpenSource registry, which knows `$DEFAULT$` along with 292 other
// spellings. Passing the raw id through as a label was never right.

const VOCAL_PART_LABELS = ['No vocals', 'Solo vocals', '2-part harmony', '3-part harmony']

/**
 * Nothing prints this any more — the count is a picture now, one microphone or
 * two or three. It survives because the picture needs words for anything that
 * cannot see it, and `partName` in `ui/library` speaks these ones.
 */
export function formatVocalParts(count: number): string {
  return VOCAL_PART_LABELS[count] ?? `${count} parts`
}

/**
 * The cover house's own credit, which the CSV leaves in the artist field.
 *
 * Rock Band's re-recordings are filed as `Panic! at the Disco (WaveGroup)` —
 * the studio that performed the cover, parked inside the name of the band that
 * did not. Nobody is looking for WaveGroup. They are looking for Panic!, and
 * the fact that this is not Panic! playing is what `as made famous by` says,
 * in the words a karaoke book has always used for it.
 *
 * Matched anywhere rather than anchored at the end, since the credit trails a
 * bracketed mix note often enough (`Foo (WaveGroup) (Live)`), and loosely
 * enough to catch `(WaveGroup Sound)`.
 */
const COVER_HOUSE = /\s*\(\s*wavegroup[^)]*\)/giu

/** An artist, and whether this chart is actually them playing. */
export interface ArtistCredit {
  /** The performer as the UI says it, cover-house credit removed. */
  name: string
  /** True when somebody else recorded it — the cue for `as made famous by`. */
  madeFamousBy: boolean
}

/**
 * Who to name, and how to introduce them.
 *
 * A stripped credit implies a cover on its own: the CSV's `Master` column is
 * blank often enough on charts that plainly are not the master recording, and
 * a name that had `(WaveGroup)` in it is one of them whatever the column says.
 */
export function artistCredit(song: { artist: string; isMaster: boolean }): ArtistCredit {
  const raw = song.artist.trim()
  const stripped = raw.replace(COVER_HOUSE, '').replace(/\s+/gu, ' ').trim()

  // An artist field that was *only* the credit has nothing left to name, so it
  // keeps what it had — `(WaveGroup)` beats an empty line.
  const covered = stripped !== raw
  const name = stripped === '' ? raw : stripped

  // Nothing to be made famous by: an artist-less chart gets no preamble.
  return { name, madeFamousBy: name !== '' && (covered || !song.isMaster) }
}

/** The artist as one string, for `aria-label`s and other flat text. */
export function formatArtistCredit(song: { artist: string; isMaster: boolean }): string {
  const { name, madeFamousBy } = artistCredit(song)
  return `${madeFamousBy ? 'as made famous by' : 'by'} ${name}`
}

/** Unicode combining diacritical marks. */
const COMBINING_MARKS = /[̀-ͯ]/g

/** Strip diacritics and lowercase, so searching "motorhead" matches "Motörhead". */
export function foldForSearch(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()
}

// `formatRelativeTime` lived here to render "list exported 4h ago" in the
// header. Nothing displays `meta.generatedAt` now that the server watches the
// CSV — the stamp answered a question the app answers by staying current.
