/**
 * YASS in the notification area.
 *
 * The web app is meant to be pointed at from a phone at a party; this process
 * is the half of it that belongs to the host — it owns configuration behind
 * native file pickers, runs the server as a child, and shows the address to
 * hand to a guest. None of that is reachable from the LAN-facing client on
 * purpose: the endpoints behind it are host-only, and the settings UI is a
 * different app in a different window.
 */

import { app, clipboard, dialog, ipcMain, shell, type Tray } from 'electron'
import { dirname, join } from 'node:path'

import type { ServerStatus, Settings } from '@shared/types.js'
import { lanAddresses } from '@server/core/net.js'
import { appConfigDir, defaultYargDataDir } from '@server/core/paths.js'
import { bindingChanged } from '@server/core/settings.js'

import {
  apiJson,
  readSettingsView,
  reloadClients,
  sanitizePatch,
  saveSettings,
} from './config.js'
import { CHANNELS, type DesktopState } from './ipc.js'
import {
  createPopover,
  popoverWindow,
  resizePopover,
  showPopover,
  togglePopover,
  withDialog,
} from './popover.js'
import { ServerChild } from './server.js'
import { createTray } from './tray.js'

/*
 * Before anything touches a Chromium path.
 *
 * `appConfigDir()` is `%APPDATA%\yass`, and Electron's default `userData` is
 * `%APPDATA%\<productName>` — which on a case-insensitive filesystem would put
 * Chromium's caches, cookies and preferences directly on top of the server's
 * `settings.json`. Naming the subfolder explicitly is the fix; relying on the
 * product name not colliding is not.
 */
app.setName('YASS')
app.setPath('userData', join(appConfigDir(), 'electron'))

const server = new ServerChild()
let tray: Tray | null = null
let quitting = false
/** Refreshes the popover's song count while it is actually on screen. */
let pollTimer: NodeJS.Timeout | null = null

/**
 * Where "start with Windows" should point.
 *
 * A portable build runs from a temp directory that is cleaned up between
 * launches, so `process.execPath` would register a login item that stops
 * existing. `PORTABLE_EXECUTABLE_FILE` is the `.exe` the user actually
 * double-clicked.
 */
function launchPath(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
}

async function buildState(): Promise<DesktopState> {
  const origin = server.apiOrigin
  const view = await readSettingsView(origin)
  const status = origin ? await apiJson<ServerStatus>(`${origin}/api/status`) : null
  const serverState = server.state
  const { host: boundHost, port: boundPort } = serverState

  const running = serverState.status === 'running'

  return {
    view,
    server: serverState,
    songs: status?.songs ?? null,
    // Only worth showing when the server can actually be reached at them.
    lan: running && server.isLanBound && boundPort ? lanAddresses(boundPort) : [],
    localUrl: running ? server.localUrl : null,
    // Nothing is pending against a socket that isn't open.
    restartRequired:
      running && boundHost !== null && boundPort !== null
        ? bindingChanged(view.settings, boundHost, boundPort)
        : false,
    liveApply: origin !== null,
    openAtLogin: app.getLoginItemSettings({ path: launchPath() }).openAtLogin,
    version: app.getVersion(),
  }
}

/** Push the current state at the popover, and say the same thing in the tooltip. */
async function publish(): Promise<void> {
  const state = await buildState()

  popoverWindow()?.webContents.send(CHANNELS.state, state)

  // The tooltip is the only thing the app says without being opened, so it says
  // the one thing worth knowing at a glance: is this working, and where.
  if (tray) {
    const summaries: Record<DesktopState['server']['status'], () => string> = {
      // The shareable one, not `localUrl`: 127.0.0.1 is the single address in
      // the app that is of no use to the person being told it.
      running: () =>
        `YASS — ${state.songs?.count ?? 0} songs on ${shareableUrl(state) ?? 'this machine'}`,
      failed: () => `YASS — ${state.server.message ?? 'the server is not running'}`,
      starting: () => 'YASS — starting…',
      stopped: () => 'YASS — the server is stopped',
    }

    tray.setToolTip(summaries[state.server.status]())
  }
}

function startPolling(): void {
  if (pollTimer) return
  // Only while the popover is open: the song count changes when the CSV is
  // re-exported, and nobody is watching a window that isn't on screen.
  pollTimer = setInterval(() => void publish(), 5000)
}

