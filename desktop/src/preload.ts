/**
 * The only thing the popover's renderer can reach.
 *
 * The renderer runs sandboxed with no Node integration, so this is the whole
 * surface: nine verbs and a subscription, each one a message to the main
 * process. Nothing here does any work — deliberately, because everything this
 * app can do (write the settings file, stop the server, download a hundred
 * megabytes) is something a page must never be able to do on its own.
 *
 * Quitting and reloading the guests' browsers are not on it. Both live on the
 * tray's menu, which is where a window that cannot be resized should be
 * putting the verbs it does not need to show.
 *
 * CommonJS, and it has to be: an ESM preload is not supported under
 * `sandbox: true`.
 */

import { contextBridge, ipcRenderer } from 'electron'

import type { Settings } from '@shared/types.js'
import { CHANNELS, type DesktopApi, type DesktopState, type SaveOutcome } from './ipc.js'

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(CHANNELS.getState) as Promise<DesktopState>,
  saveSettings: (patch: Partial<Settings>) =>
    ipcRenderer.invoke(CHANNELS.saveSettings, patch) as Promise<SaveOutcome>,
  pickDirectory: (current: string) =>
    ipcRenderer.invoke(CHANNELS.pickDirectory, current) as Promise<string | null>,
  pickFile: (current: string) =>
    ipcRenderer.invoke(CHANNELS.pickFile, current) as Promise<string | null>,
  restartServer: () => ipcRenderer.invoke(CHANNELS.restartServer) as Promise<DesktopState>,
  fetchFfmpeg: () => ipcRenderer.invoke(CHANNELS.fetchFfmpeg) as Promise<DesktopState>,
  rebuildMediaIndex: () =>
    ipcRenderer.invoke(CHANNELS.rebuildMediaIndex) as Promise<DesktopState>,
  setOpenAtLogin: (enabled: boolean) =>
    ipcRenderer.invoke(CHANNELS.setOpenAtLogin, enabled) as Promise<DesktopState>,
  openInBrowser: () => ipcRenderer.send(CHANNELS.openInBrowser),
  copyText: (text: string) => ipcRenderer.send(CHANNELS.copyText, text),
  resize: (height: number) => ipcRenderer.send(CHANNELS.resize, height),

  onState: (listener) => {
    const handler = (_event: unknown, state: DesktopState) => listener(state)
    ipcRenderer.on(CHANNELS.state, handler)
    return () => {
      ipcRenderer.off(CHANNELS.state, handler)
    }
  },
}

contextBridge.exposeInMainWorld('yass', api)
