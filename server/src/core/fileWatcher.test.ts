/**
 * File watching.
 *
 * These run against a real temp directory and a real `fs.watch`, because the
 * whole value of this class is in how the platform actually behaves — a mocked
 * watcher would only assert that we can call our own callback.
 *
 * That makes them timing-dependent, so nothing here asserts on a delay: each
 * test waits for a condition with a generous ceiling and fails on timeout. The
 * settle period is set to a few milliseconds so the waits stay short.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { FileWatcher } from './fileWatcher.js'

/** Long enough to absorb a slow CI filesystem, short enough to fail promptly. */
const TIMEOUT_MS = 4000
const SETTLE_MS = 20

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll a predicate until it holds, or fail with `what` in the message. */
async function waitFor(what: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(10)
  }

  assert.fail(`timed out waiting for ${what}`)
}

describe('FileWatcher', () => {
  let dir = ''
  let path = ''
  let watcher: FileWatcher | null = null

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yass-watch-'))
    path = join(dir, 'currentSong.json')
  })

  afterEach(async () => {
    watcher?.stop()
    watcher = null
    await rm(dir, { recursive: true, force: true })
  })

  it('reports a file that appears after the watch starts', async () => {
    let changes = 0

    watcher = new FileWatcher({
      getPath: () => path,
      settleMs: SETTLE_MS,
      onChange: async () => {
        changes++
      },
    })

    // Deliberately armed against a path that does not exist yet: this is the
    // ordinary case of YASS starting before YARG does.
    await watcher.start()
    await writeFile(path, '{"Name":"Song"}', 'utf8')

    await waitFor('the new file to be reported', () => changes === 1)
  })

  it('reports a rewrite in place, not just a replacement', async () => {
    await writeFile(path, '{"Name":"First"}', 'utf8')

    let seen = ''
    watcher = new FileWatcher({
      getPath: () => path,
      settleMs: SETTLE_MS,
      onChange: async () => {
        seen = 'rewritten'
      },
    })

    await watcher.start()

    // Truncate-then-write, which is what YARG does to `currentSong.json` — no
    // temp file, no rename, so the path keeps its identity throughout.
    await writeFile(path, '', 'utf8')
    await writeFile(path, '{"Name":"Second"}', 'utf8')

    await waitFor('the rewrite to be reported', () => seen === 'rewritten')
  })

  it('ignores writes to its siblings', async () => {
    await writeFile(path, '{"Name":"Song"}', 'utf8')

    let changes = 0
    watcher = new FileWatcher({
      getPath: () => path,
      settleMs: SETTLE_MS,
      onChange: async () => {
        changes++
      },
    })

    await watcher.start()

    // `songcache.bin` is a real sibling in the YARG data directory, and both
    // watchers sit on that one directory.
    await writeFile(join(dir, 'songcache.bin'), 'not ours', 'utf8')
    await sleep(SETTLE_MS * 10)

    assert.equal(changes, 0)
  })

  describe('when the file disappears', () => {
    it('stays quiet by default, so a mid-rescan cache cannot blank the library', async () => {
      await writeFile(path, 'library', 'utf8')

      let changes = 0
      watcher = new FileWatcher({
        getPath: () => path,
        settleMs: SETTLE_MS,
        onChange: async () => {
          changes++
        },
      })

      await watcher.start()
      await unlink(path)
      await sleep(SETTLE_MS * 10)

      assert.equal(changes, 0)
    })

    it('reports it when asked, so the banner can go back to nothing playing', async () => {
      await writeFile(path, '{"Name":"Song"}', 'utf8')

      let changes = 0
      watcher = new FileWatcher({
        getPath: () => path,
        settleMs: SETTLE_MS,
        notifyOnMissing: true,
        onChange: async () => {
          changes++
        },
      })

      await watcher.start()
      await unlink(path)

      await waitFor('the deletion to be reported', () => changes === 1)
    })
  })

  it('stops reporting once stopped', async () => {
    let changes = 0
    watcher = new FileWatcher({
      getPath: () => path,
      settleMs: SETTLE_MS,
      onChange: async () => {
        changes++
      },
    })

    await watcher.start()
    watcher.stop()

    await writeFile(path, '{"Name":"Song"}', 'utf8')
    await sleep(SETTLE_MS * 10)

    assert.equal(changes, 0)
  })
})
