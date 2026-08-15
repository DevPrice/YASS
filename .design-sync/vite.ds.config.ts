/**
 * Pre-bundles the design system for the claude.ai/design converter.
 *
 * The converter bundles a package's built `dist/` with esbuild. YASS has no
 * such build — the components are app source, and they lean on three things
 * esbuild alone cannot do: `?raw` SVG imports, `import.meta.glob` over the
 * instrument and source art, and the `@shared` / `@opensource` aliases. So the
 * repo's own toolchain runs first and hands the converter a plain ESM module
 * with every Vite-ism already resolved. That keeps the shipped bundle the
 * repo's real compiled output rather than a reimplementation of it.
 *
 * React stays external: the converter rewrites those imports onto
 * `window.React`, so the design app's own React is the only copy on the page.
 * Two Reacts would break hooks in every preview.
 *
 * Tailwind is deliberately NOT a plugin here. These components carry utility
 * classes as strings and import no stylesheet; the CSS they need is the app's
 * own compiled `client/dist/assets/*.css`, which the converter picks up
 * through `cssEntry`. Running Tailwind here would emit a second, thinner
 * stylesheet scanned from this entry alone and invite it to win.
 */

import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
      /*
       * Pointed at a pruned mirror rather than the submodule itself.
       *
       * `lib/sources.ts` eagerly globs every source icon — 213 files, 5.8 MB —
       * and every asset here has to inline as a data URI (see
       * `assetsInlineLimit` below), which would land a ~9 MB bundle on every
       * design the agent renders. The mirror keeps both `index.json` files
       * whole, so all 240 source names still resolve exactly as they do in the
       * app, and carries only the `base/` icons. An `extra/` source therefore
       * renders its real name with no glyph, which is the same graceful path
       * `resolveSource` already takes for an id it has never seen.
       *
       * Built by `.design-sync/mirror-opensource.mjs`.
       */
      '@opensource': fileURLToPath(new URL('./.cache/opensource', import.meta.url)),
    },
  },

  /*
   * `main.tsx` is not in this graph, but `lib/api.ts` reads the same flag to
   * decide whether to talk to a real server. A literal `false` is what the
   * normal app build defines, so the bundle behaves like production.
   */
  define: { 'import.meta.env.VITE_MOCK': 'false' },

  build: {
    lib: {
      entry: fileURLToPath(new URL('./ds-entry.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'ds',
    },
    /*
     * Inside `client/`, not beside this config, and that placement is load-bearing.
     *
     * The converter locates the package by walking up from `--entry` to the
     * first `package.json` carrying a name, and everything in `config.json`
     * resolves against whatever it finds. Emitting under `.design-sync/` walks
     * up to the repository root, so `cssEntry`, `tsconfig`, `srcDir` and the
     * component source paths all silently miss — the build still exits 0 and
     * writes an unstyled bundle. One directory up from here lands on
     * `client/package.json`, which is the package these components actually
     * belong to.
     */
    outDir: fileURLToPath(new URL('../client/.ds-lib', import.meta.url)),
    emptyOutDir: true,

    /*
     * Everything inlines as a data URI.
     *
     * An emitted asset file would be referenced by a URL the preview cards
     * cannot resolve: the bundle loads from the project root but the cards
     * live three directories down, and the design app serves neither at a path
     * this build can predict. A data URI resolves from wherever it is read.
     */
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,

    sourcemap: false,
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    },
  },
})
