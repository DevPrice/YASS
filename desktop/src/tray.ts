/**
 * The notification-area icon and its menu.
 *
 * Left-click toggles the popover; right-click opens the menu. On Windows those
 * are wired as separate events rather than through `setContextMenu`, which
 * would put the menu on both buttons and leave the popover unreachable. Linux
 * tray implementations ignore click events entirely and need the context menu
 * set, so that platform gets the other treatment.
 *
 * The menu's *contents* live in `trayMenu.ts`, which has no Electron runtime
 * import and is therefore testable. This file is the part that genuinely needs
 * a running Electron process.
 */

import { Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { trayMenuTemplate, type TrayActions } from './trayMenu.js'

export type { DataFolder, TrayActions } from './trayMenu.js'

/**
 * What Windows draws in the notification area is the same `.ico` the executable
 * wears, which carries a 16px entry for it to pick out at this size. Everywhere
 * else it is the PNG: `nativeImage` on Linux does not decode ICO, and an
 * unreadable icon there is an invisible tray entry rather than an error.
 *
 * One path for both layouts: `__dirname` is `dist/` in a dev run and
 * `app.asar/dist/` in a packaged one, and Electron reads an asar path through
 * `nativeImage` as happily as a real one.
 */
function iconPath(): string {
  const name = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const path = resolve(__dirname, '../build', name)
  return existsSync(path) ? path : ''
}

/** The size Linux panels expect; the source is a 256px mark. */
const LINUX_TRAY_SIZE = 24

export function createTray(actions: TrayActions): Tray {
  const path = iconPath()
  // An empty image still produces a working, if invisible, tray entry — better
  // than throwing on a build where the icon hasn't been generated yet.
  let image = path ? nativeImage.createFromPath(path) : nativeImage.createEmpty()

  /*
   * Windows picks the size it wants out of the ICO. Linux is handed exactly the
   * pixels given, and a 256px mark in a 24px panel is either an enormous icon
   * or a clipped one depending on which tray implementation is listening — so
   * it is scaled here rather than left to the panel's discretion.
   */
  if (process.platform === 'linux' && !image.isEmpty()) {
    image = image.resize({ width: LINUX_TRAY_SIZE, height: LINUX_TRAY_SIZE, quality: 'best' })
  }

  const tray = new Tray(image)
  tray.setToolTip('YASS')

  const menu = Menu.buildFromTemplate(trayMenuTemplate(actions))

  if (process.platform === 'linux') {
    tray.setContextMenu(menu)
  } else {
    tray.on('click', () => actions.toggle())
    tray.on('right-click', () => tray.popUpContextMenu(menu))
  }

  return tray
}
