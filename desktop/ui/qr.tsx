/**
 * The address, as something a phone can eat.
 *
 * The whole job of this window is moving a URL from a screen into a phone that
 * is across a room, and until now that was done by reading `192.168.1.24:4321`
 * out loud over music while six people typed it wrong. A camera does it in one
 * go.
 *
 * Encoded here rather than fetched from a service, because this app is
 * expected to work with the internet off — that is the same reason the fonts
 * are self-hosted and the CSP forbids `connect-src` entirely.
 */

import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/**
 * Dark modules on light, and not the other way round.
 *
 * An inverted code is legible to some scanners and invisible to others, and
 * this one gets exactly one attempt in a dim room with a stranger's phone. So
 * it is a white tile on a dark window, which also reads as an object meant to
 * be pointed at.
 */
export function QrCode({ value, size = 104 }: { value: string; size?: number }) {
  const { path, span } = useMemo(() => {
    // Type 0 asks for the smallest version the data fits in; 'L' correction is
    // ample for a 30-character URL read from arm's length.
    const code = qrcode(0, 'L')
    code.addData(value)
    code.make()

    const count = code.getModuleCount()
    // Four modules is what the spec asks for; the tile's own padding supplies
    // the rest of it visually.
    const quiet = 2
    const parts: string[] = []

    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (code.isDark(row, col)) parts.push(`M${col + quiet} ${row + quiet}h1v1h-1z`)
      }
    }

    return { path: parts.join(''), span: count + quiet * 2 }
  }, [value])

  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      role="img"
      aria-label={`QR code for ${value}`}
      className="shrink-0 rounded-[5px]"
      style={{ background: 'var(--yarg-white)' }}
      // Whole pixels per module; the browser's smoothing turns a QR into mush.
      shapeRendering="crispEdges"
    >
      <path d={path} fill="var(--yarg-night)" />
    </svg>
  )
}
