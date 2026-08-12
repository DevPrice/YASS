import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sanitizePatch } from './config.js'

/**
 * `sanitizePatch` is the trust boundary between the popover and the settings
 * file. Everything past it is the server's own `normalizeSettings`, so the only
 * job here is deciding which keys are allowed to exist at all.
 */
describe('sanitizePatch', () => {
  it('keeps the editable fields', () => {
    const patch = sanitizePatch({
      yargDataDir: 'C:/yarg',
      pollIntervalMs: 500,
      host: '127.0.0.1',
      port: 4321,
    })

    assert.deepEqual(patch, {
      yargDataDir: 'C:/yarg',
      pollIntervalMs: 500,
      host: '127.0.0.1',
      port: 4321,
    })
  })

  it('drops a setting that no longer exists', () => {
    // The song list used to be a path the user pointed at by hand. A stale
    // popover, or an old settings file being replayed, must not be able to put
    // it back.
    assert.deepEqual(sanitizePatch({ songListCsvPath: 'C:/songs.csv' }), {})
  })

  it('drops anything not on the list', () => {
    const patch = sanitizePatch({ port: 4321, __proto__: { polluted: true }, cwd: '/etc' })

    assert.deepEqual(Object.keys(patch), ['port'])
  })

  it('omits absent keys rather than filling them in', () => {
    // A patch merges onto stored settings, so an invented `undefined` here
    // would erase a value the user never touched.
    assert.deepEqual(sanitizePatch({ port: 4321 }), { port: 4321 })
    assert.deepEqual(sanitizePatch({}), {})
  })

  it('passes values through untouched, leaving the clamping to the server', () => {
    // Whichever path does the writing runs `normalizeSettings`, which is the
    // one definition of what a usable value is. Second-guessing it here would
    // give the tray its own, quietly different, opinion.
    assert.deepEqual(sanitizePatch({ pollIntervalMs: 99_999, port: -1 }), {
      pollIntervalMs: 99_999,
      port: -1,
    })
  })

  it('treats a non-object as an empty patch', () => {
    assert.deepEqual(sanitizePatch(null), {})
    assert.deepEqual(sanitizePatch('port=4321'), {})
  })
})
