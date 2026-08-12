/**
 * The preview store, driven the way the app drives it.
 *
 * This is a state machine wrapped around two media elements and an audio graph,
 * and every rule in it is invisible from the outside until it breaks: whether a
 * request went out, whether the decks were reused or multiplied, whether the
 * song you switched away from faded or was cut off mid-note. None of that shows
 * up in a typecheck, and the loudest failure — muted previews quietly fetching
 * audio anyway — would look and sound exactly like a working app.
 *
 * **The fakes are the assertion surface.** `plays` records every URL that was
 * actually started, `FakeAudio.instances` records how many elements were built
 * at all, and `FakeParam.events` records every ramp that was scheduled and how
 * long it was given. Together they answer "did this make a request" and "did
 * that transition happen" without a speaker in the room.
 *
 * `FakeParam` interpolates its own value against a real clock rather than
 * jumping to the target, because two of the behaviours here are *about* being
 * caught mid-ramp: reclaiming a deck that is still audible, and refusing to
 * start an equal-power curve from halfway up one.
 *
 * Module state is global by design — there is one preview in an app — so each
 * case imports its own instance of the module through a cache-busting query and
 * gets fresh decks, a fresh store and a fresh `localStorage`.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const MODULE = new URL('./usePreview.ts', import.meta.url).href

/** The clock both fakes read, in seconds, like a real `AudioContext`. */
const now = () => performance.now() / 1000

/** An `AudioParam` that moves the way a real one does, and remembers its orders. */
class FakeParam {
  #base = 0
  #ramp: { from: number; to: number; start: number; end: number } | null = null

  /** Every scheduling call, in order, as short readable strings. */
  events: string[] = []

  get value(): number {
    const ramp = this.#ramp
    if (ramp === null) return this.#base

    const at = now()
    if (at >= ramp.end) {
      this.#base = ramp.to
      this.#ramp = null
      return ramp.to
    }

    const progress = (at - ramp.start) / (ramp.end - ramp.start)
    return ramp.from + (ramp.to - ramp.from) * progress
  }

  set value(next: number) {
    this.#base = next
    this.#ramp = null
  }

  cancelScheduledValues(_at: number): void {
    // Hold wherever the ramp had got to, which is what cancelling means.
    this.#base = this.value
    this.#ramp = null
    this.events.push('cancel')
  }

  setValueAtTime(value: number, _at: number): void {
    this.value = value
    this.events.push(`set:${round(value)}`)
  }

  linearRampToValueAtTime(value: number, end: number): void {
    const start = now()
    this.#ramp = { from: this.value, to: value, start, end }
    this.events.push(`linear:${round(this.#ramp.from)}->${round(value)}:${ms(end - start)}`)
  }

  setValueCurveAtTime(curve: Float32Array, at: number, duration: number): void {
    const from = curve[0] ?? 0
    const to = curve[curve.length - 1] ?? 0
    this.#base = from
    this.#ramp = { from, to, start: at, end: at + duration }
    this.events.push(`curve:${round(from)}->${round(to)}:${ms(duration)}`)
  }
}

const round = (value: number) => Math.round(value * 100) / 100
/** Durations rounded to the nearest 10ms, so a stray millisecond is not a diff. */
const ms = (seconds: number) => Math.round((seconds * 1000) / 10) * 10

class FakeGain {
  static instances: FakeGain[] = []

  gain = new FakeParam()

  constructor() {
    FakeGain.instances.push(this)
  }

  connect<T>(target: T): T {
    return target
  }
}

class FakeContext {
  static instances: FakeContext[] = []

  destination = { name: 'destination' }
  resumes = 0

  constructor() {
    FakeContext.instances.push(this)
  }

  get currentTime(): number {
    return now()
  }

  createGain(): FakeGain {
    return new FakeGain()
  }

  createMediaElementSource(_element: unknown): { connect<T>(target: T): T } {
    return { connect: (target) => target }
  }

  resume(): Promise<void> {
    this.resumes += 1
    return Promise.resolve()
  }
}

/** Everything the store touches on an `HTMLAudioElement`, and nothing else. */
class FakeAudio {
  static instances: FakeAudio[] = []

  /**
   * What each `play()` returns, consumed in order; anything past the end
   * resolves.
   *
   * Static and queued rather than a field on the instance, because the elements
   * do not exist until the store starts the first song — a test that wants the
   * *first* `play()` to reject has nothing to set the field on yet.
   *
   * Thunks rather than promises, because the settle window means a queued
   * result waits ~300 ms before anything consumes it, and a rejected promise
   * sitting around unclaimed for that long is an unhandled rejection. This way
   * the rejection comes into existence when `play()` is called, which is also
   * when the real one would.
   */
  static results: Array<() => Promise<void>> = []

