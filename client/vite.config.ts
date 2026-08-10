import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The server owns the single production port; in dev we proxy /api to it so the
// client never needs to know an absolute origin. That keeps every request
// relative, which is what makes the reverse-proxy setup work unchanged.
const API_TARGET = process.env.YASS_API_TARGET ?? 'http://127.0.0.1:4321'

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
