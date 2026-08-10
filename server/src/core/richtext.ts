/**
 * Unity/TextMeshPro rich-text stripping.
 *
 * `currentSong.json` does NOT strip rich text (unlike `currentSong.txt`), and
 * song metadata is user-authored, so `Name`/`Artist`/`Album`/`Charter` routinely
 * carry markup like `<color=#FF0000>Song</color> <i>Title</i>`.
 *
 * The tag list mirrors `RICH_TEXT_TAGS` in YARG.Core's `RichTextUtils.cs` so we
 * strip exactly what YARG considers a tag — no more. That distinction matters:
 * a blanket `<[^>]*>` would eat `<3` out of a song title, and titles like
 * "I <3 You" are real.
 */

const RICH_TEXT_TAGS = [
  'align',
  'allcaps',
  'alpha',
  'b',
  'br',
  'color',
  'cspace',
  'font-weight', // must precede `font` so the longer name wins the alternation
  'font',
  'gradient',
  'i',
  'indent',
  'line-height',
  'line-indent',
  'link',
  'lowercase',
  'margin',
  'mark',
  'mspace',
  'noparse',
  'nobr',
  'page',
  'pos',
  'rotate',
  'size',
  'smallcaps',
  'space',
  'sprite',
  's',
  'style',
  'sub',
  'sup',
  'u',
  'uppercase',
  'voffset',
  'width',
] as const

/**
 * Matches an opening, closing, or self-closing tag whose name is one of the
 * known rich-text tags, with an optional `=value` payload.
 *
 * The `(?=[=\s/>])` lookahead prevents `<s>` from matching the start of
 * `<something>`, which would otherwise strip an unknown tag as if it were
 * strikethrough.
 */
const TAG_PATTERN = new RegExp(
  String.raw`</?(?:${RICH_TEXT_TAGS.join('|')})(?=[=\s/>])(?:=(?:"[^"]*"|'[^']*'|[^>]*))?\s*/?>`,
  'gi',
)

/** Bare closing/opening tags with no payload, e.g. `<b>`, `</i>`. */
const BARE_TAG_PATTERN = new RegExp(String.raw`</?(?:${RICH_TEXT_TAGS.join('|')})>`, 'gi')

/**
 * Remove rich-text markup and normalize whitespace.
 *
 * Returns a plain string safe to hand to the client. The client still renders it
 * as text (never as HTML), so this is defense in depth rather than the only
 * guard against injection.
 */
export function stripRichText(input: string | null | undefined): string {
  if (!input) return ''

  const stripped = input.replace(TAG_PATTERN, '').replace(BARE_TAG_PATTERN, '')

  // Collapse the runs of whitespace that removing inline tags tends to leave.
  return stripped.replace(/\s+/g, ' ').trim()
}
