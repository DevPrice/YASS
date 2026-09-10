/**
 * The persisted chart index, against two YARG installs.
 *
 * Every ref in that file is an absolute path inside one particular data
 * directory, and a host running both the release and the nightly build moves
 * between two of them. So the file is per-directory and says which directory it
 * describes — and both halves are load-bearing rather than tidy, because the
 * scan-derived index has no `songcache.bin` fingerprint to fall back on.
 *
 * The cache directory is redirected through the environment `appCacheDir` reads,
 * so nothing here writes to the machine's real one.
 */

import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'

import { buildChartIndex, chartIndexPath, ChartIndex } from './index.js'

/** A YARG data directory with no song cache, and one loose chart to be scanned. */
async function makeInstall(root: string, name: string, chart: string): Promise<string> {
  const dataDir = join(root, name)
  const songFolder = join(root, `${name}-songs`)

  await mkdir(join(songFolder, 'a song'), { recursive: true })
  await writeFile(join(songFolder, 'a song', 'notes.chart'), chart)

  await mkdir(dataDir, { recursive: true })
  // What the scanner reads to learn where to look — see `scan.ts`. No
  // `songcache.bin`, so the scan is the only path available.
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ SongFolders: [songFolder] }))

  return dataDir
}

describe('chart index persistence across data directories', () => {
  let root = ''

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'yass-charts-'))
    const cache = join(root, 'app-cache')

    // The three the platform arms of `appCacheDir` consult.
    process.env.LOCALAPPDATA = cache
    process.env.XDG_CACHE_HOME = cache
    process.env.HOME = cache
  })

  it("does not hand one install the other install's charts", async () => {
    const release = await makeInstall(root, 'release', 'release chart bytes')
    const nightly = await makeInstall(root, 'nightly', 'nightly chart bytes')

    const first = new ChartIndex()
    const built = await buildChartIndex(first, { yargDataDir: release })
    assert.equal(built.source, 'scan')
    assert.equal(first.size, 1)

    const second = new ChartIndex()
    await buildChartIndex(second, { yargDataDir: nightly })

    assert.equal(second.size, 1)
    assert.equal(second.toArray()[0]?.path, join(root, 'nightly-songs', 'a song'))
    assert.notEqual(second.toArray()[0]?.hash, first.toArray()[0]?.hash)
  })

  it('keeps each install indexed, so switching back is a file read', async () => {
    const release = join(root, 'release')

    // If this rebuilt from source it would find nothing: the chart is gone.
    await rm(join(root, 'release-songs'), { recursive: true, force: true })

    const index = new ChartIndex()
    await buildChartIndex(index, { yargDataDir: release })

    assert.equal(index.size, 1)
    assert.equal(index.toArray()[0]?.path, join(root, 'release-songs', 'a song'))
  })

  it('rejects an index file that describes a different directory', async () => {
    const nightly = join(root, 'nightly')
    const other = await makeInstall(root, 'dev', 'dev chart bytes')

    // A digest collision, or a cache directory somebody copied between
    // machines. The filename says one install and the contents say another.
    await copyFile(chartIndexPath(nightly), chartIndexPath(other))

    const index = new ChartIndex()
    await buildChartIndex(index, { yargDataDir: other })

    assert.equal(index.toArray()[0]?.path, join(root, 'dev-songs', 'a song'))
  })
})
