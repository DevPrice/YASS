/**
 * Finding the YARG installs on this machine.
 *
 * `findInstalls` takes its roots as an argument precisely so this file can hand
 * it a temporary directory instead of the user's profile — the platform default
 * is `installRoots`' business, and it is the only part that has to be believed
 * rather than tested.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { channelOf, findInstalls, installRoots, pathKey, unityPersistentDataPath } from './paths.js'

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'yass-installs-'))
}

describe('channelOf', () => {
  it('reads the last segment of a data directory', () => {
    assert.equal(channelOf('/home/d/.config/unity3d/YARC/YARG/nightly'), 'nightly')
    assert.equal(channelOf('/home/d/.config/unity3d/YARC/YARG/release/'), 'release')
  })

  it('reads a Windows path on any platform', () => {
    // The settings file travels; the tests run on two runners. POSIX
    // `basename` would hand back the whole string here.
    assert.equal(channelOf('C:\\Users\\d\\AppData\\LocalLow\\YARC\\YARG\\Dev'), 'dev')
    assert.equal(channelOf('C:\\Users\\d\\AppData\\LocalLow\\YARC\\YARG\\nightly\\'), 'nightly')
  })

  it('is null for a folder that names no channel', () => {
    assert.equal(channelOf('D:\\yarg-stuff'), null)
    assert.equal(channelOf('/srv/yarg'), null)
    assert.equal(channelOf(''), null)
  })
})

describe('pathKey', () => {
  it('settles trailing separators and relative segments', () => {
    assert.equal(pathKey(join('/srv', 'yarg', 'release')), pathKey(join('/srv/yarg/release/')))
    assert.equal(pathKey('/srv/yarg/nightly'), pathKey('/srv/yarg/dev/../nightly'))
  })

  it('leaves the empty path alone rather than resolving it to the cwd', () => {
    assert.equal(pathKey(''), '')
  })

  it('folds case only where the filesystem does', () => {
    const same = pathKey('/srv/YARG/release') === pathKey('/srv/yarg/release')
    assert.equal(same, process.platform === 'win32')
  })
})

describe('findInstalls', () => {
  it('finds the channel folders that exist, release first', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'release'), { recursive: true })
    await mkdir(join(root, 'nightly'), { recursive: true })

    const installs = findInstalls([root], join(root, 'nightly'))

    assert.deepEqual(
      installs.map((install) => install.channel),
      ['release', 'nightly'],
    )
  })

  it('marks the configured directory active, however it is spelled', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'release'), { recursive: true })
    await mkdir(join(root, 'nightly'), { recursive: true })

    const installs = findInstalls([root], `${join(root, 'nightly')}/`)

    assert.deepEqual(
      installs.map((install) => install.active),
      [false, true],
    )
  })

  it('is all inactive when the app is pointed somewhere else entirely', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'release'), { recursive: true })

    const installs = findInstalls([root], join(root, 'somewhere-else'))

    assert.equal(installs.length, 1)
    assert.equal(installs[0]?.active, false)
  })

  it('reports the two files that decide whether a switch is worth making', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'release'), { recursive: true })
    await mkdir(join(root, 'nightly'), { recursive: true })
    await writeFile(join(root, 'release', 'songcache.bin'), 'not really a cache')
    await writeFile(join(root, 'nightly', 'currentSong.json'), '{}')

    const [release, nightly] = findInstalls([root], join(root, 'release'))

    assert.equal(release?.hasSongCache, true)
    assert.equal(release?.playedAt, null)
    assert.equal(nightly?.hasSongCache, false)
    assert.equal(typeof nightly?.playedAt, 'number')
  })

  it('lists a channel once, at the first root holding it', async () => {
    const first = await makeRoot()
    const second = await makeRoot()
    await mkdir(join(first, 'nightly'), { recursive: true })
    await mkdir(join(second, 'nightly'), { recursive: true })
    await mkdir(join(second, 'release'), { recursive: true })

    const installs = findInstalls([first, second], join(first, 'nightly'))

    assert.deepEqual(
      installs.map((install) => install.path),
      [join(second, 'release'), join(first, 'nightly')],
    )
  })
})

describe('installRoots', () => {
  it('looks beside a data directory that names a channel', () => {
    const configured = join('D:', 'games', 'yarg-data', 'nightly')

    assert.deepEqual(installRoots(configured), [
      join('D:', 'games', 'yarg-data'),
      unityPersistentDataPath(),
    ])
  })

  it('invents nothing from the parent of a folder that names no channel', () => {
    assert.deepEqual(installRoots(join('D:', 'yarg-stuff')), [unityPersistentDataPath()])
    assert.deepEqual(installRoots(''), [unityPersistentDataPath()])
  })
})
