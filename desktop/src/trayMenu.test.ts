/**
 * The tray menu is data, so it can be checked like data.
 *
 * Worth checking at all because a menu is the one surface where a wiring
 * mistake is invisible until somebody clicks it: four entries that differ only
 * by which argument they pass will build, render and look correct while opening
 * the same folder four times.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DATA_FOLDERS, trayMenuTemplate, type DataFolder, type TrayActions } from './trayMenu.js'

/** Records every action the menu invokes, so a click can be traced to a verb. */
function recorder(): { actions: TrayActions; calls: string[]; folders: DataFolder[] } {
  const calls: string[] = []
  const folders: DataFolder[] = []

  const actions: TrayActions = {
    toggle: () => calls.push('toggle'),
    openSettings: () => calls.push('openSettings'),
    restartServer: () => calls.push('restartServer'),
    reloadClients: () => calls.push('reloadClients'),
    rebuildMediaIndex: () => calls.push('rebuildMediaIndex'),
    openInBrowser: () => calls.push('openInBrowser'),
    copyLanAddress: () => calls.push('copyLanAddress'),
    openDataFolder: (folder) => {
      calls.push('openDataFolder')
      folders.push(folder)
    },
    quit: () => calls.push('quit'),
  }

  return { actions, calls, folders }
}

type Item = ReturnType<typeof trayMenuTemplate>[number]

const labelled = (items: readonly Item[], label: string): Item | undefined =>
  items.find((item) => item.label === label)

describe('tray menu', () => {
  it('offers one entry per folder the app writes to', () => {
    const { actions } = recorder()
    const submenu = labelled(trayMenuTemplate(actions), 'Open folder')?.submenu

    assert.ok(Array.isArray(submenu), 'the Open folder entry has no submenu')
    assert.equal(submenu.length, DATA_FOLDERS.length)
    assert.deepEqual(
      submenu.map((item) => item.label),
      ['Settings and data', 'Logs', 'Album art and previews', 'Downloaded ffmpeg'],
    )
  })

  it('opens a different folder from each entry', () => {
    const { actions, folders } = recorder()
    const submenu = labelled(trayMenuTemplate(actions), 'Open folder')?.submenu
    assert.ok(Array.isArray(submenu))

    for (const item of submenu) {
      item.click?.(null as never, undefined, null as never)
    }

    // The failure this exists for: four items that all pass the same key.
    assert.deepEqual(folders, ['config', 'logs', 'media', 'bin'])
    assert.equal(new Set(folders).size, folders.length, 'two entries open the same folder')
  })

  it('keeps every folder key distinct', () => {
    const keys = DATA_FOLDERS.map((entry) => entry.folder)
    assert.equal(new Set(keys).size, keys.length)

    const labels = DATA_FOLDERS.map((entry) => entry.label)
    assert.equal(new Set(labels).size, labels.length)
  })

  it('leaves the existing verbs wired to themselves', () => {
    // The folders submenu was added to a menu that already worked; this is the
    // regression check that it still does.
    const { actions, calls } = recorder()
    const items = trayMenuTemplate(actions)

    for (const label of [
      'Settings…',
      'Restart server',
      'Reload connected browsers',
      'Rebuild media index',
      'Open in browser',
      'Copy LAN address',
      'Quit YASS (stops the server)',
    ]) {
      const item = labelled(items, label)
      assert.ok(item, `the menu lost "${label}"`)
      item.click?.(null as never, undefined, null as never)
    }

    assert.deepEqual(calls, [
      'openSettings',
      'restartServer',
      'reloadClients',
      'rebuildMediaIndex',
      'openInBrowser',
      'copyLanAddress',
      'quit',
    ])
  })

  it('separates quitting from everything else', () => {
    const { actions } = recorder()
    const items = trayMenuTemplate(actions)

    const quitAt = items.findIndex((item) => item.label?.startsWith('Quit'))
    assert.ok(quitAt > 0)
    assert.equal(
      items[quitAt - 1]?.type,
      'separator',
      'quitting stops the server for the whole room and must not sit against another verb',
    )
  })
})
