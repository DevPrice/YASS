/**
 * What the tray's context menu contains, as data.
 *
 * Separate from `tray.ts` so it can be tested without Electron. `tray.ts`
 * imports `Menu`, `Tray` and `nativeImage` at module scope, which makes it
 * unloadable outside an Electron process — and the thing most worth checking
 * here is not that a `Tray` can be constructed but that every entry is wired to
 * the verb it names. That is a property of a plain array.
 *
 * The only Electron reference left is a type, which `verbatimModuleSyntax`
 * erases at build time.
 */

import type { MenuItemConstructorOptions } from 'electron'

/**
 * The directories YASS writes to, as the menu names them.
 *
 * A key rather than a path, so the menu says what it wants and `main.ts` owns
 * where that actually is — the tray has no business holding filesystem paths.
 */
export type DataFolder = 'config' | 'logs' | 'media' | 'bin'

/**
 * Every folder the app stores something in, in the order a person needs them.
 *
 * `config` is the root and physically contains the other three, which is the
 * argument for listing it first and for listing the others at all: knowing a
 * folder exists is not the same as finding it inside a folder that also holds
 * Chromium's profile.
 *
 * Deliberately not here: `electron/`, the popover's Chromium profile — cookies,
 * GPU caches, a `Local Storage` tree. It is data the app stores and it is data
 * nobody has ever wanted to open. It sits inside `config` for anyone who does.
 */
export const DATA_FOLDERS: ReadonlyArray<{ folder: DataFolder; label: string }> = [
  { label: 'Settings and data', folder: 'config' },
  { label: 'Logs', folder: 'logs' },
  { label: 'Album art and previews', folder: 'media' },
  { label: 'Downloaded ffmpeg', folder: 'bin' },
]

export interface TrayActions {
  toggle(): void
  openSettings(): void
  restartServer(): void
  reloadClients(): void
  rebuildMediaIndex(): void
  openInBrowser(): void
  copyLanAddress(): void
  openDataFolder(folder: DataFolder): void
  quit(): void
}

/**
 * The menu template.
 *
 * Grouped by what a click costs: settings on its own, then the three verbs that
 * act on the running system, then the two that hand something to a person, then
 * quitting — which is separated because it stops the server for everyone in the
 * room, not just this window.
 */
export function trayMenuTemplate(actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Settings…', click: () => actions.openSettings() },
    { type: 'separator' },
    { label: 'Restart server', click: () => actions.restartServer() },
    { label: 'Reload connected browsers', click: () => actions.reloadClients() },
    // Next to the other "the world moved, catch up" verb. The server watches
    // YARG's song cache and rebuilds on its own; this is for the case the
    // watcher cannot see — songs added to a folder YARG has not rescanned.
    { label: 'Rebuild media index', click: () => actions.rebuildMediaIndex() },
    { type: 'separator' },
    { label: 'Open in browser', click: () => actions.openInBrowser() },
    { label: 'Copy LAN address', click: () => actions.copyLanAddress() },
    /*
     * A submenu, not four more top-level entries.
     *
     * This menu is opened to *do* something — restart, reload, quit — and
     * folders are what you want on the rarer day something has gone wrong. Four
     * of them inline would make the common verbs harder to find in order to
     * make an uncommon one easier, which is the wrong trade.
     */
    {
      label: 'Open folder',
      submenu: DATA_FOLDERS.map(({ label, folder }) => ({
        label,
        click: () => actions.openDataFolder(folder),
      })),
    },
    { type: 'separator' },
    // Named for what it does to the room, not for what it does to this window.
    { label: 'Quit YASS (stops the server)', click: () => actions.quit() },
  ]
}
