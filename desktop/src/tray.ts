/**
 * The notification-area icon and its menu.
 *
 * Left-click toggles the popover; right-click opens the menu. On Windows those
 * are wired as separate events rather than through `setContextMenu`, which
 * would put the menu on both buttons and leave the popover unreachable. Linux
 * tray implementations ignore click events entirely and need the context menu
 * set, so that platform gets the other treatment.
 */

import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface TrayActions {
  toggle(): void
  openSettings(): void
  restartServer(): void
  reloadClients(): void
  openInBrowser(): void
  copyLanAddress(): void
  quit(): void
}

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

  const template: MenuItemConstructorOptions[] = [
    { label: 'Settings…', click: () => actions.openSettings() },
    { type: 'separator' },
    { label: 'Restart server', click: () => actions.restartServer() },
    { label: 'Reload connected browsers', click: () => actions.reloadClients() },
    { type: 'separator' },
    { label: 'Open in browser', click: () => actions.openInBrowser() },
    { label: 'Copy LAN address', click: () => actions.copyLanAddress() },
    { type: 'separator' },
    // Named for what it does to the room, not for what it does to this window.
    { label: 'Quit YASS (stops the server)', click: () => actions.quit() },
  ]

  const menu = Menu.buildFromTemplate(template)

  if (process.platform === 'linux') {
    tray.setContextMenu(menu)
  } else {
    tray.on('click', () => actions.toggle())
    tray.on('right-click', () => tray.popUpContextMenu(menu))
  }

  return tray
}
