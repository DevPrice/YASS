/**
 * Procedural album covers for the demo.
 *
 * The real app derives art from the chart files next to each song — a `.sng`'s
 * embedded image, a CON's DXT texture — and none of that exists on a static
 * host. The alternative was shipping no art at all, which would have shown the
 * typographic plate for all 1,650 rows: a real state (it is what a machine with
 * no ffmpeg sees) but the wrong one to demo, because the list, the banner and
 * the detail plate are all designed around a picture being there.
 *
 * So every demo song gets one, generated from its hash: an SVG data URI, drawn
 * from the same palette as the rest of the app, deliberately abstract. Nothing
 * here imitates a real cover, and no real artwork is shipped.
 *
 * **Data URIs rather than blobs or an object URL**, because these are consumed
 * as `<img src>` *and* as a CSS `background-image` in the now-playing banner,
 * and a data URI is the one form both take without a fetch. They also cost no
 * network at all, which is what keeps a 1,650-row demo scrolling on a phone.
 */

/** Deep bases, from the dark ramp in `design/tokens/colors.css`. */
const BASES = [
  ['#0C0F1E', '#04060F'],
  ['#151A30', '#070A18'],
  ['#01040A', '#0A1220'],
  ['#12102A', '#05040E'],
  ['#04121C', '#010609'],
  ['#1E253E', '#080B18'],
] as const

/** Accents, from the brand palette. One per cover, so each reads as one idea. */
const ACCENTS = [
  '#45D8FE', // vivid sky blue
  '#F32B37', // imperial red
  '#FCD548', // mustard
  '#2BE18D', // emerald
  '#9746F5', // veronica
  '#FF8413', // UT orange
  '#0066FF', // brandeis blue
] as const

/** Covers are generated once per hash and reused — scrolling revisits rows. */
const cache = new Map<string, string>()

/**
 * A small deterministic stream of numbers from the song's hash.
 *
 * The hash is 40 hex characters, which is 20 bytes of perfectly good entropy
 * that is already stable per song. Walking it beats seeding a PRNG: two songs
 * with different hashes get different covers, and the same song gets the same
 * cover in every browser, forever.
 */
function digits(hash: string): (index: number) => number {
  return (index: number) => Number.parseInt(hash.slice(index * 2, index * 2 + 2) || '7f', 16) || 0
}

/**
 * One cover, as an SVG data URI.
 *
 * Seven motifs, chosen by hash. Each is one accent on one gradient — the covers
 * have to sit behind white text under the banner's scrim and beside each other
 * in a 256px list column, and anything busier turns the list into static.
 */
