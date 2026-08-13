import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { autostartFilePath, desktopEntry, quoteExec, readAutostart, writeAutostart } from './autostart.js'

/**
 * The Linux half of "start when I log in".
 *
 * Runs on every platform on purpose: none of this is Linux-specific code, it
 * is a text format and two filesystem calls, and a Windows developer changing
 * the entry should find out here rather than from a session that quietly
 * refuses to start it.
 */
describe('autostart entry', () => {
  it('quotes a path with a space in it', () => {
    assert.equal(quoteExec('/home/a b/YASS.AppImage'), '"/home/a b/YASS.AppImage"')
  })

  it('escapes the two characters the desktop spec reserves inside quotes', () => {
    // A backslash and a double quote are both legal in a POSIX filename, and
    // both end the argument early if they go in raw.
    assert.equal(quoteExec('/home/a"b\\c/YASS'), '"/home/a\\"b\\\\c/YASS"')
  })

  it('names an executable the session can actually launch', () => {
    const entry = desktopEntry('/home/devin/Apps/YASS.AppImage')

    assert.match(entry, /^\[Desktop Entry\]$/m)
    assert.match(entry, /^Type=Application$/m)
    assert.match(entry, /^Exec="\/home\/devin\/Apps\/YASS\.AppImage"$/m)
    // GNOME writes this key when the user disables an entry in its own UI, so
    // turning the switch back on has to say so explicitly.
    assert.match(entry, /^X-GNOME-Autostart-enabled=true$/m)
  })
})

describe('autostart file', () => {
  let previous: string | undefined
  let root: string

  before(() => {
    previous = process.env.XDG_CONFIG_HOME
    root = mkdtempSync(join(tmpdir(), 'yass-autostart-'))
    process.env.XDG_CONFIG_HOME = root
  })

  after(() => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(root, { recursive: true, force: true })
  })

  it('follows XDG_CONFIG_HOME rather than assuming ~/.config', () => {
    assert.equal(autostartFilePath(), join(root, 'autostart', 'yass.desktop'))
  })

  it('writes, reads back, and removes', () => {
    assert.equal(readAutostart(), false)

    // The directory does not exist on a fresh profile — creating it is part of
    // the job, not a precondition.
    writeAutostart(true, '/opt/yass/YASS.AppImage')
    assert.equal(readAutostart(), true)
    assert.match(readFileSync(autostartFilePath(), 'utf8'), /Exec="\/opt\/yass\/YASS\.AppImage"/)

    writeAutostart(false, '/opt/yass/YASS.AppImage')
    assert.equal(readAutostart(), false)
  })

  it('turning it off when it was never on is not an error', () => {
    writeAutostart(false, '/opt/yass/YASS.AppImage')
    assert.equal(readAutostart(), false)
  })
})
