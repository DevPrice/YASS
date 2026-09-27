/**
 * A Cloudflare quick tunnel to this server, and the key that guards it.
 *
 * The LAN address stops at the edge of the room's Wi-Fi. A quick tunnel —
 * `cloudflared tunnel --url …`, no Cloudflare account — gives the server a
 * public `https://<words>.trycloudflare.com` address, which is what lets a
 * guest on mobile data, or a network with client isolation, reach it at all.
 *
 * ## Public means the key is the whole defence
 *
 * A trycloudflare hostname is unguessable-ish, but it is not a secret: it is
 * printed in logs and resolvable by anyone who sees it once. So the address
 * handed out carries `?key=…`, and `gate.ts` refuses every tunnel request that
 * doesn't present it. The key is made fresh for every run of the server and
 * every time the tunnel is switched on — the quick-tunnel hostname changes on
 * each start anyway, so a stable key would buy nothing but a longer life for a
 * leaked one. Switching the tunnel off and on is how the host revokes a link.
 *
 * ## cloudflared connects to its own listener
 *
 * Not to the LAN port. `index.ts` opens a second, loopback-only listener on an
 * ephemeral port for cloudflared to point at, and everything arriving there is
 * marked as tunnel traffic before the app sees it. Deciding by *which socket*
 * rather than by proxy headers is what makes the gate fail closed: a header
 * can be missing or forged, and the socket cannot.
 *
 * ## What quick tunnels cannot do
 *
 * Cloudflare documents two limits: no Server-Sent Events, and 200 requests in
 * flight. The first is why `/api/events` declines over the tunnel and the
 * client polls instead; the second is a party of phones scrolling covers, and
 * surfaces as the odd missing thumbnail rather than an outage.
 *
 * ## "Connected" is not "reachable"
 *
 * cloudflared reports its connection a few seconds before the hostname exists
 * in DNS. A phone that scans the code in that window gets NXDOMAIN — and the
 * router it asked caches that answer, so the address stays dead on that
 * network long after it came alive. So the code is not shown until Cloudflare's
 * own resolver answers for the name, asked directly rather than through the
 * host's resolver, which would cache the same miss for everyone behind it.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { Resolver } from 'node:dns/promises'

import type { TunnelSummary } from '@shared/types.js'
import {
  canFetchCloudflared,
  cloudflaredDownloadBytes,
  resolveCloudflared,
} from './cloudflared.js'

/** Where the tunnel is. `missing` is enabled with no cloudflared to run. */
type Phase = 'off' | 'missing' | 'starting' | 'running' | 'failed'

/** cloudflared prints the address it was given; this is how we learn it. */
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

/** The address exists before the edge routes to it; this line is when it does. */
const CONNECTED = /Registered tunnel connection/

/** Enough of cloudflared's last words to say why it stopped. */
const RECENT_LINES = 20

/** Cloudflare's resolvers, which learn a trycloudflare name first. */
const DNS_SERVERS = ['1.1.1.1', '1.0.0.1']
/**
 * How long to wait for the name before showing it anyway. A network that
 * blocks outside DNS would otherwise never get a code at all.
 */
const DNS_WAIT_MS = 30_000

/** Resolve `host` through Cloudflare until it answers, the deadline, or `wanted()` fails. */
async function waitForDns(host: string, wanted: () => boolean): Promise<boolean> {
  const resolver = new Resolver({ timeout: 2000, tries: 1 })
  resolver.setServers(DNS_SERVERS)

  const deadline = Date.now() + DNS_WAIT_MS
  while (Date.now() < deadline && wanted()) {
    try {
      if ((await resolver.resolve4(host)).length > 0) return true
    } catch {
      // NXDOMAIN until the record lands, or no route to 1.1.1.1 at all.
    }
    await new Promise((done) => setTimeout(done, 1000))
  }
  return false
}

/** Backoff between restarts, so a network with no route out isn't hammered. */
const RETRY_MIN_MS = 5_000
const RETRY_MAX_MS = 60_000

/** 192 bits, URL-safe — a guess per request is not a strategy. */
export function newTunnelKey(): string {
  return randomBytes(24).toString('base64url')
}

/** `https://x.trycloudflare.com` → the same with `/?key=…` for a guest. */
export function shareUrl(publicUrl: string, key: string): string {
  const url = new URL(publicUrl)
  url.searchParams.set('key', key)
  return url.toString()
}

/**
 * cloudflared's stderr, reduced to what is worth a line in the server log.
 *
 * It logs every connection, every edge location and every retry at `INF`, which
 * is a lot of noise in a file the host reads when something is wrong.
 */
function worthLogging(line: string): boolean {
  return / (ERR|WRN) /.test(line) || QUICK_TUNNEL_URL.test(line)
}

export class Tunnel {
  /** The loopback listener cloudflared forwards to, once `index.ts` has one. */
  #origin: string | null = null
  #enabled = false
  #key = newTunnelKey()

  #child: ChildProcess | null = null
  #phase: Phase = 'off'
  #publicUrl: string | null = null
  #message: string | null = null
  #recent: string[] = []
  /** Set once cloudflared is connected and the DNS wait has begun. */
  #confirming = false

  #retryTimer: NodeJS.Timeout | null = null
  #attempt = 0
  /** Serialises `#reconcile`, which awaits a filesystem lookup mid-way. */
  #reconciling: Promise<void> = Promise.resolve()

