/**
 * The popover: a frameless window that behaves like a menu hanging off the
 * tray icon.
 *
 * It is hidden rather than closed, so the renderer stays warm and a half-typed
 * path survives being dismissed. It is opaque rather than transparent — a
 * transparent frameless window on Windows loses hardware acceleration and
 * brings resize and repaint quirks, and buys nothing for a design system whose
 * cards are squared-off fills with an inset stroke anyway.
 */

import { app, BrowserWindow, screen, shell, type Tray } from 'electron'
import { join } from 'node:path'

const WIDTH = 420
/** Tall enough to show a status card before the renderer has measured anything. */
const INITIAL_HEIGHT = 320
/** A popover taller than this stops reading as a popover and starts being a window. */
const MAX_HEIGHT = 620
const MIN_HEIGHT = 180
/** Breathing room between the popover and the screen edge it hangs from. */
const GAP = 8

/** `--yarg-surface-app`, so there is no white flash before the page paints. */
const BACKGROUND = '#05060B'

let win: BrowserWindow | null = null

/**
 * The window is as tall as what it has to say.
 *
 * A fixed height meant the settings form was cut off in four states and the
 * running-and-fine state was two thirds empty. The renderer measures its own
 * content and says so; everything here does is clamp it and keep the window
 * against the edge it was hung from.
 */
let height = INITIAL_HEIGHT
/** Where the last `position()` put it, so a resize can grow the right way. */
let placement: { x: number; edge: 'top' | 'bottom' | 'centre'; area: Electron.Rectangle } | null =
  null

/**
 * Depth rather than a boolean: pickers can be opened from a menu while one is
 * already open, and a boolean would be cleared by whichever finished first.
 */
let dialogDepth = 0
/** When the popover was last hidden — see `toggle()`. */
let lastHiddenAt = 0

export function createPopover(): BrowserWindow {
  win = new BrowserWindow({
    width: WIDTH,
    height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: BACKGROUND,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // DevTools steal focus, which the blur handler below has to special-case.
      // Not shipping them keeps that special case out of a packaged build.
      devTools: !app.isPackaged,
    },
  })

  win.setMenu(null)

  // This window holds a privileged bridge. Nothing in it should ever navigate,
  // and a link in it belongs in the user's own browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  /*
   * Escape dismisses it, the way every other menu hanging off a tray icon does.
   *
   * Handled here rather than in the renderer because it has to work while focus
   * is inside a text field, and because it is a property of the window, not of
   * the page: there was previously no way out of this popover at all without a
   * mouse.
   */
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') hidePopover()
  })

  win.on('blur', () => {
    // A native file picker takes focus from its parent window, which would
    // otherwise hide the popover out from under an open dialog — and hiding it
    // mid-dialog leaves the app with no visible window and a modal nobody can
    // find. DevTools blur the same way, which is why they only exist in dev.
    if (dialogDepth > 0) return
    if (win?.webContents.isDevToolsOpened()) return
    hidePopover()
  })

  const devUrl = process.env.YASS_DESKTOP_UI_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, 'ui', 'index.html'))
  }

  return win
}

export function popoverWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

/**
 * Put the window against the edge the tray icon lives on.
 *
 * Everything is computed from the icon's own bounds and the display's *work
 * area* — the part of the screen the taskbar doesn't occupy — rather than from
 * an assumption that the taskbar is at the bottom. That makes a taskbar on any
 * edge, a second monitor, and a fractional DPI scale all the same case.
 */
