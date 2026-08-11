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
 * The same `.ico` the executable wears, which carries a 16px entry for Windows
 * to pick out of it at this size. One path for both layouts: `__dirname` is
 * `dist/` in a dev run and `app.asar/dist/` in a packaged one, and Electron
 * reads an asar path through `nativeImage` as happily as a real one.
 */
function iconPath(): string {
  const path = resolve(__dirname, '../build/icon.ico')
  return existsSync(path) ? path : ''
}

export function createTray(actions: TrayActions): Tray {
  const path = iconPath()
  // An empty image still produces a working, if invisible, tray entry — better
  // than throwing on a build where the icon hasn't been generated yet.
  const image = path ? nativeImage.createFromPath(path) : nativeImage.createEmpty()

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
