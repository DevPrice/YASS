/**
 * Reading YARG's own `settings.json`.
 *
 * The Genrelizer half is also covered through `readGenrelizerMode` in
 * `genrelizer.test.ts`; these are about censorship and about the one rule that
 * is not a plain default — a half-written file keeping the last reading.
 */

import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { DEFAULT_YARG_SETTINGS, readYargSettings, sameYargSettings } from './yargSettings.js'

const withSettings = async (body: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'yass-yarg-settings-'))
  await writeFile(join(dir, 'settings.json'), body, 'utf8')
  return dir
}

const CENSORING = { genrelizer: 'overgenrelize', censorMatureContent: true } as const

describe("reading YARG's settings", () => {
  it('reads censorship and the Genrelizer as YARG writes them', async () => {
    const dir = await withSettings('{"Genrelizer": 2, "CensorMatureContent": true}')
    assert.deepEqual(await readYargSettings(dir), CENSORING)
  })

  it('reads a build without the setting as not censoring', async () => {
    // Release YARG has no `CensorMatureContent` key at all.
    const dir = await withSettings('{"Genrelizer": 1, "MaxSongRating": 6}')
    assert.equal((await readYargSettings(dir)).censorMatureContent, false)
  })

  it('takes a missing file as the defaults, even with a previous reading', async () => {
    // Absent is a statement about the install, not a write in progress.
    assert.deepEqual(
      await readYargSettings(join(tmpdir(), 'yass-nonexistent-dir'), CENSORING),
      DEFAULT_YARG_SETTINGS,
    )
    assert.deepEqual(await readYargSettings(''), DEFAULT_YARG_SETTINGS)
  })

  it('keeps the previous reading when the file is caught mid-write', async () => {
    // `File.WriteAllText` truncates first. Reading that as the defaults would
    // switch censorship off for every phone in the room until the write lands.
    for (const body of ['', '{"Genrelizer": 2, "CensorMat']) {
      const dir = await withSettings(body)
      assert.deepEqual(await readYargSettings(dir, CENSORING), CENSORING)
      assert.deepEqual(await readYargSettings(dir), DEFAULT_YARG_SETTINGS)
    }
  })

  it('ignores values of the wrong type rather than guessing', async () => {
    const dir = await withSettings('{"Genrelizer": 9, "CensorMatureContent": "yes"}')
    assert.deepEqual(await readYargSettings(dir), DEFAULT_YARG_SETTINGS)
  })

  it('compares only the two values this app reads', () => {
    assert.ok(sameYargSettings(CENSORING, { ...CENSORING }))
    assert.ok(!sameYargSettings(CENSORING, { ...CENSORING, censorMatureContent: false }))
    assert.ok(!sameYargSettings(CENSORING, { ...CENSORING, genrelizer: 'off' }))
  })
})
