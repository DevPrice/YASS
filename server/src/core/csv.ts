/**
 * RFC 4180 CSV parsing.
 *
 * Song titles routinely contain commas, quotes, and newlines, so this handles
 * quoted fields with doubled escapes rather than splitting on commas.
 */

/** Strip a UTF-8 BOM if present — .NET's default `StreamWriter` may emit one. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Parse CSV text into rows of raw string cells.
 *
 * Handles quoted fields, doubled quotes (`""` → `"`), and CR/CRLF/LF line
 * endings. A trailing newline does not produce a final empty row.
 */
export function parseCsv(text: string): string[][] {
  const input = stripBom(text)
  const rows: string[][] = []

  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldWasQuoted = false

  const endField = () => {
    row.push(field)
    field = ''
    fieldWasQuoted = false
  }

  const endRow = () => {
    endField()
    // Skip rows that are entirely empty (e.g. a stray blank line).
    if (row.length > 1 || row[0] !== '') {
      rows.push(row)
    }
    row = []
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    switch (char) {
      case '"':
        // A quote only opens a quoted field at the field's start; elsewhere
        // it's literal (malformed input, but don't lose data over it).
        if (field === '' && !fieldWasQuoted) {
          inQuotes = true
          fieldWasQuoted = true
        } else {
          field += char
        }
        break

      case ',':
        endField()
        break

      case '\r':
        // Swallow CR; the following LF (or its absence) ends the row.
        if (input[i + 1] === '\n') i++
        endRow()
        break

      case '\n':
        endRow()
        break

      default:
        field += char
    }
  }

  // Flush a final row that wasn't newline-terminated.
  if (field !== '' || row.length > 0) {
    endRow()
  }

  return rows
}

/**
 * Index a header row by column name.
 *
 * Matching is by name, not position, so YARG adding or reordering export
 * columns doesn't silently shift every field by one.
 */
export function indexHeaders(header: readonly string[]): Map<string, number> {
  const map = new Map<string, number>()
  header.forEach((name, index) => {
    const key = name.trim().toLowerCase()
    if (key && !map.has(key)) map.set(key, index)
  })
  return map
}
