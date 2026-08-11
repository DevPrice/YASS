/**
 * YASS server entry point.
 *
 * One process, one port: the JSON API under `/api` and the built client
 * everywhere else. That keeps the reverse-proxy configuration to a single
 * upstream, and makes the eventual tray executable a single thing to launch.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { createApiRoutes } from './api/routes.js'
import { lanAddresses } from './core/net.js'
import { settingsFilePath } from './core/paths.js'
import { AppState } from './state.js'
import { serveClient } from './static.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Locate the built client.
 *
 * `dist/index.js` (built) and `src/index.ts` (tsx) sit at different depths, so
 * try both rather than assuming one layout.
 */
function findClientDist(): string | null {
  const candidates = [
    process.env.YASS_CLIENT_DIST,
    resolve(here, '../../client/dist'),
    resolve(here, '../../../client/dist'),
  ].filter((path): path is string => Boolean(path))

  return candidates.find((path) => existsSync(join(path, 'index.html'))) ?? null
}

async function main(): Promise<void> {
  const state = await AppState.create()
  const { host, port } = state.settings

  const app = new Hono()

  // The binding is fixed for the life of the process — settings saved after
  // this point are what `/api/status` compares against to say "restart me".
  app.route('/api', createApiRoutes(state, { host, port }))

  const clientDist = findClientDist()
  if (clientDist) {
    app.use('/*', serveClient(resolve(clientDist)))
  } else {
    app.get('/', (c) =>
      c.text(
        'YASS API is running, but the client has not been built.\n' +
          'Run `npm run dev` for the Vite dev server, or `npm run build` to bundle it.\n',
      ),
    )
  }

  const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`\n  YASS  →  http://localhost:${info.port}`)

    if (host === '0.0.0.0') {
      for (const address of lanAddresses(info.port)) {
        console.log(
          `         →  ${address.url}  (${address.name}${address.virtual ? ', virtual' : ''})`,
        )
      }
    }

    const { settings, status } = state.settingsView
    // Configuration is host-only, and a headless run has no tray to edit it
    // from, so make the file easy to find rather than sending the user looking.
    console.log(`\n  Settings file : ${settingsFilePath()}`)
    console.log(`  YARG data dir : ${settings.yargDataDir}${status.yargDataDirExists ? '' : '  [not found]'}`)
    console.log(
      `  Song list     : ${settings.songListCsvPath || '(not configured)'}${
        settings.songListCsvPath && !status.songListCsvExists ? '  [not found]' : ''
      }`,
    )
    console.log(`  Songs loaded  : ${state.library.meta.count}`)

    for (const warning of state.library.meta.warnings) {
      console.warn(`  ! ${warning}`)
    }
    console.log()
  })

  /*
   * Say why the bind failed, in one line.
   *
   * Without this, `EADDRINUSE` arrives as an unhandled `error` event and exits
   * with a stack trace. That is readable enough in a terminal, but the tray
   * reads this stream out of a log file to tell the user what went wrong — and
   * "port 4321 is already in use" is the answer, not the call site.
   */
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[yass] EADDRINUSE: port ${port} is already in use on ${host}`)
    } else {
      console.error('[yass] server error:', err)
    }
    process.exit(1)
  })

  const shutdown = () => {
    state.stop()
    server.close(() => process.exit(0))
    // Don't let a hung connection block exit — the tray app will rely on this.
    setTimeout(() => process.exit(0), 2000).unref()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[yass] failed to start:', err)
  process.exit(1)
})
