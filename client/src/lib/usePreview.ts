/**
 * Hearing the song you are looking at.
 *
 * **The preview follows the selection.** There is no play button anywhere in
 * this app: picking a song starts its preview, picking another one crossfades to
 * that one, and closing the detail fades it out. That is the whole interaction,
 * and it is the one the surface was already asking for — a room passing a phone
 * around taps a song to see what it is, and "what is it" is a question a
 * thirty-second clip answers better than a difficulty ring does.
 *
 * A play control on every row was the first cut and it was wrong twice over. It
 * put a second tappable thing inside a row whose entire job is to be tapped, and
 * on a phone — where nothing can hide until hovered — it drew a disc over four
 * thousand album covers to offer a verb nobody had asked for yet.
 *
 * **It loops.** A preview that stops after thirty seconds turns a browsing
 * session into a series of small silences, each one an invitation to re-tap
 * something. Looping means the sound is simply a property of what is selected:
 * it starts when you arrive and ends when you leave.
 *
 * **It follows where you stop, not where you pass through.** Arrow keys walk
 * the selection and a held key walks it thirty times a second, so nothing is
 * fetched until the selection has settled *and* the key is up — see
 * `SETTLE_MS` and `setPreviewNavigating`. A scroll also silences whatever was
 * playing: it is a hundred rows nobody chose, and carrying a song through it
 * turns the sound into something that outlives the reason it started.
 *
 * ## Muted by default, and muted means nothing is fetched
 *
 * Sound that starts on its own is hostile in exactly the setting this app is
 * for: a phone handed around a room that already has music playing through it.
 * So the preference starts muted and is remembered per device, and while it is
 * muted this module makes no request at all — no `src`, no element, no audio
 * graph. A muted YASS is byte-for-byte the app that existed before previews did.
 *
 * That default also solves the autoplay problem for free. Browsers refuse to
 * start audio without a user gesture, and the gesture is built into the feature:
 * the only way to reach an unmuted state is to tap the control that unmutes it,
 * and `setPreviewMuted` starts playback synchronously inside that handler. iOS
 * unlocks the element on that first gesture-initiated `play()`, and the
 * `AudioContext` below is constructed in the same handler for the same reason.
 *
 * ## Why there is an audio graph at all
 *
 * Fading needs a volume control, and `HTMLMediaElement.volume` is **read-only on
 * iOS** — Safari ignores writes to it so that the hardware buttons remain the
 * only volume in the room. A `volume` ramp would therefore fade on every desktop
 * and hard-cut on every iPhone, which is to say it would not work on the device
 * this app is written for. A `GainNode` is the one volume control that does, and
 * its ramps are scheduled on the audio thread, so a busy main thread — four
 * thousand rows re-sorting, say — cannot make a fade stutter.
 *
 * Where there is no `AudioContext` to be had, every deck falls back to a null
 * gain and the fades collapse to cuts. The feature still works; it just arrives
 * abruptly, exactly as it did before this.
 *
 * ## Two decks
 *
 * A crossfade is two songs audible at once, so one element cannot do it. The
 * pair is fixed at two and reused forever: at most one deck is carrying the
 * current song and at most one is loading the next, and the moment the loading
 * one produces sound the two swap roles. Everything that can interrupt that —
 * changing your mind mid-fade, muting mid-crossfade, a file that 404s — is
 * handled by giving each deck a token that every scheduled callback re-checks
 * before it acts on a deck that has since been given another job.
 */

import { useCallback, useSyncExternalStore } from 'react'

import { previewUrl } from './api'

export type PreviewStatus = 'idle' | 'loading' | 'playing'

interface PreviewState {
  /**
   * The selected song, tracked whether or not it is audible.
   *
   * Held while muted too, because unmuting has to know what to start — the
   * control that does it is on the detail surface of a song already chosen.
   */
  hash: string | null
  status: PreviewStatus
  muted: boolean
}

