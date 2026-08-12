/**
 * The demo's stand-in server, running inside the page.
 *
 * The client talks to exactly four things: `GET /api/songs`, `GET
 * /api/now-playing`, the `GET /api/events` SSE stream, and the art routes. This
 * module answers the first three by replacing `fetch` and `EventSource` on the
 * window, and `lib/api.ts` handles the fourth by pointing at a generated data
 * URI instead of a URL. **Nothing in the app knows the difference**, which is
 * the whole reason it is done at this seam: the demo exercises the real hooks,
 * the real reconnection handling and the real components rather than a second
 * copy of them wired to fixtures.
 *
 * ## Why the now-playing feed moves
 *
 * The banner, the venue wash, the "now playing" row highlight and the route from
 * the banner into a song's details are four features that only exist while YARG
 * is running, so a demo with a dead feed would be a demo missing its top edge.
 * A small state machine plays a song for a while, goes idle for a moment, and
 * moves on — with stage lighting drifting underneath it, which is what the wash
 * in `features/nowPlaying/venueWash.ts` is reading.
 *
 * The sequence is fixed, not random, for the same reason the library is seeded:
 * two people looking at the demo side by side should see the same thing.
 */

import type { NowPlaying, NowPlayingSong, Song, SongLibrary, VenueState } from '@shared/types'
import type { LightingCue, PostProcessing } from '@shared/types'
import { buildMockLibrary } from './library'

/** How long a demo song "plays" before the feed moves on. */
const PLAY_MS = 46_000

/** And how long YARG sits in its menus in between. */
const IDLE_MS = 9_000

/** How often the stage lighting changes while a song is playing. */
const VENUE_MS = 5_500

/**
 * Cues worth showing, which is not all of them.
 *
 * The blackouts and the strobes are deliberately absent: one draws nothing, and
 * the other never reaches a client — see the notes in `venueWash.ts`. These are
 * the ones that produce a colour.
 */
const CUES: readonly LightingCue[] = [
  'warmAutomatic',
  'coolAutomatic',
  'searchlights',
  'sweep',
  'harmony',
  'stomp',
  'frenzy',
  'intro',
  'silhouettes',
  'dischord',
  'bigRockEnding',
]

const GRADES: readonly PostProcessing[] = [
  'default',
  'bloom',
  'contrastRed',
  'desaturatedBlue',
  'sepiaTone',
  'grainyFilm',
  'trails',
  'scanlinesBlue',
  'photoNegative',
]

const VENUE_OFF: VenueState = {
  streaming: false,
  cue: null,
  grade: null,
  section: null,
  bpm: null,
}

/** The library, built once and shared by every route that answers from it. */
let library: SongLibrary | null = null

function getLibrary(): SongLibrary {
  library ??= buildMockLibrary()
  return library
}

// --- The simulated feed -----------------------------------------------------

type Sink = (event: string, payload: unknown) => void

const sinks = new Set<Sink>()

let nowPlaying: NowPlaying = { playing: false, song: null, updatedAt: 0 }
let venue: VenueState = VENUE_OFF
let timers: number[] = []
let step = 0
/**
 * Whether the machine is turning.
 *
 * Its own flag rather than "are there timers" or "is something playing": the
 * gap between songs has no timer of its own to test, and a stream that dropped
 * mid-song and came back would otherwise find `playing` still true and decline
 * to restart, leaving the banner frozen on a song forever.
 */
let running = false

function publish(event: string, payload: unknown): void {
  for (const sink of sinks) sink(event, payload)
}

/**
 * Turn a library song into the shape `currentSong.json` produces.
 *
 * The fields are a strict subset — the real file also carries the chart's
 * location on disk, which is why the server resolves it and never forwards it.
 */
function toNowPlaying(song: Song): NowPlayingSong {
  return {
    hash: song.hash,
    libraryId: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album,
    genre: song.genre,
    charter: song.charter,
    source: song.source,
    year: song.year,
    lengthSeconds: song.lengthSeconds,
    bandDifficulty: song.bandDifficulty,
    vocalsCount: song.vocalParts,
    isMaster: song.isMaster,
    albumTrack: song.albumTrack,
    hasArt: song.hasArt,
  }
}

/**
 * The songs the demo plays, spread across the library.
 *
 * Walking a prime stride means consecutive picks come from different artists,
 * packs and genres, so the banner shows a different source badge and a different
 * cover each time rather than four tracks off one album.
 */
function playlist(songs: readonly Song[]): readonly Song[] {
  const picks: Song[] = []
  const stride = 137

  for (let index = 0; index < 24; index += 1) {
    const song = songs[(index * stride + 11) % songs.length]
    if (song !== undefined) picks.push(song)
  }

  return picks
}

function setNowPlaying(next: NowPlaying): void {
  nowPlaying = next
  publish('now-playing', next)
}

