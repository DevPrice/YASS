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
 * Not keyed by `InstrumentKey`: the design system draws 11 glyphs and YASS
 * models 20 instruments, so a mapping has to decide what a 6-fret guitar, a
 * rhythm part, or elite drums looks like when no glyph exists for it.
 */
export const INSTRUMENT_ART = load(
  import.meta.glob('./instruments/*.png', { eager: true, query: '?url', import: 'default' }),
)

/**
 * Difficulty rings, keyed `unknown`, `no-part`, `0`…`20`, `21-plus`.
 *
 * The scale is unresolved. The CSV export gives per-instrument difficulties in
 * 0–6, and these rings run to 21+, so the two are not the same axis and must
 * not be indexed against each other until we know what the rings measure.
 */
export const DIFFICULTY_ART = load(
  import.meta.glob('./difficulty/*.png', { eager: true, query: '?url', import: 'default' }),
)

/**
 * Source badges, keyed by a slug of the design system's display name
 * (`rock-band-3`, `guitar-hero-ii`, `yarg`).
 *
 * The CSV `source` column holds YARG's raw ids (`rb3dlc`, `$DEFAULT$`), which
 * these slugs do not match. That translation table is a separate piece of work
 * and needs YARG's source list to do properly.
 */
export const SOURCE_ART = load(
  import.meta.glob('./sources/*.png', { eager: true, query: '?url', import: 'default' }),
)
