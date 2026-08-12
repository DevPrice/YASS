/**
 * URL lookups for the vendored bitmap art.
 *
 * These go through `import.meta.glob` rather than living in `public/` so Vite
 * fingerprints them. That matters: `server/src/static.ts` serves everything
 * under `/assets/` with a one-year `immutable` cache, which is only safe
 * because the filenames carry a content hash. A verbatim `public/` copy would
 * be cached for a year under a stable name, and re-exporting an icon would
 * never reach a browser that had already seen it.
 *
 * Nothing here maps a YASS value onto a slug — see the notes below. The
 * mappings involve real judgement calls and belong with the component that
 * renders them, not buried in an asset index.
 */

import type { InstrumentGroup } from '@shared/types'

const load = (glob: Record<string, unknown>): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {}

  for (const [path, url] of Object.entries(glob)) {
    const slug = path.slice(path.lastIndexOf('/') + 1).replace(/\.png$/, '')
    out[slug] = url as string
  }

  return Object.freeze(out)
}

/**
 * Instrument glyphs, keyed by the design system's own name.
 *
 * Not keyed by `InstrumentKey`: there are 14 glyphs here and YASS models 20
 * instruments, so a per-key mapping has to decide what a 6-fret guitar, a
 * rhythm part, or elite drums looks like when no glyph exists. `GROUP_ART`
 * below sidesteps that question rather than answering it.
 *
 * Two of these are not instruments at all and are reached by name rather than
 * through `GROUP_ART`: `vocals-2harmony` and `vocals-3harmony` stand in for
 * `vocals` on the vocal count (see `vocalsArt` in `ui/library`), and `band` is
 * the mark inside the band-difficulty ring. `band` is also the only file in
 * this directory that did not come from Figma — see `design/README.md`.
 */
export const INSTRUMENT_ART = load(
  import.meta.glob('./instruments/*.png', { eager: true, query: '?url', import: 'default' }),
)

/**
 * Glyph per instrument *group* — the five families the filters already speak in.
 *
 * This mapping is exact, which is the whole reason to work at group level: each
 * of the five has a glyph drawn for it under its own name, so nothing has to be
 * approximated. The unresolved 20-key problem only exists if you insist on a
 * glyph per `InstrumentKey`, and nothing in the UI asks for one — the question
 * a room actually has is "can we play this", not "which of the four drum
 * encodings is this chart".
 */
export const GROUP_ART: Readonly<Record<InstrumentGroup, string>> = Object.freeze({
  guitar: INSTRUMENT_ART['guitar'] ?? '',
  bass: INSTRUMENT_ART['bass'] ?? '',
  drums: INSTRUMENT_ART['drums'] ?? '',
  keys: INSTRUMENT_ART['keys'] ?? '',
  vocals: INSTRUMENT_ART['vocals'] ?? '',
})

/*
 * `difficulty/` is on disk but deliberately not globbed here.
 *
 * A glob emits every file it matches as soon as this module is imported, and
 * this module is now imported — so exporting the rings would ship 24 PNGs
 * (~520 KB) that nothing can render.
 *
 * **Source art is the submodule's job**, not this directory's. `lib/sources.ts`
 * resolves it through `vendor/opensource`: 212 icons keyed by the same ids a
 * song actually carries, rather than by slugs of display names. The 46 Figma
 * badges that used to sit beside these rings were superseded by that and are
 * gone from the repository — see `design/README.md`.
 *
 * **`difficulty/` is drawn instead.** The rings run `0`…`20`, `21-plus`,
 * `no-part`, `unknown`; the CSV's per-instrument difficulties are `0`–`6`. Those
 * are still not the same axis and are still not indexed against each other —
 * but the shape is portable even where the scale isn't, so `DifficultyRing` in
 * `ui/library.tsx` draws the same six-notch ring in SVG against the tier we
 * have. These 24 are the reference its proportions were measured from.
 */
