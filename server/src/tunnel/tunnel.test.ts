import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Hono } from 'hono'

import { isLocalRequest, type TunnelBindings } from '../api/local.js'
import { applyEnvOverrides, normalizeSettings } from '../core/settings.js'
import { KEY_COOKIE, tunnelGate } from './gate.js'
import { newTunnelKey, shareUrl } from './tunnel.js'

const KEY = 'test-key-0123456789'

/** The app as `index.ts` builds it: the gate first, then everything else. */
function app(): Hono {
  const hono = new Hono()
  hono.use('*', tunnelGate(() => KEY))
  hono.get('/api/songs', (c) => c.json({ ok: true }))
  hono.get('/api/local', (c) => c.json({ local: isLocalRequest(c) }))
  hono.post('/api/setlist', (c) => c.json({ ok: true }))
  hono.get('/', (c) => c.text('client'))
  return hono
}

/** A request as the tunnel's listener delivers it. */
const tunnel: TunnelBindings = { viaTunnel: true }
/** A request as the LAN listener delivers it — from a loopback peer, here. */
const lan = { incoming: { socket: { remoteAddress: '127.0.0.1' } } }

describe('tunnel gate', () => {
  it('leaves LAN requests alone', async () => {
    const response = await app().request('/api/songs', {}, lan)
    assert.equal(response.status, 200)
  })

  it('refuses tunnel requests without a key, as a bare 404', async () => {
    for (const path of ['/', '/api/songs', '/index.html']) {
      const response = await app().request(path, {}, tunnel)
      assert.equal(response.status, 404, path)
    }
  })

  it('refuses a wrong key, in the query or the cookie', async () => {
    const byQuery = await app().request('/?key=nope', {}, tunnel)
    assert.equal(byQuery.status, 404)

    const byCookie = await app().request(
      '/api/songs',
      { headers: { Cookie: `${KEY_COOKIE}=nope` } },
      tunnel,
    )
    assert.equal(byCookie.status, 404)
  })

  it('trades the key in the address for a cookie, and drops it from the address', async () => {
    const response = await app().request(`/?key=${KEY}&song=abc`, {}, tunnel)

    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), '/?song=abc')

    const cookie = response.headers.get('set-cookie') ?? ''
    assert.match(cookie, new RegExp(`^${KEY_COOKIE}=${KEY};`))
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /Secure/)
    assert.match(cookie, /SameSite=Lax/)
  })

  it('lets the cookie through', async () => {
    const response = await app().request(
      '/api/songs',
      { headers: { Cookie: `${KEY_COOKIE}=${KEY}` } },
      tunnel,
    )
    assert.equal(response.status, 200)
  })

  it('answers a keyed non-GET without redirecting it', async () => {
    const response = await app().request(`/api/setlist?key=${KEY}`, { method: 'POST' }, tunnel)
    assert.equal(response.status, 200)
  })

  it('never counts a tunnel request as the host, even from loopback', async () => {
    const response = await app().request(
      '/api/local',
      { headers: { Cookie: `${KEY_COOKIE}=${KEY}` } },
      { ...lan, ...tunnel },
    )
    assert.deepEqual(await response.json(), { local: false })

    const direct = await app().request('/api/local', {}, lan)
    assert.deepEqual(await direct.json(), { local: true })
  })
})

describe('tunnel keys and addresses', () => {
  it('makes a different, URL-safe key every time', () => {
    const a = newTunnelKey()
    const b = newTunnelKey()
    assert.notEqual(a, b)
    assert.match(a, /^[A-Za-z0-9_-]{32}$/)
  })

  it('puts the key on the address as a query', () => {
    assert.equal(
      shareUrl('https://some-words-here.trycloudflare.com', 'abc'),
      'https://some-words-here.trycloudflare.com/?key=abc',
    )
  })
})

describe('tunnel setting', () => {
  it('is off unless the file says true', () => {
    assert.equal(normalizeSettings({}).tunnel, false)
    assert.equal(normalizeSettings({ tunnel: 'yes' }).tunnel, false)
    assert.equal(normalizeSettings({ tunnel: true }).tunnel, true)
  })

  it('can be forced by YASS_TUNNEL, and ignores a value it cannot read', () => {
    const previous = process.env.YASS_TUNNEL
    try {
      process.env.YASS_TUNNEL = 'on'
      assert.equal(applyEnvOverrides(normalizeSettings({})).tunnel, true)

      process.env.YASS_TUNNEL = '0'
      assert.equal(applyEnvOverrides(normalizeSettings({ tunnel: true })).tunnel, false)

      process.env.YASS_TUNNEL = 'maybe'
      assert.equal(applyEnvOverrides(normalizeSettings({ tunnel: true })).tunnel, true)
    } finally {
      if (previous === undefined) delete process.env.YASS_TUNNEL
      else process.env.YASS_TUNNEL = previous
    }
  })
})