  src = ''
  loop = false
  preload = ''
  paused = true

  /** Every source that was actually started, in order. */
  plays: string[] = []

  private listeners = new Map<string, Array<() => void>>()

  constructor() {
    FakeAudio.instances.push(this)
  }

  addEventListener(type: string, listener: () => void): void {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  /** Fire an event the browser would fire. */
  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }

  load(): void {}

  play(): Promise<void> {
    this.paused = false
    this.plays.push(this.src)
    const next = FakeAudio.results.shift()
    return next === undefined ? Promise.resolve() : next()
  }

  pause(): void {
    this.paused = true
    // Real elements queue this as a task rather than firing it inline, which is
    // the whole reason the store guards its `pause` listener. Deferring it here
    // is what makes that guard testable at all.
    queueMicrotask(() => this.emit('pause'))
  }
}

/** A `localStorage` that records, or one that throws the way Safari's can. */
function fakeStorage(seed?: string, broken = false) {
  const values = new Map<string, string>()
  if (seed !== undefined) values.set('yass.previews.muted', seed)

  return {
    values,
    getItem(key: string): string | null {
      if (broken) throw new Error('storage is not available')
      return values.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      if (broken) throw new Error('storage is not available')
      values.set(key, value)
    },
  }
}

let caseNumber = 0

/**
 * A fresh copy of the module, with the browser it expects installed first.
 *
 * The globals have to be in place before the import, not after: the stored
 * preference is read while the module body evaluates, which is the only chance
 * a device gets to say it has been unmuted before.
 */
