/**
 * Now-playing delivery.
 *
 * The parsing of `currentSong.json` is covered by the fixture tests in
 * `core.test.ts`. What is tested here is the mechanism around it: that a write
 * reaches subscribers because the file was *watched*, not because a poll came
 * round. Every test sets the backstop far beyond its own timeout, so anything
 * that arrives can only have come from the watch.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import type { NowPlaying } from '@shared/types.js'
import { NowPlayingWatcher } from './nowPlaying.js'

const TIMEOUT_MS = 4000

/** Longer than any test here waits, so only the watch can deliver. */
const NO_BACKSTOP_MS = 60_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(what: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(10)
  }

  assert.fail(`timed out waiting for ${what}`)
}

const song = (name: string) => JSON.stringify({ Name: name, Artist: 'Some Artist' })

describe('NowPlayingWatcher', () => {
  let dir = ''
  let path = ''
  let watcher: NowPlayingWatcher | null = null
  let states: NowPlaying[] = []

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yass-now-'))
    path = join(dir, 'currentSong.json')
    states = []
  })

  afterEach(async () => {
    watcher?.stop()
    watcher = null
    await rm(dir, { recursive: true, force: true })
  })

  /** A started watcher over the temp directory, recording everything published. */
  async function start(dataDir: () => string = () => dir): Promise<NowPlayingWatcher> {
    const created = new NowPlayingWatcher({
      getDataDir: dataDir,
      getPollIntervalMs: () => NO_BACKSTOP_MS,
      resolveLibraryId: () => null,
    })

    created.subscribe((state) => states.push(state))
    await created.start()

    watcher = created
    return created
  }

  it('publishes a song written after it started, without waiting for a poll', async () => {
    await start()
    await writeFile(path, song('Through the Fire and Flames'), 'utf8')

    await waitFor('the song to be published', () => states.at(-1)?.playing === true)
    assert.equal(states.at(-1)?.song?.name, 'Through the Fire and Flames')
  })

  it('publishes the next song when the file is rewritten in place', async () => {
    await start()

    await writeFile(path, song('First'), 'utf8')
    await waitFor('the first song', () => states.at(-1)?.song?.name === 'First')

    // No rename: YARG truncates and writes over the top of the same path.
    await writeFile(path, song('Second'), 'utf8')
    await waitFor('the second song', () => states.at(-1)?.song?.name === 'Second')
  })

  it('goes back to nothing playing when the file is blanked', async () => {
    await start()

    await writeFile(path, song('Cliffs of Dover'), 'utf8')
    await waitFor('the song', () => states.at(-1)?.playing === true)

    // A zero-byte file is YARG's way of saying "in menus".
    await writeFile(path, '', 'utf8')
    await waitFor('nothing playing', () => states.at(-1)?.playing === false)
  })

  it('goes back to nothing playing when the file is deleted', async () => {
    await writeFile(path, song('Jordan'), 'utf8')
    await start()

    await waitFor('the song', () => states.at(-1)?.playing === true)

    await unlink(path)
    await waitFor('nothing playing', () => states.at(-1)?.playing === false)
  })

  it('publishes nothing at all while the song is unchanged', async () => {
    await start()

    await writeFile(path, song('Green Grass and High Tides'), 'utf8')
    await waitFor('the song', () => states.at(-1)?.playing === true)

    const published = states.length

    // Same bytes, new write: subscribers fan out to every connected browser, so
    // a re-publish here is a message to every phone in the room saying nothing.
    await writeFile(path, song('Green Grass and High Tides'), 'utf8')
    await sleep(500)

    assert.equal(states.length, published)
  })

  it('follows the data directory when settings change', async () => {
    let current = ''

    // Starts unconfigured, which must not become a watch on the process's cwd.
    const created = await start(() => current)

    const moved = await mkdtemp(join(tmpdir(), 'yass-now-moved-'))
    try {
      await writeFile(join(moved, 'currentSong.json'), song('Panama'), 'utf8')
      current = moved
      await created.rearm()

      await waitFor('the song in the new directory', () => states.at(-1)?.song?.name === 'Panama')
    } finally {
      await rm(moved, { recursive: true, force: true })
    }
  })

  it('stops publishing once stopped', async () => {
    const created = await start()
    created.stop()

    await writeFile(path, song('Hangar 18'), 'utf8')
    await sleep(500)

    assert.deepEqual(states, [])
  })
})
