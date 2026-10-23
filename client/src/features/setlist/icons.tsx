/**
 * YARG's own setlist and show icons, inlined for the same reason `RandomIcon`
 * is: the vendored files are normalized to `currentColor`, and only an icon in
 * the document can take the colour of the chip or button it sits in.
 */

import setlistSvg from '../../design/assets/icons/setlist.svg?raw'
import showSvg from '../../design/assets/icons/show.svg?raw'

import { cx } from '../../ui'

function Icon({ svg, size, className }: { svg: string; size: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 [&>svg]:size-full', className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export function SetlistIcon({ size = 18, className }: { size?: number; className?: string }) {
  return <Icon svg={setlistSvg} size={size} className={className} />
}

export function ShowIcon({ size = 18, className }: { size?: number; className?: string }) {
  return <Icon svg={showSvg} size={size} className={className} />
}