async function load(options: { stored?: string; broken?: boolean; noWebAudio?: boolean } = {}) {
  const storage = fakeStorage(options.stored, options.broken)

  const globals = globalThis as unknown as Record<string, unknown>
  globals.window = {
    localStorage: storage,
    AudioContext: options.noWebAudio === true ? undefined : FakeContext,
  }
  globals.Audio = FakeAudio

  FakeAudio.instances = []
  FakeAudio.results = []
  FakeGain.instances = []
  FakeContext.instances = []

  caseNumber += 1
  const store = (await import(`${MODULE}?case=${caseNumber}`)) as typeof import('./usePreview')

  /** Deck `index`'s element, asserting that the store actually built one. */
  const deck = (index: number): FakeAudio => {
    const element = FakeAudio.instances[index]
    assert.ok(element, `no media element ${index} was ever constructed`)
    return element
  }

  /** Deck `index`'s scheduled ramps, in order. */
  const ramps = (index: number): string[] => {
    const gain = FakeGain.instances[index]
    assert.ok(gain, `no gain node ${index} was ever constructed`)
    return gain.gain.events
  }

  const level = (index: number): number => {
    const gain = FakeGain.instances[index]
    assert.ok(gain)
    return round(gain.gain.value)
  }

  /** The browser reporting that a deck has begun to make sound. */
  const arrive = (index: number) => deck(index).emit('playing')

  return { store, storage, deck, ramps, level, arrive }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/**
 * Long enough for the selection to count as settled and the load to start.
 *
 * Nothing is fetched until a song has been the selected one for `SETTLE_MS`, so
 * every test that expects a request has to spend this first. That is the point
 * of the delay and the tests are the place it should be most visible.
 */
const SETTLED = 340

/** Comfortably past any number of settle windows, for the held-key case. */
const SETTLE_TIMES_THREE = 1000

/**
 * Long enough for a fade-in to have finished.
 *
 * Tests that mean "a song that is playing" have to spend it. A deck two
 * milliseconds into its 600ms fade-in is at gain ~0, and every decision this
 * module makes about a deck is made from what it is *currently* worth — so
 * switching songs there exercises the interruption path, not the ordinary one.
 */
const FADED_IN = 660

/** Let queued microtasks — the deferred `pause`, a rejected `play` — run. */
const settle = () => wait(0)

/** The ramps that matter, with the cancels and holds stripped out. */
const fades = (events: readonly string[]) =>
  events.filter((event) => event.startsWith('curve:') || event.startsWith('linear:'))

describe('preview sound', () => {
  it('starts muted on a device that has never said otherwise', async () => {
    const { store } = await load()
    assert.equal(store.previewState().muted, true)
  })

  it('remembers a device that unmuted, and only that exact value', async () => {
    assert.equal((await load({ stored: 'false' })).store.previewState().muted, false)
    assert.equal((await load({ stored: 'true' })).store.previewState().muted, true)
    // Anything unrecognised fails to the quiet side rather than to noise.
    assert.equal((await load({ stored: 'maybe' })).store.previewState().muted, true)
  })

  it('starts muted when localStorage itself throws', async () => {
    const { store } = await load({ broken: true })
    assert.equal(store.previewState().muted, true)

    // And still toggles for the session — a failed write is not a failed click.
    store.setPreviewMuted(false)
    assert.equal(store.previewState().muted, false)
  })

  /*
   * The one this file exists for.
   *
   * "Muted" has to mean no bytes, not silent bytes: a phone on a metered
   * connection in a room where nobody has asked for sound should be making the
   * same requests the app made before previews existed, which is none. A deck
   * that was merely faded to zero would still download every song somebody
   * tapped.
   */
  it('builds nothing and fetches nothing while muted', async () => {
    const { store } = await load()

    store.setPreviewSong('ABC123')
    store.setPreviewSong('DEF456')
    await wait(SETTLED)

    assert.equal(FakeAudio.instances.length, 0, 'a muted preview constructed a media element')
    assert.equal(FakeContext.instances.length, 0, 'a muted preview built an audio graph')
    assert.equal(store.previewState().status, 'idle')
    // The song is still tracked, because unmuting has to know what to start.
    assert.equal(store.previewState().hash, 'DEF456')
  })

  it('starts the selected song the moment it is unmuted', async () => {
    const { store, deck } = await load()

    store.setPreviewSong('ABC123')
    store.setPreviewMuted(false)

    assert.deepEqual(deck(0).plays, ['/api/preview/ABC123'])
    assert.equal(store.previewState().status, 'loading')
  })

  it('unmutes silently when nothing is selected', async () => {
    const { store } = await load()

    store.setPreviewMuted(false)

    assert.equal(FakeAudio.instances.length, 0)
    assert.equal(store.previewState().status, 'idle')
  })

  it('loops, because the preview lasts as long as the song is selected', async () => {
    const { store, deck } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)

    assert.equal(deck(0).loop, true)
  })

  /*
   * The one somebody will find by accident, on a list four thousand rows long:
   * holding an arrow key walks the selection at the keyboard's repeat rate.
   * Firing a request per step would ask the server to run ffmpeg over dozens of
   * charts nobody is going to hear, on a machine that is also running the game.
   */
  it('fetches nothing while the selection is still moving', async () => {
    const { store } = await load({ stored: 'false' })

    // Thirty songs in three hundred milliseconds is roughly a held arrow key.
    for (let index = 0; index < 30; index += 1) {
      store.setPreviewSong(`SONG${index}`)
      await wait(10)
    }

    assert.equal(FakeAudio.instances.length, 0, 'a scroll started fetching previews')

    await wait(SETTLED)
    assert.deepEqual(
      FakeAudio.instances.flatMap((element) => element.plays),
      ['/api/preview/SONG29'],
      'the scroll should cost exactly one request, for the song it stopped on',
    )
  })

  /*
   * A run through the list is not a song anybody chose, so the one that *was*
   * chosen stops. Carrying it along under a hundred rows it has nothing to do
   * with turns the sound into something that outlived its reason.
   */
  it('silences the current song while the selection runs past twenty others', async () => {
    const { store, ramps, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    await wait(FADED_IN)

    for (let index = 0; index < 20; index += 1) {
      store.setPreviewSong(`SONG${index}`)
      await wait(10)
    }

    assert.deepEqual(fades(ramps(0)), ['curve:0->1:600', 'curve:1->0:400'])
    assert.deepEqual(
      FakeAudio.instances.flatMap((element) => element.plays),
      ['/api/preview/ABC123'],
      'the run fetched something on the way past',
    )

    // And the landing song starts once the running stops — on the deck the
    // silenced one has by then been released from.
    await wait(SETTLED)
    assert.deepEqual(
      FakeAudio.instances.flatMap((element) => element.plays),
      ['/api/preview/ABC123', '/api/preview/SONG19'],
    )
  })

  /*
   * The failure a timer cannot fix. A held key produces its first repeat only
   * after the repeat *delay* — 250ms to 1000ms depending on a setting nobody
   * remembers changing — so any settle short enough to keep a click feeling
   * immediate expires inside that gap, and the first press of a hold commits
   * and plays the neighbouring song exactly as if it had been chosen.
   */
  it('starts nothing while the key is still down, however long the keyboard waits', async () => {
    const { store } = await load({ stored: 'false' })

    store.setPreviewNavigating(true, false)
    store.setPreviewSong('ABC123')

    // Three settle windows, and not a repeat in sight: a slow keyboard.
    await wait(SETTLE_TIMES_THREE)
    assert.equal(FakeAudio.instances.length, 0, 'a held key started a song on its own')

    store.setPreviewNavigating(false, false)
    await wait(SETTLED)

    assert.deepEqual(
      FakeAudio.instances.flatMap((element) => element.plays),
      ['/api/preview/ABC123'],
    )
  })

  it('silences what is playing the moment a key starts repeating', async () => {
    const { store, deck, ramps, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    await wait(FADED_IN)

    // The hold begins: one press, then the keyboard starts repeating.
    store.setPreviewNavigating(true, false)
    assert.deepEqual(fades(ramps(0)), ['curve:0->1:600'], 'a single press silenced the song')

    store.setPreviewNavigating(true, true)
    assert.deepEqual(fades(ramps(0)), ['curve:0->1:600', 'curve:1->0:400'])

    await wait(500)
    assert.equal(deck(0).paused, true)
  })

  /*
   * A song must not be audible before its fade-in is scheduled. A deck resting
   * at full gain would announce the first frame of every preview at full volume
   * and then fade in from there, which is the artefact the fade exists to
   * remove.
   */
  it('starts every deck silent and fades it in on arrival', async () => {
    const { store, ramps, level, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)

    assert.equal(level(0), 0)
    assert.deepEqual(fades(ramps(0)), [])

    arrive(0)
    assert.deepEqual(fades(ramps(0)), ['curve:0->1:600'])
    assert.equal(store.previewState().status, 'playing')
  })

  it('fades out rather than cutting when the song is deselected', async () => {
    const { store, deck, ramps } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    deck(0).emit('playing')
    await wait(FADED_IN)

    store.setPreviewSong(null)

    assert.deepEqual(fades(ramps(0)), ['curve:0->1:600', 'curve:1->0:400'])
    // Still playing: a deck released the moment the fade is scheduled is a cut
    // with extra steps.
    assert.equal(deck(0).paused, false)

    await wait(500)
    assert.equal(deck(0).paused, true)
    assert.equal(deck(0).src, '', 'the download was left in flight')
  })

  it('crossfades between songs, on two decks and only two', async () => {
    const { store, deck, ramps, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    await wait(FADED_IN)

    store.setPreviewSong('DEF456')
    await wait(SETTLED)
    arrive(1)

    assert.equal(FakeAudio.instances.length, 2)
    assert.deepEqual(fades(ramps(0)), ['curve:0->1:600', 'curve:1->0:600'])
    assert.deepEqual(fades(ramps(1)), ['curve:0->1:600'])
    assert.deepEqual(deck(1).plays, ['/api/preview/DEF456'])

    // A third song reuses the first deck rather than building another.
    await wait(FADED_IN)
    store.setPreviewSong('GHI789')
    await wait(SETTLED)
    arrive(0)
    assert.equal(FakeAudio.instances.length, 2)
  })

  /*
   * The outgoing fade starts when you pick a new song, not when the new song
   * turns up. A cold preview is generated on the spot and can take a second;
   * holding the old one at full volume for that second makes the tap feel like
   * it did not register.
   */
  it('starts the outgoing fade before the incoming song has arrived', async () => {
    const { store, ramps, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    await wait(FADED_IN)

    store.setPreviewSong('DEF456')
    await wait(SETTLED)

    assert.deepEqual(fades(ramps(0)), ['curve:0->1:600', 'curve:1->0:600'])
    assert.deepEqual(fades(ramps(1)), [], 'the incoming deck ramped before it had audio')

    arrive(1)
    assert.deepEqual(fades(ramps(1)), ['curve:0->1:600'])
  })

  /*
   * Changing your mind twice inside one crossfade hands a deck that is still
   * making sound to a different song. Writing `src` at that moment cuts the
   * waveform, which is a click; the duck is what stops it being audible.
   */
  it('ducks a deck it has to reclaim while it is still audible', async () => {
    const { store, deck, ramps, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    await wait(FADED_IN)

    store.setPreviewSong('DEF456')
    await wait(SETTLED)
    arrive(1)

    // Deck 0 is a fifth of the way through its 600ms fade-out.
    await wait(120)
    store.setPreviewSong('GHI789')
    await wait(SETTLED)

    const ducked = fades(ramps(0)).at(-1) ?? ''
    assert.match(ducked, /^linear:0\.\d+->0:60$/, `expected a short duck, got ${ducked}`)

    // And the new song starts on that deck once the duck has run.
    await wait(120)
    assert.deepEqual(deck(0).plays, ['/api/preview/ABC123', '/api/preview/GHI789'])
  })

  /*
   * The selected `Song` is a fresh object every time the library reloads, and
   * the CSV is re-exported while people are browsing. Restarting the audio from
   * zero mid-song for something nobody did is the bug this prevents.
   */
  it('ignores a re-selection of the song already playing', async () => {
    const { store, deck, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    store.setPreviewSong('ABC123')
    await wait(SETTLED)

    assert.deepEqual(deck(0).plays, ['/api/preview/ABC123'])
    // Two elements exist because the pair is built together on first use, and
    // the second one has never been given anything to play.
    assert.deepEqual(deck(1).plays, [])
  })

  it('fades out when muted again, and writes the preference down', async () => {
    const { store, storage, deck, ramps, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    await wait(FADED_IN)

    store.setPreviewMuted(true)

    assert.deepEqual(fades(ramps(0)), ['curve:0->1:600', 'curve:1->0:400'])
    assert.equal(storage.values.get('yass.previews.muted'), 'true')

    await wait(500)
    assert.equal(deck(0).paused, true)
    assert.equal(deck(0).src, '')

    // The song stays selected: it is what unmuting would start again.
    assert.equal(store.previewState().hash, 'ABC123')
  })

  /*
   * A deck that has been sent away must stay away. Its teardown is scheduled
   * for the end of a fade, and by then the deck may have been handed a new
   * song — releasing it at that point would stop the song that is playing now
   * on an instruction issued for the one before it.
   */
  it('does not let a scheduled teardown stop the song that replaced it', async () => {
    const { store, deck, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    await wait(FADED_IN)

    store.setPreviewSong('DEF456')
    await wait(SETTLED)
    arrive(1)
    // Deck 0 is fading out with a release scheduled; take it back immediately.
    store.setPreviewSong('GHI789')

    await wait(1000)
    arrive(0)

    assert.equal(deck(0).paused, false)
    assert.equal(deck(0).src, '/api/preview/GHI789')
    assert.equal(store.previewState().status, 'playing')
  })

  it('reports a start the browser refused', async () => {
    const { store } = await load({ stored: 'false' })

    FakeAudio.results = [() => Promise.reject(new Error('NotAllowedError'))]
    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    await settle()

    assert.equal(store.previewState().status, 'idle')
    // Still selected — the song is fine, the sound was not allowed.
    assert.equal(store.previewState().hash, 'ABC123')
  })

  /*
   * Swapping `src` out from under a `play()` that has not resolved rejects it
   * with `AbortError`, so *every* change of selection produces one of these.
   * Read as a failure it would report the song you just picked as stopped.
   */
  it('keeps the new song loading when the old one aborts', async () => {
    const { store } = await load({ stored: 'false' })

    let abort!: (error: Error) => void
    FakeAudio.results = [() => new Promise<void>((_resolve, reject) => (abort = reject))]

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    store.setPreviewSong('DEF456')
    await wait(SETTLED)

    abort(new Error('AbortError'))
    await settle()

    assert.equal(store.previewState().status, 'loading')
    assert.equal(store.previewState().hash, 'DEF456')
  })

  it('reports a pause it did not ask for', async () => {
    const { store, deck, arrive } = await load({ stored: 'false' })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    assert.equal(store.previewState().status, 'playing')

    // Headphones pulled out, a media key, a phone call taking audio focus.
    deck(0).emit('pause')
    assert.equal(store.previewState().status, 'idle')
  })

  /*
   * Fades are a `GainNode`, and where there is no audio graph to build one in
   * the feature still has to work. It arrives abruptly instead — and, crucially,
   * a deck sent away with a fade that is not happening has to stop *now* rather
   * than play on at full volume for the length of a silent ramp.
   */
  it('degrades to cuts where there is no Web Audio at all', async () => {
    const { store, deck, arrive } = await load({ stored: 'false', noWebAudio: true })

    store.setPreviewSong('ABC123')
    await wait(SETTLED)
    arrive(0)
    assert.equal(FakeGain.instances.length, 0)
    assert.equal(store.previewState().status, 'playing')

    store.setPreviewSong(null)
    assert.equal(deck(0).paused, true, 'a deck with no fade to wait for kept playing')
    assert.equal(deck(0).src, '')
  })
})
