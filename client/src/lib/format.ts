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

/**
 * The names YARG gives a band-difficulty tier.
 *
 * Transcribed from `Assets/StreamingAssets/lang/en-US.json`
 * (`Menu.Filters.Intensities`), and indexed exactly as `FiltersMenu.cs` indexes
 * them: **the tier is the index.** `0` is `Warm Up`, `6` is `Impossible`, and
 * anything past the end of the table clamps to the last name rather than
 * inventing one — which is also what the ring does when it turns fully red past
 * six. See `DifficultyRing` in `ui/library.tsx`.
 *
 * These are the game's words rather than ours, for the same reason source ids
 * resolve through OpenSource: anybody who has picked a song in YARG has already
 * read this scale, and a second vocabulary for the same number would be a
 * second thing to learn. The number is still what the rings draw. This is what
 * it is called.
 */
const INTENSITY_NAMES = [
  'Warm Up',
  'Apprentice',
  'Solid',
  'Moderate',
  'Challenging',
  'Nightmare',
  'Impossible',
] as const

/**
 * The tier two songs have to share to be the same intensity.
 *
 * Clamped, so a chart tiered 9 and a chart tiered 6 are both `Impossible` and
 * land in one run rather than three headers all reading the same word.
 */
/**
 * Every tier the scale names, which is exactly what the difficulty chips offer.
 *
 * Derived from the table rather than written out as `[0,1,2,3,4,5,6]`, so a
 * seventh name would grow the filter without anyone remembering to.
 */
export const INTENSITY_TIERS: readonly number[] = INTENSITY_NAMES.map((_, tier) => tier)

export function intensityTier(tier: number | null): number | null {
  if (tier === null || !Number.isFinite(tier)) return null

  return Math.min(Math.max(Math.trunc(tier), 0), INTENSITY_NAMES.length - 1)
}

export function intensityName(tier: number | null): string {
  const index = intensityTier(tier)
  // `Unrated` rather than YARG's `Unknown`: the CSV writes `-1` for a part that
  // isn't charted, and the loader has already turned that into null. What is
  // left is a band difficulty nobody assigned, which is a different fact.
  if (index === null) return 'Unrated'

  return INTENSITY_NAMES[index] ?? 'Unrated'
}

/**
 * YARG's own song-length buckets, at the boundaries it draws them.
 *
 * From `FiltersMenu.GetSongLengthLabel`: under three minutes, under five, under
 * seven, and everything above. The names are the game's
 * (`Menu.Filters.Length`); the parentheticals are set in this app's sentence
 * case rather than the Unity screen's title case, because they gloss the name
 * rather than being part of it.
 *
 * There is a second, finer table in that same file — six ranges from `00:00 -
 * 02:00` up — sitting behind a `UseLegacyLengthLabels` flag that is `true`.
 * Four buckets is what YARG actually ships, so four is what this follows.
 *
 * Each bucket says itself at three lengths, because three surfaces have three
 * different amounts of room. `label` is the whole thing, for a category header
 * and a filter token. `name` is the bare word, for a chip that shows the range
 * beside it in its own dimmer type. `short` is two or three characters, for the
 * jump rail, where a slot is 38px wide. See `indexing.ts`.
 */
export const LENGTH_BUCKETS = [
  { belowSeconds: 180, name: 'Short', label: 'Short (under 3 min)', short: '<3' },
  { belowSeconds: 300, name: 'Medium', label: 'Medium (3–5 min)', short: '3–5' },
  { belowSeconds: 420, name: 'Long', label: 'Long (5–7 min)', short: '5–7' },
  { belowSeconds: Infinity, name: 'Epic', label: 'Epic (over 7 min)', short: '7+' },
] as const

