/**
 * Version comparison, checked without a network or an Electron process.
 *
 * The failure worth guarding against is not that the request works — it is
 * that the comparison is one-sided. A comparator that gets `>` right and `<`
 * wrong offers every user a downgrade, once, on the day after a release; and
 * one that reads a tag it cannot parse as "equal" tells a machine two versions
 * behind that it is up to date. Neither shows up until it ships.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compareVersions, parseRelease, pickUpdate, type Release } from './update.js'

const release = (tag: string): Release => ({
  tag,
  url: `https://github.com/DevPrice/YASS/releases/tag/${tag}`,
  publishedAt: 1_700_000_000_000,
})

describe('comparing versions', () => {
  it('reads a tag with or without its v', () => {
    assert.equal(compareVersions('1.2.3', 'v1.2.3'), 0)
    assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
  })

  it('orders each part numerically rather than as text', () => {
    // The one every hand-rolled string comparison gets wrong.
    assert.equal(compareVersions('1.9.0', '1.10.0'), -1)
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1)
    assert.equal(compareVersions('2.0.0', '10.0.0'), -1)
  })

  it('weighs major over minor over patch', () => {
    assert.equal(compareVersions('1.0.0', '0.99.99'), 1)
    assert.equal(compareVersions('1.2.0', '1.1.99'), 1)
    assert.equal(compareVersions('1.1.1', '1.1.2'), -1)
  })

  it('ranks a prerelease below the release it leads to', () => {
    assert.equal(compareVersions('1.2.0-rc.1', '1.2.0'), -1)
    assert.equal(compareVersions('1.2.0', '1.2.0-rc.1'), 1)
    assert.equal(compareVersions('1.2.0-rc.1', '1.2.0-rc.2'), -1)
    // Semver §11: numeric identifiers rank below alphanumeric ones, and a
    // shorter set below a longer one that starts the same.
    assert.equal(compareVersions('1.2.0-1', '1.2.0-alpha'), -1)
    assert.equal(compareVersions('1.2.0-rc', '1.2.0-rc.1'), -1)
  })

  it('ignores build metadata, which carries no precedence', () => {
    assert.equal(compareVersions('1.2.3+abc', '1.2.3+def'), 0)
    assert.equal(compareVersions('1.2.3+abc', '1.2.3'), 0)
  })

  it('says it cannot tell rather than guessing', () => {
    assert.equal(compareVersions('1.2', '1.2.0'), null)
    assert.equal(compareVersions('1.2.0', 'nightly'), null)
    assert.equal(compareVersions('', '1.2.0'), null)
  })
})

describe('picking an update', () => {
  it('offers a newer release', () => {
    const state = pickUpdate(release('v1.2.0'), '1.1.1')

    assert.ok(state.status === 'available', `expected an update, got ${state.status}`)
    assert.equal(state.version, '1.2.0', 'the v belongs to the tag, not to what a person reads')
    assert.equal(state.url, 'https://github.com/DevPrice/YASS/releases/tag/v1.2.0')
  })

  it('offers nothing when the running version is the latest', () => {
    assert.equal(pickUpdate(release('v1.1.1'), '1.1.1').status, 'current')
  })

  it('never talks a newer build backwards', () => {
    /*
     * Every local `npm run dist` between a version bump and its tag is ahead
     * of the published release — `.github/scripts/stamp-version.mjs` only runs
     * on the runner — and so is any build from master. None of them is a
     * candidate for "updating" to something older.
     */
    assert.equal(pickUpdate(release('v1.1.1'), '1.2.0').status, 'current')
    assert.equal(pickUpdate(release('v1.1.1'), '1.1.2').status, 'current')
  })

  it('treats a prerelease of the running version as older', () => {
    assert.equal(pickUpdate(release('v1.2.0-rc.1'), '1.2.0').status, 'current')
    assert.equal(pickUpdate(release('v1.2.0'), '1.2.0-rc.1').status, 'available')
  })

  it('admits it when the tag is not a version', () => {
    const state = pickUpdate(release('latest'), '1.1.1')

    assert.ok(state.status === 'failed', `expected a refusal, got ${state.status}`)
    // Saying "up to date" here would be a lie told to a machine that may be
    // several releases behind.
    assert.match(state.message, /latest/, 'the message should quote what it could not read')
    assert.match(state.message, /1\.1\.1/, 'and what it was reading it against')
  })
})

describe('reading GitHub’s answer', () => {
  it('takes the three fields it uses', () => {
    const parsed = parseRelease({
      tag_name: 'v1.2.0',
      html_url: 'https://github.com/DevPrice/YASS/releases/tag/v1.2.0',
      published_at: '2026-01-02T03:04:05Z',
      // The other sixty, which we do not touch.
      assets: [{ name: 'YASS-1.2.0.exe' }],
      body: 'notes',
    })

    assert.deepEqual(parsed, {
      tag: 'v1.2.0',
      url: 'https://github.com/DevPrice/YASS/releases/tag/v1.2.0',
      publishedAt: Date.parse('2026-01-02T03:04:05Z'),
    })
  })

  it('survives a date it cannot read', () => {
    const parsed = parseRelease({ tag_name: 'v1.2.0', html_url: 'https://example.test', published_at: null })

    assert.equal(parsed?.publishedAt, 0)
  })

  it('rejects anything without a tag and a page', () => {
    assert.equal(parseRelease(null), null)
    assert.equal(parseRelease('v1.2.0'), null)
    assert.equal(parseRelease({ html_url: 'https://example.test' }), null)
    assert.equal(parseRelease({ tag_name: 'v1.2.0' }), null)
    // What the API returns when the repository has nothing published.
    assert.equal(parseRelease({ message: 'Not Found' }), null)
  })
})
