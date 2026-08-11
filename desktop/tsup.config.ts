import { defineConfig } from 'tsup'

/**
 * Main and preload, bundled to CommonJS.
 *
 * CJS is not incidental here. A preload script cannot be ESM under
 * `sandbox: true`, and this app wants the sandbox — so the preload is CJS, and
 * main follows it so the workspace has one module system rather than two. The
 * server bundle this app spawns stays ESM; the two never share a module graph.
 *
 * `electron` is the one thing left external: it isn't on disk as a library, it
 * is injected by the runtime.
 */
export default defineConfig({
  entry: ['src/main.ts', 'src/preload.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  /*
   * Clean this build's own output and nothing else. Vite puts the popover in
   * `dist/ui`, so a blanket clean here deletes it — and the symptom is a build
   * that succeeds followed by a window that renders ERR_FILE_NOT_FOUND.
   */
  clean: ['main.js', 'main.js.map', 'preload.js', 'preload.js.map'],
  sourcemap: true,
  /*
   * `electron` must stay external, and there must be no catch-all `noExternal`
   * next to it — `noExternal` wins over `external` in tsup, so a match-all
   * pattern here bundles the *npm package* named electron (a path resolver
   * whose job is to find the binary) in place of the runtime API the main
   * process is handed. The symptom is not a build error: the app starts, `app`
   * is undefined, and the bundled resolver quietly tries to download Electron.
   *
   * Everything else is bundled anyway. tsup externalises `dependencies` and
   * `peerDependencies`, and this workspace has neither — the packaged app then
   * never has to walk a hoisted `node_modules` it doesn't ship.
   */
  external: ['electron'],
})
