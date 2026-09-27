import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { applyEnvOverrides, normalizeSettings } from './settings.js'

describe('publicUrl', () => {
  it('defaults to empty, which means no public address', () => {
    assert.equal(normalizeSettings({}).publicUrl, '')
  })

  it('keeps an absolute http or https URL, trimmed', () => {
    assert.equal(
      normalizeSettings({ publicUrl: ' https://songs.example.com/ ' }).publicUrl,
      'https://songs.example.com/',
    )
    assert.equal(
      normalizeSettings({ publicUrl: 'http://203.0.113.7:8080' }).publicUrl,
      'http://203.0.113.7:8080',
    )
  })

  it('drops anything a phone should not be sent to', () => {
    // Same rule as the other fields: an unusable value falls back to the
    // default rather than failing the load.
    for (const publicUrl of [
      'songs.example.com',
      '/yass',
      'javascript:alert(1)',
      'ftp://songs.example.com',
      42,
    ]) {
      assert.equal(normalizeSettings({ publicUrl }).publicUrl, '', String(publicUrl))
    }
  })

  it('clears to empty when asked to', () => {
    assert.equal(normalizeSettings({ publicUrl: '   ' }).publicUrl, '')
  })
})

describe('YASS_PUBLIC_URL', () => {
  afterEach(() => {
    delete process.env.YASS_PUBLIC_URL
  })

  const stored = () => normalizeSettings({ publicUrl: 'https://stored.example.com' })

  it('overrides the stored value', () => {
    process.env.YASS_PUBLIC_URL = 'https://env.example.com'
    assert.equal(applyEnvOverrides(stored()).publicUrl, 'https://env.example.com')
  })

  it('leaves the stored value alone when it is not a URL', () => {
    process.env.YASS_PUBLIC_URL = 'env.example.com'
    assert.equal(applyEnvOverrides(stored()).publicUrl, 'https://stored.example.com')
  })
})