/**
 * How long the selection has to hold still before anything is fetched.
 *
 * Holding ↓ walks the list at the keyboard's repeat rate — around thirty songs
 * a second — and without this every one of them would set a `src`, which is
 * thirty requests a second, each one asking a server to run ffmpeg over a chart
 * nobody will hear. The list is four thousand rows long; somebody *will* hold
 * the key down.
 *
 * So the preview follows where you stop, not where you pass through.
 *
 * **A timer alone cannot do this, at any value.** What a held key produces
 * first is not repeat, it is the repeat *delay* — 250 ms to 1000 ms depending
 * on a setting nobody remembers changing, 500 ms out of the box on this
 * machine. Any window short enough to keep a click feeling immediate is
 * therefore shorter than the gap before the second keypress, so the first press
 * of a hold settles, commits, and starts playing the neighbouring song exactly
 * as if it had been chosen — which is the one thing this was meant to prevent.
 *
 * The fix is to stop guessing: `setPreviewNavigating` reports whether the key
 * is still down, and nothing commits while it is. The timer then only has to
 * cover what is genuinely a pause, so 300 ms can stay short enough that a
 * deliberate click does not feel delayed.
 *
 * Deselecting, muting and unmuting are exempt. Those are decisions rather than
 * navigation, and none of them can be produced thirty times a second.
 */
const SETTLE_MS = 300

/**
 * How long each move takes.
 *
 * The crossfade is longer than the fade-out because it has to cover a change of
 * key, tempo and mix between two unrelated records, and a short one reads as a
 * collision rather than a transition. Leaving is the opposite case: you have
 * already decided, and anything slower than this feels like the app arguing.
 *
 * `CUT_MS` is not a fade anybody is meant to hear. It is the shortest ramp that
 * reliably avoids a click when a deck still making sound has to be taken away
 * and handed a different song — which happens when somebody changes their mind
 * twice inside one crossfade.
 */
const CROSSFADE_MS = 600
const FADE_OUT_MS = 400
const CUT_MS = 60

/**
 * Equal-power crossfade curves, rather than two straight lines.
 *
 * Two uncorrelated signals sum by power, not amplitude, so linear ramps that
 * cross at 0.5 leave a ~3 dB hole in the middle of every transition — audible as
 * a dip, on every song change, forever. Square-root curves cross at 0.707 and
 * hold the perceived loudness flat across the whole handover.
 *
 * 33 points is well past what a 600 ms ramp can resolve; the browser
 * interpolates between them on the audio thread.
 */
const CURVE_POINTS = 33

function powerCurve(rising: boolean): Float32Array {
  const values = new Float32Array(CURVE_POINTS)

  for (let index = 0; index < CURVE_POINTS; index += 1) {
    const progress = index / (CURVE_POINTS - 1)
    values[index] = Math.sqrt(rising ? progress : 1 - progress)
  }

  return values
}

const RISING = powerCurve(true)
const FALLING = powerCurve(false)

/**
 * Where the preference lives.
 *
 * Per device rather than per session: whoever unmutes has decided something
 * about the room they are in, and asking again on every reload would make the
 * decision feel like it did not take.
 */
const STORAGE_KEY = 'yass.previews.muted'

/**
 * Muted unless the device has explicitly said otherwise.
 *
 * Any value but the exact string `false` means muted, so a corrupt or
 * half-written entry fails to the quiet side. `localStorage` itself can throw —
 * Safari in private browsing, a locked-down embedded webview — and that failure
 * lands on the same answer.
 */
function storedMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

let state: PreviewState = { hash: null, status: 'idle', muted: storedMuted() }
const listeners = new Set<() => void>()

