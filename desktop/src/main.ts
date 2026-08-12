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
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { ServerStatus, Settings } from '@shared/types.js'
import { lanAddresses } from '@server/core/net.js'
import {
  appConfigDir,
  defaultYargDataDir,
  managedBinDir,
  mediaCacheDir,
} from '@server/core/paths.js'
import { bindingChanged } from '@server/core/settings.js'

import {
  apiJson,
  installFfmpeg,
  readSettingsView,
  rebuildMediaIndex,
  reloadClients,
  sanitizePatch,
  saveSettings,
} from './config.js'
import { CHANNELS, type DesktopState, type SaveOutcome } from './ipc.js'
import {
  createPopover,
  popoverWindow,
  resizePopover,
  showPopover,
  togglePopover,
  withDialog,
} from './popover.js'
import { ServerChild, logDir } from './server.js'
import { createTray, type DataFolder } from './tray.js'

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
/** True while an ffmpeg download is running, so the popover can say so. */
let fetchingFfmpeg = false

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
    media: status?.media ?? null,
    fetchingFfmpeg,
    // Only worth showing when the server can actually be reached at them.
    lan: running && server.isLanBound && boundPort ? lanAddresses(boundPort) : [],
    localUrl: running ? server.localUrl : null,
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
    const { applied } = await saveSettings(sanitizePatch(patch), server.apiOrigin)
    const state = await buildState()
    // The popover gets the result as a return value; everything else that
    // renders state — the tooltip — needs telling too.
    void publish()
    return { state, applied } satisfies SaveOutcome
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

  ipcMain.handle(CHANNELS.restartServer, async () => {
    await server.restart()
    return buildState()
  })

  /*
   * The download is long, and the popover is watching.
   *
   * `fetchingFfmpeg` is published immediately so the button can go into its
   * pending state on the click rather than on the reply — which for a 110 MB
   * download would be a minute later. `publish()` at each end of it keeps the
   * popover honest whether the download works or fails.
   */
  ipcMain.handle(CHANNELS.fetchFfmpeg, async () => {
    if (fetchingFfmpeg) return buildState()

    fetchingFfmpeg = true
    void publish()

    try {
      await installFfmpeg(server.apiOrigin)
    } finally {
      fetchingFfmpeg = false
    }

    const state = await buildState()
    void publish()
    return state
  })

  ipcMain.handle(CHANNELS.rebuildMediaIndex, async () => {
    await rebuildMediaIndex(server.apiOrigin)
    const state = await buildState()
    void publish()
    return state
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

/**
 * Show one of the app's own folders in the file manager.
 *
 * Created first if it isn't there. Three of these four are made lazily — `logs`
 * when the server first starts, `cache` when the first thumbnail is generated,
 * `bin` only if ffmpeg was ever downloaded — so on a fresh install most of them
 * do not exist yet, and `shell.openPath` on a missing directory fails with a
 * message nobody sees. Creating an empty folder someone explicitly asked to look
 * at is both honest about where the thing will be and better than a menu item
 * that silently does nothing.
 */
async function openDataFolder(folder: DataFolder): Promise<void> {
  const paths: Record<DataFolder, string> = {
    config: appConfigDir(),
    logs: logDir(),
    media: mediaCacheDir(),
    bin: managedBinDir(),
  }

  const path = paths[folder]

  try {
    await mkdir(path, { recursive: true })
  } catch (error) {
    console.error(`[yass] could not create ${path}:`, error)
    return
  }

  // Resolves with an empty string on success and an error message otherwise —
  // it does not reject.
  const problem = await shell.openPath(path)
  if (problem) console.error(`[yass] could not open ${path}: ${problem}`)
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
    rebuildMediaIndex: () =>
      void rebuildMediaIndex(server.apiOrigin).then(() => publish()),
    openInBrowser: () => void openInBrowser(),
    copyLanAddress: () => void copyLanAddress(),
    openDataFolder: (folder) => void openDataFolder(folder),
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
