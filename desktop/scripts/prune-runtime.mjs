/**
 * Delete the parts of the Electron runtime this app provably never reaches.
 *
 * An `afterPack` hook rather than a `files` exclusion, because these are not
 * ours to exclude: `files` filters the application, and everything named here
 * belongs to the Electron runtime that electron-builder copies in around it.
 * The hook runs once that copy is done and before the target is packaged, which
 * is the only window where the tree exists and nothing has compressed it yet.
 *
 * Only the DirectX shader compiler is pruned, and the case for it is that this
 * app has no 3D content of any kind: `dxcompiler.dll` and `dxil.dll` exist to
 * compile HLSL for WebGPU and D3D12, and the one window this process opens is a
 * settings form. Together they are ~25 MB unpacked and ~7 MB of the shipped
 * executable, which for two files nothing loads is the best trade in the build.
 *
 * What is deliberately NOT pruned, having been measured:
 *
 *  - `LICENSES.chromium.html` is 20 MB unpacked and about 200 KB compressed —
 *    it is thousands of near-identical licence blocks, so LZMA eats it. It is
 *    also an attribution obligation. Dropping it would trade a real one for an
 *    imaginary saving.
 *  - `vk_swiftshader.dll` and `libGLESv2.dll` are Chromium's software renderer
 *    and its ANGLE GL layer — the fallback path when a GPU is blacklisted, a
 *    driver is old, or the app is running over RDP. Worth ~4 MB, and the
 *    failure mode is a blank popover on somebody else's machine with nothing in
 *    the log to explain it. Not a trade worth making for a tray app.
 *  - `icudtl.dat` is 11 MB of internationalisation data and cannot be trimmed
 *    without building Electron from source.
 *
 * Windows only. Nothing here has a Linux counterpart — DirectX does not exist
 * there — and the AppImage gets its saving from `electronLanguages` instead.
 */

import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Runtime files to remove, per platform. Absent entries are not an error. */
const PRUNE = {
  win32: ['dxcompiler.dll', 'dxil.dll'],
}

export default async function pruneRuntime(context) {
  const targets = PRUNE[context.electronPlatformName] ?? []
  if (targets.length === 0) return

  let freed = 0

  for (const name of targets) {
    const path = join(context.appOutDir, name)

    /*
     * Size first, then delete. Reporting what was actually removed is the point
     * of the log line: an Electron upgrade that renames or drops one of these
     * would otherwise prune nothing and say nothing, and the first sign of it
     * would be the executable quietly growing back.
     */
    let size
    try {
      size = (await stat(path)).size
    } catch {
      console.warn(`[prune] ${name} was not there — Electron may have moved it`)
      continue
    }

    await rm(path, { force: true })
    freed += size
  }

  console.log(`[prune] removed ${(freed / 1048576).toFixed(1)} MB of unused runtime`)
}
