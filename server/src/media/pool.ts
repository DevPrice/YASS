/**
 * Two small primitives that every media job needs, and neither of which is
 * worth a dependency.
 *
 * **Single-flight.** Three phones opening the same song at once must produce
 * one ffmpeg process, not three. Without this the popular song at a party — the
 * one everybody taps — is precisely the one that costs the most.
 *
 * **A concurrency cap.** ffmpeg saturates a core per process, and this server
 * is also answering requests for a room full of people. `cpus - 2` leaves the
 * event loop and one other thing room to run.
 */

import { cpus } from 'node:os'

/**
 * How many ffmpeg processes may run at once.
 *
 * At least one, so a two-core machine still makes progress; capped at 8 because
 * the work is I/O-bound on a network share well before it is CPU-bound, and a
 * 32-core host opening 30 connections to an SMB server helps nobody.
 */
export function defaultConcurrency(): number {
  return Math.max(1, Math.min(8, cpus().length - 2))
}

/** A counting semaphore. `release` is idempotent. */
export class Semaphore {
  #available: number
  #waiting: Array<() => void> = []

  constructor(permits: number) {
    this.#available = Math.max(1, permits)
  }

  async acquire(): Promise<() => void> {
    if (this.#available > 0) {
      this.#available--
      return this.#releaser()
    }

    await new Promise<void>((resolve) => this.#waiting.push(resolve))
    return this.#releaser()
  }

  #releaser(): () => void {
    let released = false

    return () => {
      if (released) return
      released = true

      const next = this.#waiting.shift()
      if (next !== undefined) next()
      else this.#available++
    }
  }

  /** Run `work` holding a permit, releasing it however `work` ends. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await work()
    } finally {
      release()
    }
  }
}

/**
 * Collapse concurrent calls for the same key onto one promise.
 *
 * The entry is removed when the work settles rather than cached, because the
 * *result* is cached on disk by the caller — keeping promises here would mean
 * holding a failed generation forever and never retrying it.
 */
export class SingleFlight<T> {
  #inFlight = new Map<string, Promise<T>>()

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.#inFlight.get(key)
    if (existing !== undefined) return existing

    const promise = work().finally(() => {
      this.#inFlight.delete(key)
    })

    this.#inFlight.set(key, promise)
    return promise
  }

  get size(): number {
    return this.#inFlight.size
  }
}
