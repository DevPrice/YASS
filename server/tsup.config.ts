import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle everything so `dist/index.js` can later be wrapped in a single
  // executable (Node SEA) or dropped in as a Tauri/Electron sidecar without
  // dragging node_modules along.
  noExternal: [/.*/],
})
