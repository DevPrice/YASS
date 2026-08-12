/**
 * The shape that crosses the process boundary.
 *
 * Imported type-only by main, by the preload script and by the popover's React
 * code, so all three agree on what a state push contains. Nothing here is
 * runtime code — the renderer is sandboxed and can't load main's modules.
 */

import type {
  LanAddress,
  LibraryMeta,
  MediaSummary,
  Settings,
  SettingsView,
} from '@shared/types.js'

export type ServerStatusName = 'starting' | 'running' | 'stopped' | 'failed'

export interface ServerState {
  status: ServerStatusName
  /**
   * Why it isn't running, in words a person can act on — "Port 4321 is already
   * in use", not a stack frame. Null while things are fine.
   */
  message: string | null
  /** What the process actually bound, once it did. */
  host: string | null
  port: number | null
}

export interface DesktopState {
  /** Settings plus the existence checks, from whichever source is authoritative. */
  view: SettingsView
  server: ServerState
  /** The song index as the running server last loaded it. */
  songs: LibraryMeta | null
  /**
   * Album art and previews, or null when there is no server to ask.
   *
   * Null and "not working" are different states and the popover draws them
   * differently: with the server down there is nothing to say about media, and
   * offering to download ffmpeg for a server that isn't running would be a
   * button that fixes the wrong problem.
   */
  media: MediaSummary | null
  /** True while an ffmpeg download this process started is still running. */
  fetchingFfmpeg: boolean
  /**
   * Addresses to hand to a guest, reachable ones first. Empty unless the
   * server is bound LAN-wide.
   */
  lan: LanAddress[]
  /** The host's own URL, which exists whatever the bind address is. */
  localUrl: string | null
  /**
   * Whether a save will reach the running server and apply without a restart.
   *
   * False when the server is down, and false when it is bound to one specific
   * non-loopback address — the tray's own request then arrives from a LAN
   * address and the host-only settings endpoint rightly refuses it.
   */
  liveApply: boolean
  openAtLogin: boolean
  version: string
}

/**
 * What a save actually did.
 *
 * `applied` was computed by `config.ts` from the start and thrown away by the
 * IPC handler, so "saved" read identically whether the running server took the
 * change live or it only reached the file — in the one state where the
 * difference is the entire point.
 */
export interface SaveOutcome {
  state: DesktopState
  applied: boolean
}

/** Channel names, in one place so a typo can't silently do nothing. */
export const CHANNELS = {
  getState: 'yass:get-state',
  saveSettings: 'yass:save-settings',
  pickDirectory: 'yass:pick-directory',
  restartServer: 'yass:restart-server',
  fetchFfmpeg: 'yass:fetch-ffmpeg',
  rebuildMediaIndex: 'yass:rebuild-media-index',
  setOpenAtLogin: 'yass:set-open-at-login',
  openInBrowser: 'yass:open-in-browser',
  copyText: 'yass:copy-text',
  resize: 'yass:resize',
  /** Main → renderer: pushed whenever anything above changes. */
  state: 'yass:state',
} as const

/** The surface `preload.ts` puts on `window.yass`. */
export interface DesktopApi {
  getState(): Promise<DesktopState>
  saveSettings(patch: Partial<Settings>): Promise<SaveOutcome>
  /** Absolute path, or null if the picker was cancelled. */
  pickDirectory(current: string): Promise<string | null>
  restartServer(): Promise<DesktopState>
  /**
   * Download ffmpeg, which album art and previews need.
   *
   * ~110 MB, once, and then never again — it is cached in the app's own
   * directory. Resolves when the download finishes, which is why the popover
   * shows progress rather than blocking on it.
   */
  fetchFfmpeg(): Promise<DesktopState>
  /** Re-read YARG's song cache and rebuild the map from songs to files. */
  rebuildMediaIndex(): Promise<DesktopState>
  setOpenAtLogin(enabled: boolean): Promise<DesktopState>
  openInBrowser(): void
  /**
   * Copy through the main process rather than `navigator.clipboard`.
   *
   * The async clipboard API needs a permission that a sandboxed `file://`
   * renderer is not reliably granted, and a copy button that silently does
   * nothing is worse than no copy button.
   */
  copyText(text: string): void
  /**
   * How tall the content is, so the window can be that tall.
   *
   * Only the renderer knows: the height depends on which state the card is in,
   * whether the settings are folded open, and how many warnings the CSV load
   * produced. Main clamps it against the work area.
   */
  resize(height: number): void
  /** Subscribe to state pushes. Returns an unsubscribe function. */
  onState(listener: (state: DesktopState) => void): () => void
}