function setVenue(next: VenueState): void {
  venue = next
  publish('venue', next)
}

function later(fn: () => void, ms: number): void {
  timers.push(window.setTimeout(fn, ms))
}

/** One turn of the machine: start a song, drift its lighting, stop, repeat. */
function advance(): void {
  // Every timer from the previous turn has fired by the time this runs — this
  // is the callback of the last of them — so the list can be dropped rather
  // than grown for as long as the tab is open.
  timers = []

  const songs = playlist(getLibrary().songs)
  const song = songs[step % songs.length]
  step += 1

  if (song === undefined) return

  setNowPlaying({ playing: true, song: toNowPlaying(song), updatedAt: Date.now() })

  // A tempo per song, derived from its hash so it is stable, in the range the
  // wash actually reads — it paces the colour drift and nothing else.
  const bpm = 84 + (Number.parseInt((song.hash ?? '5a').slice(0, 2), 16) % 96)

  const paint = (index: number) => {
    setVenue({
      streaming: true,
      cue: CUES[(step * 3 + index) % CUES.length] ?? 'coolAutomatic',
      grade: GRADES[(step + index * 2) % GRADES.length] ?? 'default',
      // Verses and choruses alternate, which is what the chart's venue track
      // is actually saying when this field is set.
      section: index % 2 === 0 ? 'verse' : 'chorus',
      bpm,
    })
  }

  paint(0)
  for (let index = 1; index * VENUE_MS < PLAY_MS; index += 1) {
    later(() => paint(index), index * VENUE_MS)
  }

  later(() => {
    setNowPlaying({ playing: false, song: null, updatedAt: Date.now() })
    setVenue(VENUE_OFF)
    later(advance, IDLE_MS)
  }, PLAY_MS)
}

function startFeed(): void {
  if (running) return

  running = true
  advance()
}

function stopFeed(): void {
  running = false
  for (const timer of timers) window.clearTimeout(timer)
  timers = []
}

// --- The `fetch` half -------------------------------------------------------

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(): void {
  const original = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, window.location.href).pathname

    // Anything that isn't the API is a real request — the bundle's own assets,
    // for one — and has to go through untouched.
    if (!path.includes('/api/')) return original(input, init)

    const route = path.slice(path.indexOf('/api/') + 4)

    if (route === '/songs') return json(getLibrary())
    if (route === '/now-playing') return json(nowPlaying)

    /*
     * `/health` and `/capabilities` are the two the client could plausibly ask
     * for; answering them keeps a probe from looking like an outage. Everything
     * else 404s exactly as the real server would for an unknown route —
     * including the art and preview routes, which the demo never reaches
     * because `lib/api.ts` hands out data URIs instead.
     */
    if (route === '/health') return json({ ok: true })
    if (route === '/capabilities') return json({ settings: false, media: false })

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
}

// --- The `EventSource` half -------------------------------------------------

/**
 * Enough of `EventSource` for `lib/events.ts`, which is the only consumer.
 *
 * An `EventTarget` subclass rather than an object with a listener list, so
 * `addEventListener` and the `MessageEvent` shape are the browser's own and the
 * app's `(raw as MessageEvent<string>).data` reads real event data — including
 * the `JSON.parse`, since the payloads are serialised here exactly as the
 * server serialises them.
 */
class MockEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2

  readonly url: string
  readonly withCredentials = false
  readyState = 0

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private readonly sink: Sink

  constructor(url: string) {
    super()
    this.url = new URL(url, window.location.href).href

    this.sink = (event, payload) => {
      this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(payload) }))
    }

    // A tick of latency, because opening synchronously inside the constructor
    // would fire `open` before the caller has attached its listener — which no
    // real EventSource can do, and which would leave the connection indicator
    // stuck reading "offline".
    window.setTimeout(() => {
      if (this.readyState === MockEventSource.CLOSED) return

      this.readyState = MockEventSource.OPEN
      sinks.add(this.sink)
      this.dispatchEvent(new Event('open'))
      this.onopen?.(new Event('open'))

      startFeed()

      // The server sends the current state to every new subscriber, so a phone
      // that connects mid-song sees the song rather than waiting for the next
      // one. Same here.
      this.sink('now-playing', nowPlaying)
      this.sink('venue', venue)
    }, 60)
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED
    sinks.delete(this.sink)

    // The feed's timers are the demo's only recurring work; with nobody
    // listening there is no reason to keep them running.
    if (sinks.size === 0) stopFeed()
  }
}

/**
 * Point the app's network calls at the simulation.
 *
 * Called once, before React mounts, so the first `fetch` the app makes already
 * lands here.
 */
export function installMockBackend(): void {
  installFetch()
  window.EventSource = MockEventSource as unknown as typeof EventSource
}
