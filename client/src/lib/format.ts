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

/** `$DEFAULT$` is YARG's "no source" sentinel; other ids pass through as authored. */
export function formatSource(source: string): string {
  if (!source || source === '$DEFAULT$') return 'Custom'
  return source
}

const VOCAL_PART_LABELS = ['No vocals', 'Solo vocals', '2-part harmony', '3-part harmony']

export function formatVocalParts(count: number): string {
  return VOCAL_PART_LABELS[count] ?? `${count} parts`
}

/** Unicode combining diacritical marks. */
const COMBINING_MARKS = /[̀-ͯ]/g

/** Strip diacritics and lowercase, so searching "motorhead" matches "Motörhead". */
export function foldForSearch(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()
}

export function formatRelativeTime(epochMs: number | null): string {
  if (epochMs === null) return 'unknown'

  const deltaMs = Date.now() - epochMs
  const minutes = Math.round(deltaMs / 60_000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`

  return new Date(epochMs).toLocaleDateString()
}
