/**
 * The only thing the popover's renderer can reach.
 *
 * The renderer runs sandboxed with no Node integration, so this is the whole
 * surface: nine verbs and a subscription, each one a message to the main
 * process. Nothing here does any work — deliberately, because everything this
 * app can do (write the settings file, stop the server, quit) is something a
 * page must never be able to do on its own.
 *
 * CommonJS, and it has to be: an ESM preload is not supported under
 * `sandbox: true`.
 */

import { contextBridge, ipcRenderer } from 'electron'

import type { Settings } from '@shared/types.js'
import { CHANNELS, type DesktopApi, type DesktopState } from './ipc.js'

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(CHANNELS.getState) as Promise<DesktopState>,
  saveSettings: (patch: Partial<Settings>) =>
    ipcRenderer.invoke(CHANNELS.saveSettings, patch) as Promise<DesktopState>,
  pickDirectory: (current: string) =>
    ipcRenderer.invoke(CHANNELS.pickDirectory, current) as Promise<string | null>,
  pickFile: (current: string) =>
    ipcRenderer.invoke(CHANNELS.pickFile, current) as Promise<string | null>,
  restartServer: () => ipcRenderer.invoke(CHANNELS.restartServer) as Promise<DesktopState>,
  reloadClients: () => ipcRenderer.invoke(CHANNELS.reloadClients) as Promise<boolean>,
  setOpenAtLogin: (enabled: boolean) =>
    ipcRenderer.invoke(CHANNELS.setOpenAtLogin, enabled) as Promise<DesktopState>,
  openInBrowser: () => ipcRenderer.send(CHANNELS.openInBrowser),
  copyText: (text: string) => ipcRenderer.send(CHANNELS.copyText, text),
  quit: () => ipcRenderer.send(CHANNELS.quit),

  onState: (listener) => {
    const handler = (_event: unknown, state: DesktopState) => listener(state)
    ipcRenderer.on(CHANNELS.state, handler)
    return () => {
      ipcRenderer.off(CHANNELS.state, handler)
    }
  },
}

contextBridge.exposeInMainWorld('yass', api)
