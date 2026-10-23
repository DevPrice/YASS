/**
 * YARG's own setlist icon, inlined for the same reason `RandomIcon` is: the
 * vendored file is normalized to `currentColor`, and only an icon in the
 * document can take the colour of the chip or button it sits in.
 */

import setlistSvg from '../../design/assets/icons/setlist.svg?raw'

import { cx } from '../../ui'

export function SetlistIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 [&>svg]:size-full', className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: setlistSvg }}
    />
  )
}
