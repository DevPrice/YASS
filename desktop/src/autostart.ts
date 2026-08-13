/**
 * "Start when I log in", on the platform Electron doesn't do it for.
 *
 * `app.setLoginItemSettings` writes a registry Run entry on Windows and a
 * launch-services item on macOS. On Linux it does nothing and reports back
 * `false` — so the toggle in the popover would flip and then quietly flip
 * itself back, which is worse than not offering it.
 *
 * What Linux has instead is the desktop-entry spec: a `.desktop` file in
 * `$XDG_CONFIG_HOME/autostart`, which GNOME, KDE, XFCE and every other
 * mainstream session read at login. Writing one is the whole implementation.
 *
 * No Electron import here on purpose, the same way `trayMenu.ts` has none: the
 * platform glue lives in `main.ts`, and what is left is a file path, a string,
 * and two filesystem calls that a test can run.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Named for the app rather than the binary: the binary moves, this doesn't. */
const ENTRY_NAME = 'yass.desktop'

/**
 * Where the session looks for things to start.
 *
 * `XDG_CONFIG_HOME` rather than a hardcoded `~/.config`, matching
 * `appConfigDir()` in the server — a user who has moved their config directory
 * has moved this too.
 */
export function autostartFilePath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'autostart', ENTRY_NAME)
}

/**
 * Quote a path for an `Exec=` line.
 *
 * The spec reserves a list of characters and asks for double quotes around any
 * argument containing one, with backslash escapes for a literal backslash or
 * quote inside. A home directory with a space in it is the everyday case; the
 * rest is what keeps a hostile path from becoming extra arguments.
 */
export function quoteExec(path: string): string {
  const escaped = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

/**
 * The entry itself.
 *
 * `X-GNOME-Autostart-enabled` is not in the spec, but GNOME writes it when the
 * user toggles an entry off in its own UI and honours it on the way back in.
 * Saying `true` explicitly means a previously disabled entry comes back on when
 * the switch here is turned on again, rather than being remembered as off.
 */
export function desktopEntry(execPath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=YASS',
    'Comment=Song browser for YARG',
    `Exec=${quoteExec(execPath)}`,
    'Icon=yass',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

/** Whether the entry is there — the file's existence is the setting. */
export function readAutostart(): boolean {
  return existsSync(autostartFilePath())
}

/**
 * Write or remove the entry.
 *
 * Synchronous, because the caller is an IPC handler that answers with the new
 * state and a kilobyte of text is not worth an await chain. Failures are the
 * caller's to report: a read-only home directory is a thing the user should be
 * told about rather than a switch that silently does nothing.
 */
export function writeAutostart(enabled: boolean, execPath: string): void {
  const path = autostartFilePath()

  if (!enabled) {
    rmSync(path, { force: true })
    return
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, desktopEntry(execPath), 'utf8')
}
