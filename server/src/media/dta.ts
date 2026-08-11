/**
 * A minimal s-expression reader for `songs.dta`.
 *
 * Every CON package carries one, describing each song it holds: where the audio
 * is, how its channels map to instruments, and — the reason this file exists —
 * where the preview window starts and ends.
 *
 * **This is deliberately not a DTA parser.** It is a tokenizer that produces
 * nested arrays of strings, plus three accessors. The real format has typed
 * atoms, macros, `#ifdef` directives and `{...}` lambda forms; YARG implements
 * all of it because YARG has to *play* these songs. We need four keys —
 * `preview`, `pans`, `vols`, `tracks` — and the cost of a full implementation is
 * a large surface for a small return.
 *
 * What that buys: anything unrecognised becomes an opaque token or a nested
 * list and is skipped harmlessly. A file we cannot make sense of yields no
 * preview window, and `preview.ts` falls back to the same defaults it uses for
 * a chart that never specified one.
 *
 * Real files are comment-heavy, inconsistently indented, and mix tabs with
 * spaces — the sample this was written against has `;@@@@ ADD @@@@` markers
 * left in by the charting tool. Comments run from `;` to end of line.
 */

/** A token, or a nested list. Strings keep their text; lists nest. */
export type DtaNode = string | DtaNode[]

const OPENERS = new Set(['(', '{', '['])
const CLOSERS = new Set([')', '}', ']'])

/**
 * Parse a DTA document into a list of top-level nodes.
 *
 * Never throws: an unterminated list closes at end of input, and a stray
 * closer is ignored. Both are things real files do, and neither is worth
 * failing a song's preview over.
 */
export function parseDta(text: string): DtaNode[] {
  const root: DtaNode[] = []
  const stack: DtaNode[][] = [root]

  // A BOM would otherwise tokenize as a bare atom sitting in front of the first
  // song, which is harmless here but confusing in every dump of the result.
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0
  while (at < text.length) {
    const char = text[at]!

    if (char === ';') {
      while (at < text.length && text[at] !== '\n') at++
      continue
    }

    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      at++
      continue
    }

    if (OPENERS.has(char)) {
      const list: DtaNode[] = []
      stack[stack.length - 1]!.push(list)
      stack.push(list)
      at++
      continue
    }

    if (CLOSERS.has(char)) {
      // Never pop the root: a file with more closers than openers should end
      // with whatever it managed to say, not with an empty document.
      if (stack.length > 1) stack.pop()
      at++
      continue
    }

    /*
     * Both quote characters, and the delimiter is dropped either way.
     *
     * `"` wraps a string; `'` wraps a *symbol*, which is how DTA writes a name
     * that would otherwise be ambiguous — and how a good number of packages
     * write their shortname, as `'miku'`. Keeping the quotes as part of the
     * token made those songs fail to match their own `subName`.
     */
    if (char === '"' || char === "'") {
      const quote = char
      let value = ''
      at++
      while (at < text.length && text[at] !== quote) {
        if (text[at] === '\\' && at + 1 < text.length) {
          at++
          value += text[at]
        } else {
          value += text[at]
        }
        at++
      }
      at++
      stack[stack.length - 1]!.push(value)
      continue
    }

    // A bare atom: a symbol, a number, or a keyword.
    let end = at
    while (
      end < text.length &&
      !OPENERS.has(text[end]!) &&
      !CLOSERS.has(text[end]!) &&
      !` \t\r\n;"'`.includes(text[end]!)
    ) {
      end++
    }

    // `end === at` would mean no progress and an infinite loop; the character
    // classes above make that impossible, but a stuck parser on a 4,000-song
    // scan is not a thing to leave to reasoning.
    if (end === at) end = at + 1

    stack[stack.length - 1]!.push(text.slice(at, end))
    at = end
  }

  return root
}

/** True when `node` is a list whose first element is the symbol `key`. */
function isKeyed(node: DtaNode, key: string): boolean {
  return Array.isArray(node) && node[0] === key
}

/**
 * The first child list of `node` headed by `key`, or null.
 *
 * Returns the whole list including the key, so callers index from 1 — which
 * keeps `(preview 89352 119352)` readable as what it is.
 */
export function getKeyed(node: DtaNode[], key: string): DtaNode[] | null {
  for (const child of node) {
    if (isKeyed(child, key)) return child as DtaNode[]
  }

  return null
}

/**
 * Every number directly under `key`, flattened one level.
 *
 * `pans` and `vols` wrap their values in a further list —
 * `(pans (-1.0 1.0 …))` — while `preview` does not. Flattening one level
 * accepts both without the caller having to know which it is looking at.
 */
export function getNumbers(node: DtaNode[], key: string): number[] | null {
  const list = getKeyed(node, key)
  if (list === null) return null

  const numbers: number[] = []
  for (const item of list.slice(1)) {
    const values = Array.isArray(item) ? item : [item]
    for (const value of values) {
      if (typeof value !== 'string') continue
      const parsed = Number(value)
      if (Number.isFinite(parsed)) numbers.push(parsed)
    }
  }

  return numbers
}

/**
 * Find the node for one song within a `songs.dta`.
 *
 * A package can hold several songs, each a top-level list headed by its
 * shortname — the same `subName` the chart index carries.
 */
export function findSongNode(document: DtaNode[], shortName: string): DtaNode[] | null {
  const wanted = shortName.toLowerCase()

  for (const node of document) {
    if (Array.isArray(node) && typeof node[0] === 'string' && node[0].toLowerCase() === wanted) {
      return node
    }
  }

  return null
}

/** What `preview.ts` needs out of a song's DTA node. */
export interface DtaSongAudio {
  /** `(preview start end)`, in milliseconds. Null when absent. */
  preview: { start: number; end: number } | null
  /** Per-channel stereo position, -1 hard left to 1 hard right. */
  pans: number[]
  /** Per-channel gain in dB. */
  vols: number[]
  /**
   * Channel indices belonging to the crowd, which a preview must leave out —
   * the same rule the loose-stem path applies by skipping `crowd.ogg`.
   */
  crowdChannels: number[]
}

/**
 * Pull the audio description out of a song node.
 *
 * `pans` and `vols` live inside the nested `(song …)` list; `preview` sits at
 * the top level of the song. Real files put them in both places often enough
 * that both are checked.
 */
export function readSongAudio(song: DtaNode[]): DtaSongAudio {
  const inner = getKeyed(song, 'song') ?? song

  const previewValues = getNumbers(song, 'preview') ?? getNumbers(inner, 'preview')
  const preview =
    previewValues !== null && previewValues.length >= 2
      ? { start: previewValues[0]!, end: previewValues[1]! }
      : null

  return {
    preview,
    pans: getNumbers(inner, 'pans') ?? getNumbers(song, 'pans') ?? [],
    vols: getNumbers(inner, 'vols') ?? getNumbers(song, 'vols') ?? [],
    crowdChannels: getNumbers(inner, 'crowd_channels') ?? getNumbers(song, 'crowd_channels') ?? [],
  }
}
