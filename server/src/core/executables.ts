/**
 * Finding the external programs YASS runs, and installing the ones it fetches.
 *
 * Two of them now — ffmpeg for media, cloudflared for the tunnel — and both
 * resolve the same way: an environment variable naming one, then what YASS
 * fetched into `managedBinDir()`, then `PATH`. What differs between them is
 * where a download comes from and what shape it arrives in, which is why those
 * stay in each program's own module and only the mechanics live here.
 */

import { chmod, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'

export const executableName = (name: string): string =>
  process.platform === 'win32' ? `${name}.exe` : name

export async function isExecutableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Search `PATH` for an executable, honouring `PATHEXT` on Windows. */
export async function findOnPath(name: string): Promise<string | null> {
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE').split(';').filter(Boolean)
      : ['']

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, name + extension)
      if (await isExecutableFile(candidate)) return candidate
    }
  }

  return null
}

/**
 * Put a verified binary where the app will later execute it.
 *
 * Written to a temp name and renamed into place, so an interrupted write can
 * never leave a half-written executable at the path resolution looks at.
 * Callers verify the digest *before* calling this.
 */
export async function installExecutable(destination: string, binary: Buffer): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })

  const temp = `${destination}.${process.pid}.tmp`
  await writeFile(temp, binary)
  try {
    // A no-op on Windows, and required everywhere else.
    await chmod(temp, 0o755)
    await rename(temp, destination)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}