/** Which bucket a length falls in, or null when the CSV omitted it. */
export function lengthBucket(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null

  // The last bound is Infinity, so this always finds one.
  return LENGTH_BUCKETS.findIndex((bucket) => seconds < bucket.belowSeconds)
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

/**
 * The guest credit, which a library spells six ways and files in two fields.
 *
 * `Love the Way You Lie (feat. Rihanna)` by Eminem, `Empire State of Mind [ft.
 * Alicia Keys]`, `Numb/Encore` by `Jay-Z feat. Linkin Park` — the same fact
 * about the same kind of record, arriving parenthesised, bracketed, bare, in
 * the title, in the artist field, and once in a while in both at the same time.
 * Left alone it costs twice: the credit sets in the title's own 22px semibold
 * as though the guest were half the song's name, and the artist column files
 * Eminem's row under `Eminem feat. Rihanna`, which sorts beside `Eminem` rather
 * than in it and opens a second artist header for one song.
 *
 * So the credit is lifted out of whichever field carried it and said once, in
 * one form, in the one place it belongs — after the title, quieter than it.
 *
 * ## What counts as a marker
 *
 * `feat.` and `ft.` keep their full stops when they are unbracketed, and that
 * period is not pedantry — it is the whole of the defence. `Little Feat` is a
 * band, `No Mean Feat` is a title, and a rule that read a bare `feat` anywhere
 * would eat the front of both. Inside brackets the ambiguity is gone, because
 * nobody closes a song title with `(Feat of Strength)`, so the bracketed form
 * relaxes and catches the `(feat Jay-Z)` a charter typed in a hurry.
 *
 * **`with` is deliberately not a marker.** It is what Spotify prints for a
 * collaboration and it is also an English word: `(with Orchestra)`, `(with
 * lyrics)`, `Sing with the Choir`. Reading those as guest artists would corrupt
 * more titles than the rule repairs.
 *
 * **The one case this gets wrong is `ft.` meaning Fort.** `Meet Me in Ft.
 * Lauderdale` would parse as a song called `Meet Me in` featuring Lauderdale.
 * That is the price of reading the abbreviation unbracketed, and the rules
 * above were checked against a real 4,168-song library before it was paid:
 * 159 credits found, every one of them genuine, and no title mangled. A title
 * that *opens* with `Ft.` is safe either way, since a credit with nothing in
 * front of it is not a credit.
 */
const CREDIT_MARKER_BRACKETED = String.raw`(?:featuring|feat\.?|ft\.?)\s+|f\/\s*`
const CREDIT_MARKER_BARE = String.raw`(?:featuring|feat\.|ft\.)\s+|f\/\s*`

/**
 * A bracket group that opens with a marker, and everything up to its close.
 *
 * Global, so `Song (feat. X) (Live)` gives up the credit and keeps the mix
 * note — only groups that *start* with a marker are touched. The leading `\s*`
 * takes the space in front of the bracket with it.
 */
const BRACKETED_CREDIT = new RegExp(
  String.raw`\s*[([{]\s*(?:${CREDIT_MARKER_BRACKETED})([^)\]}]+?)\s*[)\]}]`,
  'giu',
)

/**
 * A marker standing in the open, and the names after it.
 *
 * `\b` is what keeps this off `Defeat.`, and the capture stops at the next
 * opening bracket so `A feat. B (Live)` hands `(Live)` back to the title rather
 * than crediting it to someone. The optional dash and comma are eaten with the
 * marker, so nothing is left dangling off the end of the name.
 */
const BARE_CREDIT = new RegExp(
  String.raw`[\s,]*(?:[-–—]\s*)?\b(?:${CREDIT_MARKER_BARE})([^([{]+)`,
  'iu',
)

/** A field with its guest credits taken out. */
interface FeatureSplit {
  /** What is left — the title, or the artist who is actually billed. */
  base: string
  /** One entry per credit found, exactly as authored. */
  credited: string[]
}

/**
 * Parsed once per distinct field value.
 *
 * `groupSongs` and `buildIndex` each ask for the filed form of every song in
 * the filtered set, and both run on every keystroke in the search box — so a
 * four-thousand-song library is parsed twice per character typed. Keyed by the
 * string rather than by the `Song`, because a song asks this twice about two
 * different fields, and because the two fields collide constantly across songs:
 * one library has one `Metallica`. Bounded by the library, which is fixed.
 */
const splitCache = new Map<string, FeatureSplit>()

function splitFeatured(value: string): FeatureSplit {
  const cached = splitCache.get(value)
  if (cached !== undefined) return cached

  const credited: string[] = []

  // Bracketed first. A bare marker's capture runs to the next bracket, so the
  // other order would leave `(feat. X)` sitting inside a bare credit's names.
  let base = value.replace(BRACKETED_CREDIT, (_group, names: string) => {
    credited.push(names)
    return ''
  })

  const bare = BARE_CREDIT.exec(base)
  if (bare !== null) {
    const head = base.slice(0, bare.index)
    const tail = base.slice(bare.index + bare[0].length)

    // A field that is *only* a credit has nobody to credit it to, so the marker
    // is left where it is. `Ft. Lauderdale` is a place, not a guest.
    if (head.trim() !== '') {
      credited.push(bare[1] ?? '')
      base = `${head} ${tail}`
    }
  }

  const collapsed = base.replace(/\s+/gu, ' ').trim()
  const split: FeatureSplit = {
    // Same rule as the line above, for the bracketed case it cannot reach: a
    // title of `(feat. Rihanna)` and nothing else keeps what it had.
    base: collapsed === '' ? value.trim() : collapsed,
    credited: collapsed === '' ? [] : credited.map((name) => name.trim()).filter(Boolean),
  }

  splitCache.set(value, split)
  return split
}

/**
 * Every credit the song carries, said once.
 *
 * A title and an artist field naming the same guest is the normal case rather
 * than the exception — `Love the Way You Lie (feat. Rihanna)` by `Eminem feat.
 * Rihanna` — so a credit that repeats one already kept is dropped, and where
 * one contains the other the fuller one wins. Compared through `foldForSearch`,
 * which is already the app's answer to "are these two the same name": it folds
 * case and diacritics, so `Beyoncé` and `Beyonce` are not credited twice.
 *
 * The names inside a credit are never split apart. `Earth, Wind & Fire` is one
 * guest and `Tyler, The Creator` is one guest, and no separator tells those
 * from a list of three. Whatever the charter wrote after the marker is what
 * prints after it.
 */
function formatCredits(credits: readonly string[]): string | null {
  const kept: string[] = []

  for (const credit of credits) {
    const folded = foldForSearch(credit)
    if (folded === '') continue

    const clash = kept.findIndex((existing) => {
      const other = foldForSearch(existing)
      return other.includes(folded) || folded.includes(other)
    })

    if (clash === -1) kept.push(credit)
    else if (credit.length > (kept[clash]?.length ?? 0)) kept[clash] = credit
  }

  return kept.length === 0 ? null : `(feat. ${kept.join(', ')})`
}

/** A bracketed note at the very end of a title, and nothing nested inside it. */
const TRAILING_NOTE = /\s*[([{]\s*([^()[\]{}]+?)\s*[)\]}]$/u

/**
 * The note that says *which recording*, rather than which song.
 *
 * `Tom Sawyer (Original Version)`, `Through the Fire and Flames (RB4 Version)`,
 * `Mama Tried (RB3 version)` — a real library has 53 of these, and they are the
 * same kind of aside as a guest credit: true, worth keeping, and not part of
 * the name anybody is scanning for. Set at full title weight, `(RB3 version)`
 * is 40% of the row's headline and says nothing about the song.
 *
 * Only the word `Version` closes this, and only at the end of the title. The
 * neighbouring parentheticals in the same library are exactly why: `(Live)`,
 * `(Co-op)` and `(Remix)` qualify a recording the same way, but so do
 * `(I Promise)`, `(Who Loves Me)` and `(Call Me by Your Name)`, which are
 * second halves of titles. Nothing in the string separates the two, so the rule
 * stops at the one word that is never a subtitle.
 */
const VERSION_NOTE = /\bversions?$/iu

function splitVersion(title: string): { stem: string; version: string | null } {
  const match = TRAILING_NOTE.exec(title)
  const note = match?.[1]

  if (match === null || note === undefined || !VERSION_NOTE.test(note)) {
    return { stem: title, version: null }
  }

  const stem = title.slice(0, match.index).trim()

  // Same rule the credits follow: a title that is *only* the note keeps it.
  // Re-bracketed with parentheses whatever it arrived in, so `[Vocal Version]`
  // and `(Vocal Version)` stop being two different-looking facts — but the
  // words inside are left exactly as authored. `RB3 version` is what the
  // charter wrote, and title-casing it would be inventing data.
  return stem === '' ? { stem: title, version: null } : { stem, version: `(${note})` }
}

/** A title, and the two kinds of aside that get attached to one. */
export interface TitleCredit {
  /** The song's own name, with the credit and any version note lifted out. */
  title: string
  /**
   * `(feat. Rihanna)` — formed, bracketed and always spelled `feat.`, whatever
   * the CSV said — or null when nobody guests. Bracketed here rather than by
   * whatever draws it, so a rendered row and a flat `aria-label` cannot end up
   * disagreeing about the form.
   */
  featuring: string | null
  /** `(Vocal Version)`, re-bracketed but otherwise as authored, or null. */
  version: string | null
}

/**
 * What to call the song, and what to say more quietly after it.
 *
 * Reads both fields for the credit, because it is in one of them and there is
 * no telling which. See `ArtistName`'s counterpart, `artistCredit`, which takes
 * the same guests back *out* of the artist field so the two never both say it.
 *
 * The credit comes before the version note in every caller, which is the order
 * a sleeve prints them in: `Long Time (feat. Guest) (Vocal Version)`.
 */
export function titleCredit(song: { name: string; artist: string }): TitleCredit {
  const fromTitle = splitFeatured(song.name)
  const fromArtist = splitFeatured(song.artist)
  const { stem, version } = splitVersion(fromTitle.base)

  return {
    title: stem,
    featuring: formatCredits([...fromTitle.credited, ...fromArtist.credited]),
    version,
  }
}

/** The title and everything after it, as one string, for `aria-label`s and other flat text. */
export function formatTitleCredit(song: { name: string; artist: string }): string {
  const { title, featuring, version } = titleCredit(song)
  return [title, featuring, version].filter((part) => part !== null).join(' ')
}

/** An artist, and whether this chart is actually them playing. */
export interface ArtistCredit {
  /** The performer as the UI says it, cover-house and guest credits removed. */
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
  const billed = stripped === '' ? raw : stripped

  /*
   * The guests leave with the title.
   *
   * `Eminem feat. Rihanna` is Eminem's row and belongs in Eminem's run: sorted
   * under E among his other songs, filed under the one `Eminem` header rather
   * than opening a second one for a single track, and reachable from the E on
   * the jump rail. None of that happened while the credit was part of the name,
   * and every one of those three surfaces asks this function for it.
   */
  const name = splitFeatured(billed).base

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
