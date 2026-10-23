/**
 * The YASS server, as a child of the tray app.
 *
 * `utilityProcess.fork` rather than `child_process.fork`, for one reason that
 * matters more than every other consideration put together: it ties the
 * child's lifetime to this process at the OS level. On Windows a child does
 * not die with its parent, so a crashed Electron would otherwise strand a Node
 * process holding port 4321 — the user sees "port in use", can't find what's
 * holding it, and has no UI left to kill it with. Verified by hard-killing the
 * parent from Task Manager: the child goes with it and the port frees.
 *
 * The entry ships as `.mjs` so the extension forces module resolution. The
 * bundle is ESM only because `server/package.json` sits beside it saying so,
 * and in a packaged layout that file is gone.
 */

import { createWriteStream, existsSync, type WriteStream } from 'node:fs'
import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { app, utilityProcess, type UtilityProcess } from 'electron'

import { logDir, runtimeDir } from '@server/core/paths.js'
import { applyEnvOverrides, loadStoredSettings } from '@server/core/settings.js'
import type { ServerState, ServerStatusName } from './ipc.js'

// Named with the app's other directories rather than here, but the tray is the
// only thing that writes to it and `main.ts` reads it from this module.
export { logDir }

/** How long to wait for a successful bind before calling it a failure. */
const READY_TIMEOUT_MS = 15_000
const HEALTH_INTERVAL_MS = 200
/** A loopback health check that takes this long is not going to succeed. */
const HEALTH_TIMEOUT_MS = 1000

/** Enough stderr to recognise a failure by; not a second copy of the log. */
const RECENT_LINES = 60

/** Addresses whose loopback requests the server's host-only guard accepts. */
const LOCAL_HOSTS = new Set(['0.0.0.0', '::', '127.0.0.1', '::1', 'localhost'])

interface ResourcePaths {
  serverEntry: string
  clientDist: string
}

function bundledResources(): ResourcePaths {
  if (app.isPackaged) {
    return {
      serverEntry: join(process.resourcesPath, 'server', 'index.mjs'),
      clientDist: join(process.resourcesPath, 'client'),
    }
  }

  // `__dirname` is `desktop/dist` in a dev run.
  return {
    serverEntry: resolve(__dirname, '../../server/dist/index.js'),
    clientDist: resolve(__dirname, '../../client/dist'),
  }
}

/**
 * Where to run the server and serve the client from, for the life of this
 * process.
 *
 * The portable exe runs out of `%TEMP%\YASS`, and on a machine left hosting for
 * days that is where Storage Sense, a temp cleaner or antivirus come looking.
 * Windows refuses to delete the files this process holds open and lets them
 * take the rest: the server entry, which matters at the next restart, and the
 * client, which the running server reads per request and so 404s every guest
 * at once. The stub's own wipe on a second launch did exactly that until
 * `scripts/patch-portable-stub.mjs`. Copying both out once, here, puts them in
 * the cache directory, which nothing treats as temporary.
 *
 * Copied fresh on every launch rather than kept by version, because a local
 * `npm run dist` rebuilds without changing the version. Only the copy that
 * holds the single-instance lock gets this far, so nothing else is running
 * from the directory being replaced. If the copy fails, the bundled files are
 * still better than nothing.
 */
async function locateResources(): Promise<ResourcePaths> {
  const bundled = bundledResources()
  if (process.env.PORTABLE_EXECUTABLE_FILE === undefined) return bundled

  const root = runtimeDir()
  const staged: ResourcePaths = {
    serverEntry: join(root, 'server', 'index.mjs'),
    clientDist: join(root, 'client'),
  }

  try {
    await rm(root, { recursive: true, force: true })
    await mkdir(dirname(staged.serverEntry), { recursive: true })
    await cp(bundled.serverEntry, staged.serverEntry)
    await cp(bundled.clientDist, staged.clientDist, { recursive: true })
    return staged
  } catch {
    return bundled
  }
}

export function logFilePath(): string {
  return join(logDir(), 'server.log')
}

/** Where to point a health check when the bind address isn't a real address. */
function probeHost(host: string): string {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
}

