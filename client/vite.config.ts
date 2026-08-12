import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Where YASS keeps `settings.json`, which is the file that decides the port.
 *
 * Duplicated from `server/src/core/paths.ts` rather than imported: this config
 * is bundled by esbuild before any workspace resolution exists, and one
 * platform switch is a cheaper thing to keep in step than a cross-workspace
 * build dependency. If that file's `appConfigDir` ever moves, this moves with
 * it — nothing else here reads the settings.
 */
function appConfigDir(): string {
  const home = homedir()

  switch (process.platform) {
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'yass')
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'yass')
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'yass')
  }
}

/** The configured port, or null when there is no settings file to read one from. */
function storedPort(): number | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(appConfigDir(), 'settings.json'), 'utf8'))
    const port = (raw as { port?: unknown }).port

    return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536
      ? port
      : null
  } catch {
    // No settings file yet, or an unreadable one. Both mean "use the default",
    // which is what a fresh clone with no server ever started gets.
    return null
  }
}

/**
 * The server owns the single production port; in dev we proxy /api to it so the
 * client never needs to know an absolute origin. That keeps every request
 * relative, which is what makes the reverse-proxy setup work unchanged.
 *
 * **Read out of the settings file rather than hardcoded**, because the port is
 * configurable and the tray writes it — the moment anybody moves off 4321,
 * `npm run dev` proxies to a port with nothing on it, and Vite reports that as
 * `500 Internal Server Error` on `/api/songs`. Which is a true statement about
 * the proxy and a completely misleading one about the server, since the server
 * is up and serving perfectly well one port over.
 *
 * Resolution order is the server's own: `YASS_API_TARGET` for a server that is
 * not on this machine at all, then `YASS_PORT`, then the settings file, then
 * the same default `server/src/core/settings.ts` falls back to.
 */
const API_TARGET =
  process.env.YASS_API_TARGET ??
  `http://127.0.0.1:${process.env.YASS_PORT ?? storedPort() ?? 4321}`

// Said out loud at startup, because a proxy target is invisible until it is
// wrong, and this is the line that turns "500 on every request" into a
// one-glance diagnosis.
console.log(`  proxying /api → ${API_TARGET}\n`)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
      // The OpenSource submodule: YARG's own registry of song-source ids,
      // display names and icons. Aliased so the import path says what it is
      // instead of counting `../`s out of the client workspace.
      '@opensource': fileURLToPath(new URL('../vendor/opensource', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: {
      // The submodule lives above the client workspace root, so dev has to be
      // told it's allowed to serve from there. Build doesn't care.
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // SSE needs the connection held open and unbuffered.
        ws: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
})
