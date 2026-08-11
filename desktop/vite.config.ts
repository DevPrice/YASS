import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The settings popover.
 *
 * A separate Vite root from `client/`, and deliberately not a route inside it:
 * the client is the thing a room full of guests is browsing, and configuration
 * — absolute paths, the bind address, a quit button — has no business being
 * one URL away from them.
 */
export default defineConfig({
  root: 'ui',
  /*
   * Required. The popover is loaded over `file://`, where the default absolute
   * base would resolve `/assets/index-*.js` against the filesystem root and
   * render a blank window.
   */
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    // 5173 belongs to the web client; the two are routinely run together.
    port: 5174,
    strictPort: true,
    fs: {
      // The design tokens live in the client workspace, above this root.
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    sourcemap: true,
  },
})