async function healthy(host: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${probeHost(host)}:${port}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Turn the child's dying words into something worth showing a person.
 *
 * The one case worth naming is the port already being taken, because it is
 * both the most likely failure and the one with an obvious fix.
 */
function describeFailure(recent: string[], port: number): string {
  const text = recent.join('\n')

  if (text.includes('EADDRINUSE')) {
    return `Port ${port} is already in use — another copy of YASS, or something else, is holding it.`
  }
  if (text.includes('EACCES')) {
    return `Port ${port} was refused by the system. Ports below 1024 usually need elevation.`
  }

  const lastLine = [...recent].reverse().find((line) => line.trim().length > 0)
  return lastLine ? `The server stopped: ${lastLine.trim()}` : 'The server stopped unexpectedly.'
}

/**
 * A file the server cannot start without, if one has gone.
 *
 * Electron's own runtime sits beside the exe, open to whatever deletes from
 * `%TEMP%` (see `locateResources`), and it cannot be copied out: a utility
 * process is handed its ICU data by this process, from there, and dies on
 * "Invalid file descriptor to ICU data received" without it. `icudtl.dat`
 * stands for the rest of that directory.
 */
function missingFile(serverEntry: string): string | null {
  if (!existsSync(serverEntry)) return serverEntry

  const icu = join(dirname(process.execPath), 'icudtl.dat')
  if (app.isPackaged && !existsSync(icu)) return icu

  return null
}

/**
 * What to tell someone whose server cannot start for a missing file.
 *
 * A packaged copy had every file when the exe unpacked, so something has
 * deleted them since (see `locateResources`). Whoever sees this downloaded an
 * exe and has no build to run. Short because the tray tooltip repeats it, and
 * Windows cuts a tooltip off at 127 characters.
 */
function missingFileMessage(path: string): string {
  if (app.isPackaged) {
    return "YASS's files were deleted, likely by antivirus or a temp cleaner. Quit YASS from the tray and open it again."
  }

  return `The server bundle is missing (${path}). Run \`npm run build\`.`
}

export class ServerChild {
  #child: UtilityProcess | null = null
  #status: ServerStatusName = 'stopped'
  #message: string | null = null
  #host: string | null = null
  #port: number | null = null

  #log: WriteStream | null = null
  #recent: string[] = []
  /** Set while a deliberate stop is in flight, so `exit` isn't read as a crash. */
  #stopping = false
  /** Settled on the first start; a restart must not copy from a cleared `%TEMP%`. */
  #resources: Promise<ResourcePaths> | null = null
  #listeners = new Set<() => void>()

  get state(): ServerState {
    return {
      status: this.#status,
      message: this.#message,
      host: this.#host,
      port: this.#port,
    }
  }

  /**
   * The base URL for the server's own API, or null when there isn't one.
   *
   * Null when the server is down, and null when it is bound to one specific
   * non-loopback address: the tray's request would then arrive from a LAN
   * address, and the host-only guard would — correctly — 404 it.
   */
  get apiOrigin(): string | null {
    if (this.#status !== 'running' || this.#port === null || this.#host === null) return null
    if (!LOCAL_HOSTS.has(this.#host)) return null

    return `http://${probeHost(this.#host)}:${this.#port}`
  }

  /** The URL the host can open, whatever the server is bound to. */
  get localUrl(): string | null {
    if (this.#port === null || this.#host === null) return null
    return `http://${probeHost(this.#host)}:${this.#port}`
  }

  /** Whether the bind address makes this reachable from other machines. */
  get isLanBound(): boolean {
    return this.#host === '0.0.0.0' || this.#host === '::'
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #publish(): void {
    for (const listener of this.#listeners) listener()
  }

  #set(status: ServerStatusName, message: string | null = null): void {
    this.#status = status
    this.#message = message
    this.#publish()
  }

  /**
   * Start a fresh log file, keeping the previous run's.
   *
   * A packaged app has nowhere to print, so a server that fails to bind would
   * otherwise leave no evidence at all. The `.prev` copy exists so that
   * pressing "Restart server" — the obvious thing to do after a failure —
   * doesn't wipe the record of what went wrong.
   */
  async #openLog(): Promise<void> {
    const path = logFilePath()
    await mkdir(logDir(), { recursive: true })

    if (existsSync(path)) {
      try {
        await rm(`${path}.prev`, { force: true })
        await rename(path, `${path}.prev`)
      } catch {
        // Rotation is a convenience; failing it must not stop the server.
      }
    }

    this.#log = createWriteStream(path, { flags: 'a' })
  }

  #append(chunk: string): void {
    this.#log?.write(chunk)
    if (!app.isPackaged) process.stdout.write(chunk)

    for (const line of chunk.split(/\r?\n/)) {
      if (line.length === 0) continue
      this.#recent.push(line)
    }
    if (this.#recent.length > RECENT_LINES) {
      this.#recent = this.#recent.slice(-RECENT_LINES)
    }
  }

  async start(): Promise<void> {
    if (this.#child) return

    // The settings file is authoritative. Deliberately no `YASS_*` overrides
    // are synthesised from it: the child reads the same file, and inventing
    // overrides here would make every field show as env-forced in the popover
    // and would be a lie about where the values came from.
    const settings = applyEnvOverrides(await loadStoredSettings())
    const { serverEntry, clientDist } = await (this.#resources ??= locateResources())

    this.#host = settings.host
    this.#port = settings.port
    this.#recent = []
    this.#stopping = false
    this.#set('starting')

    await this.#openLog()

    const missing = missingFile(serverEntry)
    if (missing) {
      this.#append(`\n[tray] missing: ${missing}\n`)
      this.#log?.end()
      this.#log = null
      this.#set('failed', missingFileMessage(missing))
      return
    }

    this.#append(`\n[tray] starting ${serverEntry}\n`)

    const child = utilityProcess.fork(serverEntry, [], {
      serviceName: 'yass-server',
      stdio: 'pipe',
      env: { ...process.env, YASS_CLIENT_DIST: clientDist },
    })

    this.#child = child

    child.stdout?.on('data', (chunk: Buffer) => this.#append(chunk.toString()))
    // Where an EADDRINUSE arrives.
    child.stderr?.on('data', (chunk: Buffer) => this.#append(chunk.toString()))

    child.on('exit', (code) => {
      this.#child = null
      // Last thing into the file: an exit code is the difference between "it
      // was told to stop" and "it fell over" when reading this back later.
      this.#log?.write(`[tray] server exited with code ${code}\n`)
      this.#log?.end()
      this.#log = null

      if (this.#stopping) {
        this.#set('stopped')
        return
      }

      this.#set('failed', describeFailure(this.#recent, settings.port))
    })

    await this.#waitUntilReady(settings.host, settings.port)
  }

  /**
   * Poll `/api/health` until it answers, the child dies, or time runs out.
   *
   * Polling rather than parsing stdout for a "listening" line: the HTTP
   * response is the actual thing being waited for, and it stays true whatever
   * the server's console output does next.
   */
  async #waitUntilReady(host: string, port: number): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS

    while (Date.now() < deadline) {
      // The child having exited already set `failed` with a real message.
      if (!this.#child) return

      if (await healthy(host, port)) {
        this.#set('running')
        return
      }

      await new Promise((done) => setTimeout(done, HEALTH_INTERVAL_MS))
    }

    this.#set('failed', `The server did not respond on ${probeHost(host)}:${port}.`)
  }

  /**
   * Stop the child, hard.
   *
   * A graceful stop is not available on Windows anyway — a parent killing a
   * child uses `TerminateProcess`, and the server's `SIGTERM` handler never
   * runs. It costs nothing here: the only file the server writes is
   * `settings.json`, through a temp-and-rename that the `PUT` handler awaits,
   * and every connected browser is on an `EventSource` that reconnects itself.
   */
  async stop(): Promise<void> {
    const child = this.#child
    if (!child) {
      this.#set('stopped')
      return
    }

    this.#stopping = true

    await new Promise<void>((done) => {
      const timer = setTimeout(done, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        done()
      })
      child.kill()
    })

    this.#child = null
    this.#set('stopped')
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }
}