  /** The key tunnel requests must present. Read per request: it rotates. */
  get key(): string {
    return this.#key
  }

  /** Called once the tunnel listener is bound. */
  attach(origin: string): void {
    this.#origin = origin
    this.#schedule()
  }

  /**
   * Follow the `tunnel` setting.
   *
   * Turning it on mints a new key, which is what makes off-and-on the way to
   * revoke a link that has travelled further than intended.
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.#enabled) return

    this.#enabled = enabled
    if (enabled) this.#key = newTunnelKey()
    this.#attempt = 0
    this.#schedule()
  }

  /** Try again now — after cloudflared has been installed, say. */
  retry(): void {
    this.#attempt = 0
    this.#schedule()
  }

  stop(): void {
    this.#enabled = false
    this.#clearRetry()
    this.#kill()
    this.#phase = 'off'
  }

  /** What the tray shows. The URL carries the key, so this is host-only. */
  async summary(): Promise<TunnelSummary> {
    const cloudflared = (await resolveCloudflared()) !== null

    return {
      enabled: this.#enabled,
      cloudflared,
      canFetchCloudflared: canFetchCloudflared(),
      downloadBytes: cloudflaredDownloadBytes(),
      phase: this.#phase,
      url:
        this.#phase === 'running' && this.#publicUrl !== null
          ? shareUrl(this.#publicUrl, this.#key)
          : null,
      message: this.#message,
    }
  }

  #schedule(): void {
    this.#reconciling = this.#reconciling.then(() => this.#reconcile())
  }

  async #reconcile(): Promise<void> {
    this.#clearRetry()

    if (!this.#enabled || this.#origin === null) {
      this.#kill()
      this.#phase = 'off'
      this.#message = null
      return
    }

    if (this.#child !== null) return

    const cloudflared = await resolveCloudflared()
    if (cloudflared === null) {
      this.#phase = 'missing'
      this.#message = null
      return
    }

    this.#start(cloudflared.path, this.#origin)
  }

  #start(path: string, origin: string): void {
    this.#phase = 'starting'
    this.#publicUrl = null
    this.#message = null
    this.#recent = []
    this.#confirming = false

    console.log(`[tunnel] starting cloudflared (${path}) → ${origin}`)

    /*
     * `--no-autoupdate` because cloudflared would otherwise replace its own
     * executable — the pinned, verified one in our bin directory — with
     * whatever is newest. `windowsHide` because this is a console program and a
     * tray app should not flash a console window at the host.
     */
    const child = spawn(path, ['tunnel', '--no-autoupdate', '--url', origin], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.#child = child

    let buffered = ''
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString('utf8')
      const lines = buffered.split(/\r?\n/)
      buffered = lines.pop() ?? ''
      for (const line of lines) this.#line(child, line)
    }

    // cloudflared logs to stderr, but nothing is lost by reading both.
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('error', (error) => {
      // Spawn failures (a binary that won't execute) arrive here, not at `exit`.
      this.#exited(child, `cloudflared could not start: ${error.message}`)
    })

    child.on('exit', (code) => {
      this.#exited(child, this.#describeExit(code))
    })
  }

  #line(child: ChildProcess, line: string): void {
    if (child !== this.#child || line.trim().length === 0) return

    this.#recent.push(line)
    if (this.#recent.length > RECENT_LINES) this.#recent.shift()
    if (worthLogging(line)) console.log(`[tunnel] ${line.trim()}`)

    const url = QUICK_TUNNEL_URL.exec(line)
    if (url !== null && this.#publicUrl === null) {
      this.#publicUrl = url[0]
    }

    // cloudflared opens four connections and says so four times; one wait.
    if (CONNECTED.test(line) && this.#publicUrl !== null && !this.#confirming) {
      this.#confirming = true
      const publicUrl = this.#publicUrl
      const current = () => child === this.#child

      void waitForDns(new URL(publicUrl).host, current).then((resolved) => {
        if (!current()) return
        this.#phase = 'running'
        this.#attempt = 0
        console.log(
          `[tunnel] ready at ${publicUrl}${resolved ? '' : ' (not yet confirmed in DNS)'}`,
        )
      })
    }
  }

  #describeExit(code: number | null): string {
    const failure = [...this.#recent].reverse().find((line) => / ERR /.test(line))
    if (failure) return `cloudflared stopped: ${failure.replace(/^.*? ERR /, '').trim()}`
    return `cloudflared stopped (exit code ${code ?? 'unknown'}).`
  }

  #exited(child: ChildProcess, message: string): void {
    // A stale child — one this object already killed or replaced — says nothing.
    if (child !== this.#child) return

    this.#child = null
    this.#publicUrl = null

    if (!this.#enabled) {
      this.#phase = 'off'
      return
    }

    console.error(`[tunnel] ${message}`)
    this.#phase = 'failed'
    this.#message = message

    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.#attempt)
    this.#attempt++
    this.#retryTimer = setTimeout(() => this.#schedule(), delay)
    this.#retryTimer.unref()
  }

  #kill(): void {
    const child = this.#child
    if (child === null) return

    this.#child = null
    this.#publicUrl = null
    child.kill()
  }

  #clearRetry(): void {
    if (this.#retryTimer === null) return
    clearTimeout(this.#retryTimer)
    this.#retryTimer = null
  }
}
