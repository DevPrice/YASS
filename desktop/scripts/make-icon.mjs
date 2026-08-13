/**
 * Generate the app's icons from the YARG mark in the OpenSource submodule.
 *
 * Generated rather than committed: the source PNG is already in the repo, and
 * a binary that can be derived is a binary not worth reviewing diffs of.
 *
 * Two files, because the two platforms want different things:
 *
 *  - `build/icon.ico` carries every size Windows asks for, from the 16px it
 *    draws in the notification area to the 256px it uses in the shell — one
 *    file for both the tray icon and the executable.
 *  - `build/icon.png` is the 256px original, untouched. Linux has no interest
 *    in ICO: electron-builder reads this one to fill the AppImage's desktop
 *    entry, and `nativeImage` reads it for the tray, where an ICO would load
 *    as nothing at all.
 *
 * Note this is YARG's own logo, which is YARG's identity rather than YASS's.
 * It is the right placeholder — the app is unmistakably about YARG, and the
 * registry it comes from is public domain — but a mark of its own is the
 * honest end state.
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import pngToIco from 'png-to-ico'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../vendor/opensource/base/icons/yarg.png')
const buildDir = resolve(here, '../build')

if (!existsSync(source)) {
  console.error(
    `[icon] ${source} is missing. The OpenSource submodule isn't checked out:\n` +
      '       git submodule update --init',
  )
  process.exit(1)
}

await mkdir(buildDir, { recursive: true })

// A single source PNG makes png-to-ico produce the standard ladder —
// 16/24/32/48/64/128/256 — by downscaling, which is what we want from one
// 256x256 original.
await writeFile(join(buildDir, 'icon.ico'), await pngToIco(source))
await copyFile(source, join(buildDir, 'icon.png'))

console.log(`[icon] wrote ${join('build', 'icon.ico')} and ${join('build', 'icon.png')}`)