function publish(next: PreviewState): void {
  // Reference equality is the store's change signal, so only replace when
  // something actually moved.
  if (next.hash === state.hash && next.status === state.status && next.muted === state.muted) {
    return
  }

  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The state as it stands.
 *
 * Also the store's snapshot, and exported because the tests have no React to
 * render a hook into — the state machine is the thing worth checking, and it is
 * a plain object either way.
 */
export const previewState = (): PreviewState => state

const getSnapshot = previewState

/** One element and the gain stage it plays through. */
interface Deck {
  element: HTMLAudioElement
  /** Null where there is no `AudioContext`; every fade is then a cut. */
  gain: GainNode | null
  /** What it is carrying, for matching up events that arrive late. */
  hash: string | null
  /**
   * Bumped by every operation that changes what this deck is for.
   *
   * Scheduled work — the teardown at the end of a fade, the delayed start after
   * a cut — captures the token and re-checks it before acting, so a deck that
   * has been reassigned in the meantime is never stopped by an instruction
   * issued for the song it used to be playing.
   */
  token: number
  timer: ReturnType<typeof setTimeout> | null
}

let context: AudioContext | null = null
let decks: [Deck, Deck] | null = null

/** The deck carrying the current song, and the one loading the next. */
let busy: Deck | null = null
let pending: Deck | null = null

/**
 * Build the graph, once, on the first song anybody actually asks to hear.
 *
 * Lazily because a device that never unmutes has no reason to hold two media
 * elements and an audio context — which is most devices, given where the
 * default sits. The construction happens inside a click handler either way, so
 * the context starts life allowed to make sound.
 */
function ensureDecks(): [Deck, Deck] {
  if (decks !== null) return decks

  const Constructor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  try {
    context = Constructor === undefined ? null : new Constructor()
  } catch {
    // Some embedded webviews expose the constructor and refuse to build one.
    context = null
  }

  decks = [makeDeck(), makeDeck()]
  return decks
}

function makeDeck(): Deck {
  const element = new Audio()
  element.preload = 'auto'
  // The preview is ambient for as long as its song is selected. `ended`
  // consequently never fires, which is why nothing below listens for it.
  element.loop = true

  const deck: Deck = { element, gain: null, hash: null, token: 0, timer: null }

  if (context !== null) {
    try {
      const source = context.createMediaElementSource(element)
      const gain = context.createGain()
      // Silent until something fades it in. A deck that started at 1 would
      // announce the first frame of every song at full volume before its ramp
      // had a chance to be scheduled.
      gain.gain.value = 0
      source.connect(gain).connect(context.destination)
      deck.gain = gain
    } catch {
      // Routing failed, so this element plays at its own volume or not at all.
      // Better than no preview: the fades degrade to cuts and nothing else
      // about the feature changes.
      deck.gain = null
    }
  }

  element.addEventListener('playing', () => arrived(deck))
  element.addEventListener('error', () => failed(deck))

  /*
   * A pause nobody here asked for — headphones pulled out, a media key, the OS
   * taking audio focus for a call. Reported rather than fought: the song stays
   * selected, and the surface says it is not playing, which is true.
   *
   * Only from the deck that is currently carrying the song. Every pause this
   * module performs itself happens to a deck that has already been let go of,
   * so this listener never fires for one of them.
   */
  element.addEventListener('pause', () => {
    if (busy === deck && state.status === 'playing') publish({ ...state, status: 'idle' })
  })

  return deck
}

/** Take a deck away from whatever it was doing. Cancels its scheduled work. */
function claim(deck: Deck): number {
  deck.token += 1

  if (deck.timer !== null) {
    clearTimeout(deck.timer)
    deck.timer = null
  }

  return deck.token
}

/** Run something once, unless the deck has been given another job first. */
function later(deck: Deck, ms: number, run: () => void): void {
  const token = deck.token

  if (deck.timer !== null) clearTimeout(deck.timer)
  deck.timer = setTimeout(() => {
    deck.timer = null
    if (deck.token === token) run()
  }, ms)
}

function setGain(deck: Deck, value: number): void {
  if (deck.gain === null || context === null) return

  const param = deck.gain.gain
  param.cancelScheduledValues(context.currentTime)
  param.setValueAtTime(value, context.currentTime)
}

/**
 * Ramp a deck to silence or to full, and say how long that will really take.
 *
 * Returns 0 when there is no gain stage, which is what makes the no-Web-Audio
 * path fall out for free: the caller schedules its teardown for 0 ms and the
 * deck stops immediately instead of playing on at full volume through a fade
 * that is not happening.
 *
 * The equal-power curve is only used from a standing start. An interrupted fade
 * is somewhere in the middle, and `setValueCurveAtTime` begins at the curve's
 * first value whatever the parameter currently reads — so applying one to a
 * deck at 0.4 would jump it to 1 and then fade, which is worse than the click
 * it was there to prevent. Those cases get a straight line from where they are.
 */
function fadeTo(deck: Deck, target: 0 | 1, ms: number): number {
  if (deck.gain === null || context === null) return 0

  const param = deck.gain.gain
  const now = context.currentTime
  const from = param.value

  param.cancelScheduledValues(now)

  const standing = Math.abs(from - (target === 1 ? 0 : 1)) < 0.02

  if (standing) {
    param.setValueCurveAtTime(target === 1 ? RISING : FALLING, now, ms / 1000)
  } else {
    param.setValueAtTime(from, now)
    param.linearRampToValueAtTime(target, now + ms / 1000)
  }

  return ms
}

/** Stop a deck and release the file it was holding. */
function release(deck: Deck): void {
  deck.element.pause()
  // Dropping the source rather than only pausing is what cancels a download
  // still in flight, which matters on a phone that has just walked out of
  // Wi-Fi range with 200 KB of opus half-arrived.
  deck.element.removeAttribute('src')
  deck.element.load()
  setGain(deck, 0)
  deck.hash = null
}

/** Fade a deck out and let it go. */
function retire(deck: Deck, ms: number): void {
  claim(deck)
  const duration = fadeTo(deck, 0, ms)

  if (duration === 0) {
    release(deck)
    return
  }

  later(deck, duration, () => release(deck))
}

/** Point a deck at a song and start it, silently — the fade comes on arrival. */
function loadInto(deck: Deck, hash: string): void {
  const token = claim(deck)
  deck.hash = hash

  const begin = () => {
    if (deck.token !== token) return

    setGain(deck, 0)
    deck.element.src = previewUrl(hash)
    // Suspended contexts are the normal state until a gesture, and every path
    // here is inside one. Asking each time costs nothing and covers the tab
    // that was backgrounded long enough for the browser to suspend it.
    void context?.resume()

    void deck.element.play().catch(() => {
      /*
       * The file 404'd, the format is unsupported, or — the common one — the
       * source was swapped out from under a `play()` that had not resolved yet,
       * which rejects with `AbortError`. Only the first two are worth
       * reporting, and the token is how they are told apart: a stale rejection
       * belongs to a deck that has since been given a different song.
       */
      if (deck.token === token) failed(deck)
    })
  }

  /*
   * A deck that is still making sound cannot simply be handed a new `src` —
   * that cuts its audio mid-waveform, which is a click. Duck it first and start
   * a moment later; 60 ms is inaudible next to a preview that takes an order of
   * magnitude longer than that to arrive.
   */
  const audible = deck.gain !== null && deck.gain.gain.value > 0.01

  if (audible) {
    fadeTo(deck, 0, CUT_MS)
    later(deck, CUT_MS, begin)
  } else {
    begin()
  }
}

/** A loading deck has produced sound: fade it in and let the other one go. */
function arrived(deck: Deck): void {
  if (pending !== deck) return

  pending = null

  // Whatever was playing has already been sent on its way by `start`; this is
  // only the incoming half. Keeping the two halves apart is what lets the
  // outgoing song begin fading the instant somebody picks another one, rather
  // than a second later when the new file finally arrives.
  fadeTo(deck, 1, CROSSFADE_MS)
  busy = deck

  if (deck.hash === state.hash) publish({ ...state, status: 'playing' })
}

/** A deck could not play what it was given. */
function failed(deck: Deck): void {
  // Read before the teardown, which clears it: what matters is whether the deck
  // was carrying the song that is *still selected*. A failure reported by a
  // deck that has already moved on is somebody else's history.
  const hash = deck.hash

  if (pending === deck) {
    pending = null
    claim(deck)
    release(deck)
  } else if (busy === deck) {
    busy = null
    retire(deck, 0)
  } else {
    return
  }

  if (hash === state.hash) publish({ ...state, status: 'idle' })
}

/**
 * Start a song, crossfading out whatever is playing.
 *
 * Called once the selection has settled, never on the way past — see
 * `SETTLE_MS`. By the time this runs, the song is one somebody has actually
 * stopped on.
 *
 * The outgoing fade begins here rather than when the new song arrives. On a
 * warm cache the two overlap and it is a true crossfade; on a cold one — where
 * the server is generating the preview and can take a second over it — the old
 * song fades out on time and the new one fades in when it exists. The
 * alternative, holding the old song at full volume until the new one is ready,
 * makes a tap feel like it did not register.
 */
function start(hash: string): void {
  const pair = ensureDecks()

  /*
   * Reclaim the loading deck if there is one — somebody changing their mind
   * before the first song arrived means that deck's job is simply now a
   * different song. Otherwise take whichever deck is not carrying the current
   * one, which is also the right answer while a deck is fading out: that deck
   * is `busy` until its fade is scheduled, and the other is free.
   */
  const deck = pending ?? (busy === pair[0] ? pair[1] : pair[0])

  if (busy !== null && busy !== deck) {
    retire(busy, CROSSFADE_MS)
    busy = null
  }

  pending = deck
  loadInto(deck, hash)
}

/**
 * Fade out whatever is audible and drop whatever is loading.
 *
 * The loading deck is at zero gain by definition, so it is cut rather than
 * faded: fading silence is a delay, not a transition, and it would keep a
 * download alive for the length of it.
 */
function stop(ms: number): void {
  if (pending !== null) {
    claim(pending)
    release(pending)
    pending = null
  }

  if (busy !== null) {
    retire(busy, ms)
    busy = null
  }
}

/** The pending "the selection has stopped moving" callback, if there is one. */
let settleTimer: ReturnType<typeof setTimeout> | null = null

/** A key that moves the selection is down. */
let holding = false
/** That key has begun to repeat, so the selection is running rather than stepping. */
let scrolling = false

function cancelSettle(): void {
  if (settleTimer === null) return

  clearTimeout(settleTimer)
  settleTimer = null
}

/** Wait for the selection to stop, then play what it stopped on. */
function armSettle(hash: string): void {
  cancelSettle()

  settleTimer = setTimeout(() => {
    settleTimer = null

    // Both can have changed while this was waiting: another song, or a mute.
    if (state.hash !== hash || state.muted) return

    // A key still down means the walk is not over, whatever the clock says —
    // re-arm and ask again rather than committing into the middle of it.
    if (holding) {
      armSettle(hash)
      return
    }

    start(hash)
  }, SETTLE_MS)
}

/**
 * Report the keyboard walking the list.
 *
 * Two facts, because they do different jobs and arrive at different moments:
 *
 * `holding` is a key that moves the selection being down. Nothing commits while
 * it is, which is what makes a hold safe on a keyboard that waits a full second
 * before it starts repeating — the timer above cannot know that gap is coming
 * and this does not have to guess.
 *
 * `repeating` is that key having begun to repeat, which is the difference
 * between stepping to the next song and scrolling through the list. A scroll is
 * not a song anybody has chosen, so whatever is playing gets faded out at once
 * rather than carried along underneath a hundred rows it has nothing to do with.
 */
export function setPreviewNavigating(holdingNow: boolean, repeating: boolean): void {
  const wasHolding = holding
  holding = holdingNow

  if (repeating && !scrolling) {
    scrolling = true
    stop(FADE_OUT_MS)
    if (state.status !== 'idle') publish({ ...state, status: 'loading' })
  }

  if (holdingNow) return

  scrolling = false

  /*
   * Released. Anything that was waiting on the key should now land a settle
   * from *here* rather than from the last keypress, which may have been a
   * second ago while the key was still being held down.
   */
  if (wasHolding && settleTimer !== null && state.hash !== null) armSettle(state.hash)
}

/**
 * Say which song is selected, or that none is.
 *
 * The one entry point the app calls as the selection moves, which is why it
 * takes the settle rather than making every caller remember to: `SongList`
 * walks the selection from the arrow keys and has no idea whether the key is
 * being tapped or held.
 *
 * Idempotent on the hash, which matters more than it looks: the selected `Song`
 * object is recreated whenever the library reloads, and re-running this on the
 * same song would restart the audio from zero for something nobody did.
 */
export function setPreviewSong(hash: string | null): void {
  if (hash === state.hash) return

  /*
   * Whether the selection is *running* rather than stepping — under a repeating
   * key, or moving again before the last move had settled.
   *
   * A run silences what is playing. A single step does not: it leaves the
   * current song up until the new one is ready to take over, which is what
   * makes the handover a crossfade instead of a gap. Reading a pending settle
   * as movement is what makes that true of a hand on a mouse as well as a hand
   * on a key.
   */
  const running = scrolling || settleTimer !== null

  cancelSettle()

  if (hash === null || state.muted) {
    stop(FADE_OUT_MS)
    publish({ ...state, hash, status: 'idle' })
    return
  }

  if (running) stop(FADE_OUT_MS)

  // `loading` from the moment it is chosen, not from the moment it is fetched.
  // The wait is part of getting this song, and saying so is the honest report
  // while the previous one is still playing underneath.
  publish({ ...state, hash, status: 'loading' })
  armSettle(hash)
}

/**
 * Turn the sound on or off, and remember which.
 *
 * **Must be called from a user gesture**, and every caller is a click handler.
 * Unmuting starts the selected song synchronously inside that handler, which is
 * what satisfies the autoplay policy — and is also just the right behaviour:
 * tapping "play previews" while looking at a song should play that song.
 */
export function setPreviewMuted(muted: boolean): void {
  if (muted === state.muted) return

  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? 'true' : 'false')
  } catch {
    // A device that cannot store the preference still honours it for this
    // session. Nothing here is worth failing a click over.
  }

  // Either way this settles the question now, so a scroll that was waiting to
  // land must not arrive after it and start playing something.
  cancelSettle()

  if (muted) {
    // Faded rather than cut, for the same reason leaving a song is: this is a
    // decision about a room, and a hard stop reads as something breaking.
    stop(FADE_OUT_MS)
    publish({ ...state, muted, status: 'idle' })
    return
  }

  const hash = state.hash
  publish({ ...state, muted, status: hash === null ? 'idle' : 'loading' })
  // Immediately, and synchronously inside the click: this is the gesture the
  // autoplay policy is asking for, and it does not survive a timer.
  if (hash !== null) start(hash)
}

/**
 * The sound preference and what it is currently doing.
 *
 * `status` is here for the surface that wants to say something while a cold
 * preview is being generated — that takes about a second the first time a song
 * is asked for, and it is the one wait in this feature a person can notice.
 */
export function usePreviewSound(): {
  muted: boolean
  status: PreviewStatus
  toggle: () => void
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const toggle = useCallback(() => setPreviewMuted(!current.muted), [current.muted])

  return { muted: current.muted, status: current.status, toggle }
}