export function mockArtUrl(hash: string | null): string {
  const key = hash ?? 'NONE'
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const at = digits(key)
  const [top, bottom] = BASES[at(0) % BASES.length] ?? BASES[0]
  const accent = ACCENTS[at(1) % ACCENTS.length] ?? ACCENTS[0]
  const motif = at(2) % 7
  const angle = at(3) % 90
  const svg = compose(motif, accent, top, bottom, angle, at)

  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`
  cache.set(key, url)
  return url
}

function compose(
  motif: number,
  accent: string,
  top: string,
  bottom: string,
  angle: number,
  at: (index: number) => number,
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`,
    `<defs>`,
    `<linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">`,
    `<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>`,
    `</linearGradient>`,
    // A soft off-centre glow in the accent, which is what stops the flat fills
    // below from reading as a placeholder rather than a cover.
    `<radialGradient id="glow" cx="${25 + (at(4) % 50)}%" cy="${20 + (at(5) % 50)}%" r="70%">`,
    `<stop offset="0" stop-color="${accent}" stop-opacity="0.62"/>`,
    `<stop offset="0.55" stop-color="${accent}" stop-opacity="0.18"/>`,
    `<stop offset="1" stop-color="${accent}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `</defs>`,
    `<rect width="512" height="512" fill="url(#g)"/>`,
    // The accent, flooded across the ground before the motif goes on.
    //
    // Without this the covers were dark tiles with a faint mark on them: true to
    // the palette and useless at 40px, which is the size 1,650 of them are seen
    // at. A cover is the brightest thing in a song row, and it has to be able to
    // carry that on a list where every other surface is within 1.15:1 of black.
    `<rect width="512" height="512" fill="${accent}" fill-opacity="0.10"/>`,
    `<rect width="512" height="512" fill="url(#glow)"/>`,
    // Every third cover draws its motif in white rather than the accent, which
    // is the cheapest source of real variety here: two covers on neighbouring
    // rows can share a hue and still not look like the same picture.
    `<g transform="rotate(${angle} 256 256)">${shapes(motif, at(8) % 3 === 0 ? '#FFFFFF' : accent, at)}</g>`,
    // A hairline inside the edge: the covers sit on surfaces within 1.15:1 of
    // their own darkest corner, the same reason the song rows are ruled.
    `<rect x="0.5" y="0.5" width="511" height="511" fill="none" stroke="#FFFFFF" stroke-opacity="0.06"/>`,
    `</svg>`,
  ].join('')
}

function shapes(motif: number, accent: string, at: (index: number) => number): string {
  const parts: string[] = []

  switch (motif) {
    // Concentric rings.
    case 0: {
      const rings = 4 + (at(6) % 4)
      for (let index = 0; index < rings; index += 1) {
        const radius = 60 + index * (30 + (at(7) % 20))
        parts.push(
          `<circle cx="256" cy="256" r="${radius}" fill="none" stroke="${accent}" stroke-opacity="${(0.85 - index * 0.09).toFixed(2)}" stroke-width="${2 + (index % 3) * 3}"/>`,
        )
      }
      break
    }

    // Diagonal bars of varying weight.
    case 1: {
      const bars = 5 + (at(6) % 5)
      for (let index = 0; index < bars; index += 1) {
        const x = -80 + index * (640 / bars)
        const width = 6 + ((at(7 + index) % 5) * 9)
        parts.push(
          `<rect x="${x.toFixed(1)}" y="-120" width="${width}" height="760" fill="${accent}" fill-opacity="${(0.26 + (index % 4) * 0.16).toFixed(2)}"/>`,
        )
      }
      break
    }

    // A stack of triangles, one of them solid.
    case 2: {
      const count = 3 + (at(6) % 3)
      for (let index = 0; index < count; index += 1) {
        const size = 90 + index * 62
        parts.push(
          `<polygon points="256,${256 - size} ${256 + size},${256 + size * 0.7} ${256 - size},${256 + size * 0.7}" fill="none" stroke="${accent}" stroke-opacity="${(0.8 - index * 0.12).toFixed(2)}" stroke-width="3"/>`,
        )
      }
      parts.push(
        `<polygon points="256,140 372,330 140,330" fill="${accent}" fill-opacity="0.42"/>`,
      )
      break
    }

    // A dot grid that fades across the plate.
    case 3: {
      const step = 44 + (at(6) % 3) * 12
      for (let y = step / 2; y < 512; y += step) {
        for (let x = step / 2; x < 512; x += step) {
          const radius = 2 + ((x + y) / 512) * (at(7) % 5)
          parts.push(
            `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${radius.toFixed(1)}" fill="${accent}" fill-opacity="${(0.22 + (x / 512) * 0.62).toFixed(2)}"/>`,
          )
        }
      }
      break
    }

    // A spectrum, which is the most on-the-nose thing a music app can draw.
    case 4: {
      const bars = 14 + (at(6) % 8)
      const width = 512 / bars
      for (let index = 0; index < bars; index += 1) {
        const height = 40 + (at(7 + (index % 12)) % 320)
        parts.push(
          `<rect x="${(index * width + width * 0.2).toFixed(1)}" y="${(512 - height).toFixed(1)}" width="${(width * 0.6).toFixed(1)}" height="${height}" fill="${accent}" fill-opacity="${(0.34 + (index % 5) * 0.13).toFixed(2)}"/>`,
        )
      }
      break
    }

    // Sweeping arcs, like the stage lighting the banner washes with.
    case 5: {
      const arcs = 3 + (at(6) % 3)
      for (let index = 0; index < arcs; index += 1) {
        const radius = 120 + index * 70
        parts.push(
          `<path d="M ${256 - radius} 300 A ${radius} ${radius} 0 0 1 ${256 + radius} 300" fill="none" stroke="${accent}" stroke-opacity="${(0.85 - index * 0.15).toFixed(2)}" stroke-width="${4 + index * 2}" stroke-linecap="round"/>`,
        )
      }
      break
    }

    // Nested squares, rotated against each other.
    default: {
      const squares = 3 + (at(6) % 3)
      for (let index = 0; index < squares; index += 1) {
        const size = 100 + index * 78
        parts.push(
          `<rect x="${256 - size / 2}" y="${256 - size / 2}" width="${size}" height="${size}" fill="none" stroke="${accent}" stroke-opacity="${(0.8 - index * 0.14).toFixed(2)}" stroke-width="3" transform="rotate(${index * (12 + (at(7) % 12))} 256 256)"/>`,
        )
      }
      break
    }
  }

  return parts.join('')
}
