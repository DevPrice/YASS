/**
 * Watches one file that YARG rewrites, and calls back when it settles.
 *
 * Three files need this and they need almost exactly the same thing. The
 * **song-list CSV** is a snapshot YARG writes on demand, so before this the
 * only way to pick up a re-export was a button in the UI — and nobody at a
 * party is going to press it, nor should a guest have a control that acts on
 * the host's server. The **`songcache.bin`** is rewritten whenever YARG
 * rescans the library, which is when new songs gain art and previews. And
 * **`currentSong.json`** is rewritten at every song start, pause and scene
 * change, which is the whole of the now-playing banner.
 *
 * Three things shape the implementation, and all three are properties of "a
 * file another program replaces" rather than of any one file in particular:
 *
 *  1. **Watch the directory, not the file.** Every one of these writers
 *     replaces or truncates its file rather than appending to it. On Windows a
 *     file watch follows the inode and goes deaf the moment the original is
 *     unlinked, so a `fs.watch` on the path itself would work exactly once.
 *     Watching the parent and filtering by basename survives replacement, and
 *     also catches the file appearing for the first time when the configured
 *     path doesn't exist yet.
 *
 *  2. **Debounce, then confirm by stat.** None of these writes are atomic, and
 *     all of them fire a burst of events with some of them mid-write. We wait
 *     for quiet, then only act if size or mtime actually moved — editors and
 *     backup tools touch directories constantly, and neither a 4,000-row
 *     reparse nor an index rebuild is free.
 *
 *  3. **Never throw into the watcher.** A failure is reported and the watcher
 *     keeps running; an unreadable file usually means we caught the write
 *     half-finished, and the next event will be the good one.
 *
 * The two ways the callers differ — how long to wait for quiet, and whether the
 * file *disappearing* is news — are options rather than forks, because the
 * hard-won part above is the same for all three.
 */

import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

/**
 * Quiet period after the last filesystem event before we act.
 *
 * Sized for the expensive readers — a library reparse or an index rebuild is
 * not something to start twice because a write arrived in two chunks. Callers
 * whose work is cheap and whose latency is visible override it.
 */
const DEFAULT_SETTLE_MS = 500

/** Identity of the file as last seen, so we can ignore events that changed nothing. */
interface Fingerprint {
  size: number
  mtimeMs: number
}

async function fingerprint(path: string): Promise<Fingerprint | null> {
  try {
    const stats = await stat(path)
    return { size: stats.size, mtimeMs: stats.mtimeMs }
  } catch {
    // Not there yet, or gone. Both are legitimate states to sit in.
    return null
  }
}

const same = (a: Fingerprint | null, b: Fingerprint | null): boolean =>
  a === null || b === null ? a === b : a.size === b.size && a.mtimeMs === b.mtimeMs

export interface FileWatcherOptions {
  /** Read fresh each time — the path changes when settings are saved. */
  getPath: () => string
  /** Called after the file settles at a new fingerprint. */
  onChange: () => Promise<void>
  onError?: (error: unknown) => void
  /** Quiet period before acting. Defaults to {@link DEFAULT_SETTLE_MS}. */
  settleMs?: number
  /**
   * Is the file going away itself a change worth reporting?
   *
   * For the library files it is not: a vanished cache means YARG is mid-rescan
   * or the drive is briefly away, and the right answer is to keep serving the
   * songs we already parsed rather than blank the app. For `currentSong.json`
   * it is the opposite — the file being gone is precisely the statement that
   * nothing is playing, and suppressing it would strand the banner on the last
   * song of the night.
   */
  notifyOnMissing?: boolean
}

export class FileWatcher {
  #options: FileWatcherOptions
  #watcher: FSWatcher | null = null
  /** The directory currently being watched, so a no-op re-arm stays a no-op. */
  #watchedDir: string | null = null
  #watchedFile: string | null = null
  #seen: Fingerprint | null = null
  #timer: NodeJS.Timeout | null = null
  #reloading = false
  /** A change that landed while a reload was in flight. */
  #pending = false

  constructor(options: FileWatcherOptions) {
    this.#options = options
  }

  /**
   * Begin watching, or move to a new path.
   *
   * Safe to call repeatedly; re-arming on the same directory does nothing.
   */
  async start(): Promise<void> {
    const path = this.#options.getPath()

    if (path === '') {
      this.stop()
      return
    }

    const dir = dirname(path)
    const file = basename(path)

    this.#seen = await fingerprint(path)

    if (this.#watcher !== null && this.#watchedDir === dir) {
      // Same directory, possibly a different filename within it.
      this.#watchedFile = file
      return
    }

    this.stop()

    try {
      this.#watcher = watch(dir, { persistent: false }, (_event, changed) => {
        // `changed` is null on some platforms; treat that as "something here
        // moved" and let the stat check decide.
        if (changed !== null && basename(String(changed)) !== this.#watchedFile) return
        this.#schedule()
      })
    } catch (error) {
      // A missing or unreadable directory is a configuration problem, not a
      // crash. Settings can point somewhere real later.
      this.#options.onError?.(error)
      return
    }

    this.#watcher.on('error', (error) => this.#options.onError?.(error))
    this.#watchedDir = dir
    this.#watchedFile = file
  }

  #schedule(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => void this.#settle(), this.#options.settleMs ?? DEFAULT_SETTLE_MS)
  }

  async #settle(): Promise<void> {
    this.#timer = null

    if (this.#reloading) {
      // Don't interleave reloads; remember that another one is owed.
      this.#pending = true
      return
    }

    const path = this.#options.getPath()
    const current = await fingerprint(path)

    if (same(current, this.#seen)) return
    this.#seen = current

    if (current === null && this.#options.notifyOnMissing !== true) return

    this.#reloading = true
    try {
      await this.#options.onChange()
    } catch (error) {
      this.#options.onError?.(error)
    } finally {
      this.#reloading = false
      if (this.#pending) {
        this.#pending = false
        this.#schedule()
      }
    }
  }

  stop(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }

    this.#watcher?.close()
    this.#watcher = null
    this.#watchedDir = null
    this.#watchedFile = null
  }
}
