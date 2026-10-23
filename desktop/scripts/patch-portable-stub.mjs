/**
 * Teach the portable exe's stub to hand over to a running copy.
 *
 * The stub electron-builder writes for a `portable` target unpacks into
 * `%TEMP%\YASS` (`unpackDirName` in `electron-builder.yml`), and it begins
 * every launch with `RMDir /r` on that directory. With a copy already running
 * from there, Windows deletes every file that copy does not hold open — the
 * server bundle, the client, Electron's own `icudtl.dat` — and then the new
 * `YASS.exe` loses the single-instance lock and exits, leaving the running
 * copy unable to start a server again. Reproduced against v1.4.0.
 *
 * The patch puts a check in front of that wipe: if the unpacked `YASS.exe`
 * cannot be opened for writing, Windows is running it, so the stub launches
 * that exe instead — which loses the lock and shows the running copy's popover
 * — and quits without touching a file. A second double-click opens the tray
 * app, which is what the person was after.
 *
 * A patch to `node_modules` because there is no other way in:
 * electron-builder reads `portable.nsi` from its own templates directory, and
 * the `script` and `include` options that customise the other NSIS targets are
 * skipped for this one. A `beforePack` hook so it is applied by every build,
 * including CI's fresh `npm ci`, and before the NSIS target reads the
 * template. It fails the build rather than ship an unpatched stub if a new
 * electron-builder has moved the line it anchors on.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const MARKER = '; YASS: hand over to a running copy'

const ANCHOR = '  RMDir /r $INSTDIR\n  SetOutPath $INSTDIR\n'

/*
 * `a` opens for writing without truncating, and fails with a sharing violation
 * while the exe is running. The environment matches what the stub sets before
 * its own launch, in case the running copy quits in between and this one ends
 * up holding the lock after all.
 */
const HANDOVER = `  ${MARKER} rather than wipe its files.
  ; See desktop/scripts/patch-portable-stub.mjs in YASS.
  \${If} \${FileExists} "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}"
    ClearErrors
    FileOpen $1 "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" a
    \${If} \${Errors}
      System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
      System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
      System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "\${APP_FILENAME}").r0'
      \${StdUtils.GetAllParameters} $R0 0
      ExecWait '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" $R0' $0
      SetErrorLevel $0
      Quit
    \${EndIf}
    FileClose $1
  \${EndIf}

`

export default async function patchPortableStub(context) {
  if (context.electronPlatformName !== 'win32') return

  const path = require.resolve('app-builder-lib/templates/nsis/portable.nsi')
  const script = await readFile(path, 'utf8')
  if (script.includes(MARKER)) return

  const at = script.indexOf(ANCHOR)
  if (at === -1 || script.indexOf(ANCHOR, at + 1) !== -1) {
    throw new Error(
      `[stub] ${path} no longer has exactly one wipe-then-extract to patch; ` +
        'a second launch of the exe would delete the running copy\'s files. ' +
        'Re-check desktop/scripts/patch-portable-stub.mjs against this electron-builder.',
    )
  }

  await writeFile(path, script.slice(0, at) + HANDOVER + script.slice(at))
  console.log('[stub] portable stub now hands over to a running copy')
}