function position(tray: Tray): void {
  const target = popoverWindow()
  if (!target) return

  const icon = tray.getBounds()
  const hasIcon = icon.width > 0 && icon.height > 0

  // `getBounds()` reports zeros on some platforms, and is stale while the icon
  // sits in Windows' overflow flyout. The cursor is where the user just
  // clicked, which is close enough to hang a menu from.
  const anchor = hasIcon
    ? { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 }
    : screen.getCursorScreenPoint()

  const area = (hasIcon ? screen.getDisplayMatching(icon) : screen.getDisplayNearestPoint(anchor))
    .workArea

  let x: number
  let edge: 'top' | 'bottom' | 'centre'

  if (anchor.x < area.x) {
    // Taskbar down the left edge.
    x = area.x + GAP
    edge = 'centre'
  } else if (anchor.x > area.x + area.width) {
    // Taskbar down the right edge.
    x = area.x + area.width - WIDTH - GAP
    edge = 'centre'
  } else {
    x = anchor.x - WIDTH / 2
    // Which half of the work area the icon sits in decides whether the popover
    // hangs below the icon or stands above it.
    edge = anchor.y > area.y + area.height / 2 ? 'bottom' : 'top'
  }

  placement = { x, edge, area }
  applyBounds(anchor.y)
}

/** Round to whole device-independent pixels; mixed-DPI setups produce fractions. */
function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max))
}

/**
 * Put the window where `placement` says, at the current height.
 *
 * Bottom-anchored means the bottom edge stays put and the window grows upward,
 * which is what a menu hanging off a taskbar does; growing downward would walk
 * it off the screen.
 */
function applyBounds(centreOn?: number): void {
  const target = popoverWindow()
  if (!target || !placement) return

  const { x, edge, area } = placement

  const y =
    edge === 'bottom'
      ? area.y + area.height - height - GAP
      : edge === 'top'
        ? area.y + GAP
        : (centreOn ?? target.getBounds().y + target.getBounds().height / 2) - height / 2

  target.setBounds({
    x: clamp(x, area.x + GAP, area.x + area.width - WIDTH - GAP),
    y: clamp(y, area.y + GAP, Math.max(area.y + GAP, area.y + area.height - height - GAP)),
    width: WIDTH,
    height,
  })
}

/**
 * Take the renderer's measurement of its own content.
 *
 * Clamped against the work area as well as `MAX_HEIGHT`, because a short
 * screen is a harder limit than taste is.
 */
export function resizePopover(content: number): void {
  const target = popoverWindow()
  if (!target || !Number.isFinite(content)) return

  const room = placement ? placement.area.height - GAP * 2 : MAX_HEIGHT
  const next = clamp(Math.ceil(content), MIN_HEIGHT, Math.min(MAX_HEIGHT, room))

  if (next === height) return
  height = next
  applyBounds()
}

export function showPopover(tray: Tray): void {
  const target = popoverWindow()
  if (!target) return

  // Position before showing, or the window paints at its old coordinates and
  // visibly jumps into place.
  position(tray)
  target.show()
  // `show()` and not `showInactive()`: an unfocused window never receives
  // `blur`, so a popover shown inactive could never dismiss itself.
  target.focus()
}

export function hidePopover(): void {
  const target = popoverWindow()
  if (!target) return

  lastHiddenAt = Date.now()
  target.hide()
}

export function togglePopover(tray: Tray): void {
  const target = popoverWindow()
  if (!target) return

  if (target.isVisible()) {
    hidePopover()
    return
  }

  /*
   * Clicking the tray icon while the popover is open fires `blur` first — the
   * popover hides — and only then delivers the click. Without this guard the
   * click would find a hidden window and show it straight back, so the icon
   * could open the popover but never close it.
   */
  if (Date.now() - lastHiddenAt < 250) return

  showPopover(tray)
}

/**
 * Run something that opens a native dialog, with the blur handler disarmed.
 *
 * The `focus()` afterwards is not cosmetic: without it the popover is visible
 * but unfocused, so the *next* click elsewhere produces no `blur` event and it
 * never dismisses again.
 */
export async function withDialog<T>(action: () => Promise<T>): Promise<T> {
  dialogDepth += 1
  try {
    return await action()
  } finally {
    dialogDepth -= 1
    const target = popoverWindow()
    if (target?.isVisible()) target.focus()
  }
}
