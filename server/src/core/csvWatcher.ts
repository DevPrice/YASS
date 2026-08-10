/**
 * Watches the exported song-list CSV and reloads when it changes.
 *
 * The CSV is a snapshot YARG writes on demand, so before this the only way to
 * pick up a re-export was a button in the UI. Nobody at a party is going to
 * press it, and guests shouldn't have a control that acts on the host's server
 * anyway — so the server notices instead.
 *
 * Three things shape the implementation:
 *
 *  1. **Watch the directory, not the file.** An export replaces the CSV rather
 *     than appending to it. On Windows a file watch follows the inode and goes
 *     deaf the moment the original is unlinked, so a `fs.watch` on the path
 *     itself would work exactly once. Watching the parent and filtering by
 *     basename survives replacement, and also catches the file appearing for
 *     the first time when the configured path doesn't exist yet.
 *
 *  2. **Debounce, then confirm by stat.** A CSV write is not atomic and fires a
 *     burst of events, some of them mid-write. We wait for quiet, then only
 *     reload if size or mtime actually moved — editors and backup tools touch
 *     directories constantly, and a 4,000-row reparse is not free.
 *
 *  3. **Never throw into the watcher.** A reload failure is reported and the
 *     watcher keeps running; an unreadable file usually means we caught the
 *     export half-written, and the next event will be the good one.
 */

import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

/** Quiet period after the last filesystem event before we act. */
const SETTLE_MS = 500

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

export interface CsvWatcherOptions {
  /** Read fresh each time — the path changes when settings are saved. */
  getPath: () => string
  /** Called after the file settles at a new fingerprint. */
  onChange: () => Promise<void>
  onError?: (error: unknown) => void
}

export class CsvWatcher {
  #options: CsvWatcherOptions
  #watcher: FSWatcher | null = null
  /** The directory currently being watched, so a no-op re-arm stays a no-op. */
  #watchedDir: string | null = null
  #watchedFile: string | null = null
  #seen: Fingerprint | null = null
  #timer: NodeJS.Timeout | null = null
  #reloading = false
  /** A change that landed while a reload was in flight. */
  #pending = false

  constructor(options: CsvWatcherOptions) {
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
    this.#timer = setTimeout(() => void this.#settle(), SETTLE_MS)
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

    // The file being deleted is a state, not a reload trigger — keep serving
    // the library we already have rather than blanking the app.
    if (current === null) return

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