function stopPolling(): void {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

/**
 * The address to hand to a guest.
 *
 * `lan` arrives with the reachable adapters first, so the head of it is the one
 * worth reading out; `localUrl` is the fallback for a loopback-only bind, where
 * there is nothing to hand anybody.
 */
function shareableUrl(state: DesktopState): string | null {
  return state.lan[0]?.url ?? state.localUrl
}

async function quit(): Promise<void> {
  if (quitting) return
  quitting = true

  stopPolling()
  tray?.destroy()
  tray = null

  await server.stop()
  app.exit(0)
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.getState, () => buildState())

  ipcMain.handle(CHANNELS.saveSettings, async (_event, patch: Partial<Settings>) => {
    await saveSettings(sanitizePatch(patch), server.apiOrigin)
    const state = await buildState()
    // The popover gets the result as a return value; everything else that
    // renders state — the tooltip — needs telling too.
    void publish()
    return state
  })

  ipcMain.handle(CHANNELS.pickDirectory, (_event, current: string) =>
    withDialog(async () => {
      const window = popoverWindow()
      if (!window) return null

      const result = await dialog.showOpenDialog(window, {
        title: 'Select the YARG data folder',
        defaultPath: current || defaultYargDataDir('release'),
        properties: ['openDirectory'],
      })

      // Cancel returns null, and the caller must leave the field alone — never
      // read a cancelled picker as "clear this setting".
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }),
  )

  ipcMain.handle(CHANNELS.pickFile, (_event, current: string) =>
    withDialog(async () => {
      const window = popoverWindow()
      if (!window) return null

      const result = await dialog.showOpenDialog(window, {
        title: 'Select the song list export',
        defaultPath: current ? dirname(current) : undefined,
        filters: [
          { name: 'Song list export', extensions: ['csv'] },
          { name: 'All files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      return result.canceled ? null : (result.filePaths[0] ?? null)
    }),
  )

  ipcMain.handle(CHANNELS.restartServer, async () => {
    await server.restart()
    return buildState()
  })

  ipcMain.handle(CHANNELS.setOpenAtLogin, async (_event, enabled: boolean) => {
    // Read back from the OS rather than stored in `settings.json`: this is a
    // property of the machine, not of the app's configuration, and the file is
    // meant to be portable between them.
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: launchPath() })
    return buildState()
  })

  ipcMain.on(CHANNELS.openInBrowser, () => void openInBrowser())

  ipcMain.on(CHANNELS.copyText, (_event, text: unknown) => {
    if (typeof text === 'string' && text.length > 0) clipboard.writeText(text)
  })

  ipcMain.on(CHANNELS.resize, (_event, height: unknown) => {
    if (typeof height === 'number') resizePopover(height)
  })
}

async function openInBrowser(): Promise<void> {
  const url = (await buildState()).localUrl
  if (url) void shell.openExternal(url)
}

async function copyLanAddress(): Promise<void> {
  const url = shareableUrl(await buildState())
  if (url) clipboard.writeText(url)
}

async function start(): Promise<void> {
  await app.whenReady()

  // No dock icon on macOS; this app lives in the menu bar.
  app.dock?.hide()

  const window = createPopover()
  window.on('show', startPolling)
  window.on('hide', stopPolling)

  tray = createTray({
    toggle: () => tray && togglePopover(tray),
    openSettings: () => tray && showPopover(tray),
    restartServer: () => void server.restart(),
    reloadClients: () => void reloadClients(server.apiOrigin),
    openInBrowser: () => void openInBrowser(),
    copyLanAddress: () => void copyLanAddress(),
    quit: () => void quit(),
  })

  server.onChange(() => void publish())
  registerIpc()

  await server.start()
  await publish()
}

/*
 * One YASS at a time.
 *
 * Two copies would race for port 4321, and the loser would sit there failed
 * while the user wondered which window was which. A second launch is almost
 * always somebody double-clicking the exe again because they forgot it was
 * already running — so show them the popover.
 */
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    if (tray) showPopover(tray)
  })

  // A tray app has no windows most of the time; closing the popover is not a
  // reason to exit.
  app.on('window-all-closed', () => {})

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    void quit()
  })

  /*
   * A tray app that fails to start has no window to fail in.
   *
   * Without this the process sits there owning an icon that does nothing, or
   * no icon at all, and says nothing anywhere — which is exactly what a
   * packaged build would do with the console it doesn't have.
   */
  void start().catch((error: unknown) => {
    console.error('[yass] the tray failed to start:', error)
    dialog.showErrorBox('YASS could not start', String(error))
    app.exit(1)
  })
}
