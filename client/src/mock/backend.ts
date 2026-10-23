/**
 * The demo's stand-in server, running inside the page.
 *
 * The client talks to exactly five things: `GET /api/songs`, `GET
 * /api/now-playing`, the `GET /api/events` SSE stream, the setlist routes
 * (`GET /api/setlist` and the three edits under `/api/setlist/entries`), and the
 * art routes. This module answers the first four by replacing `fetch` and
 * `EventSource` on the window, and `lib/api.ts` handles the fifth by pointing at
 * a generated data URI instead of a URL. **Nothing in the app knows the
 * difference**, which is the whole reason it is done at this seam: the demo
 * exercises the real hooks, the real reconnection handling and the real
 * components rather than a second copy of them wired to fixtures.
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
 *
 * ## The songs come from the setlist
 *
 * The setlist is the other thing that only exists while YARG is running, and
 * it is not independent of the banner: during a show the setlist's current
 * entry and the song playing are the same song, and the UI checks that they
 * are. So the machine is a show cycle and the songs it plays are whatever the
 * setlist holds, guests' additions included:
 *
 *   picking   active, no show; the host queues a song every `PICK_MS` until
 *             there are `SHOW_SONGS` of their own
 *   parts     the show has started and players are choosing parts; every
 *             edit answers `locked` for `PARTS_MS`
 *   playing   the current entry plays for `PLAY_MS`
 *   score     the score screen for `IDLE_MS`, still active, still the same
 *             `currentIndex`; then Continue moves to the next entry or ends
 *             the show
 *   away      the show is over and YARG is in its menus: inactive for
 *             `AWAY_MS`, with the finished show still on the wire
 *
 * and then the library opens again, active and empty — the "cleared" moment —
 * and picking starts over. The demo opens mid-show, on the first song, because
 * an empty banner is the wrong first impression; the picking half is a few
 * minutes in. The setlist's own rules, and how much of them is a guess at
 * YARG's, are in `setlist.ts`.
 */

import type { NowPlaying, NowPlayingSong, Song, SongLibrary, VenueState } from '@shared/types'
import type {
  LightingCue,
  PostProcessing,
  SetlistEditResult,
  SetlistPlacement,
} from '@shared/types'
import { buildMockLibrary } from './library'
import { hashIndex, MockSetlist } from './setlist'

/** How long a demo song "plays" before the feed moves on. */
const PLAY_MS = 46_000

/** And how long YARG sits on the score screen in between. */
const IDLE_MS = 9_000

/**
 * The host's own picks per show, and how far apart they land.
 *
 * Four songs is a show of about four minutes, short enough that somebody
 * watching the demo sees the whole cycle; a few seconds between picks is slow
 * enough to watch the list grow and quick enough not to be waited on.
 */
const SHOW_SONGS = 4
const PICK_MS = 4_000

/** Players choosing parts before the first song, when YARG holds every edit. */
const PARTS_MS = 6_000

/**
 * How long YARG stays out of the library after a show.
 *
 * Long enough to read the stale setlist for what it is, and well inside
 * `lib/events.ts`'s stall watchdog: nothing else is sent while it lasts, and a
 * silence that long would have the client tear down a healthy stream.
 */
const AWAY_MS = 15_000

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

let songsByHash: ReadonlyMap<string, Song> | null = null

function songFor(hash: string): Song | undefined {
  songsByHash ??= hashIndex(getLibrary().songs)
  return songsByHash.get(hash)
}

// --- The simulated feed -----------------------------------------------------

type Sink = (event: string, payload: unknown) => void

const sinks = new Set<Sink>()

let nowPlaying: NowPlaying = { playing: false, song: null, updatedAt: 0 }
let venue: VenueState = VENUE_OFF
let timers: number[] = []
let step = 0

type Phase = 'picking' | 'parts' | 'playing' | 'score' | 'away'

/** Where the show cycle is, so a stream that drops and comes back resumes it. */
let phase: Phase = 'playing'
let setlist: MockSetlist | null = null
/** The host's picks so far this cycle, and where in `hostPicks` the next one comes from. */
let picked = 0
let pickCursor = 0
let hostPickList: readonly Song[] | null = null
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

/**
 * What the host queues: the same picks, less the songs without vocals.
 *
 * The demo band has a singer — see `incompatible` in `setlist.ts` — and a
 * host queueing songs their own band can't play would be a demo contradicting
 * its own rule.
 */
function hostPicks(): readonly Song[] {
  hostPickList ??= playlist(getLibrary().songs).filter((song) => song.vocalParts > 0)
  return hostPickList
}

/**
 * YARG's setlist, made on first use already part-way into a show.
 *
 * The first `SHOW_SONGS` picks are queued and the show is on its first song,
 * so a demo that has just loaded has a banner and a setlist that agree. Built
 * before it is published at all: the first stream would otherwise watch a
 * setlist that has always existed fill up in a single tick.
 */
function getSetlist(): MockSetlist {
  if (setlist !== null) return setlist

  const made = new MockSetlist(getLibrary().songs, (state) => {
    if (setlist !== null) publish('setlist', state)
  })

  for (let index = 0; index < SHOW_SONGS; index += 1) hostPick(made)
  made.beginShow()
  phase = 'playing'

  setlist = made
  return made
}

/** Queue the host's next pick, stepping past any a guest already added. */
function hostPick(into: MockSetlist): void {
  const songs = hostPicks()

  for (let tries = 0; tries < songs.length; tries += 1) {
    const song = songs[pickCursor % songs.length]
    pickCursor += 1
    if (song !== undefined && into.hostAdd(song)) return
  }
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

/*
 * The show cycle, one function per phase.
 *
 * Each phase is entered from the last timer of the one before it, so each
 * starts by dropping the timer list: everything in it has fired by then — this
 * is the callback of the last of them — and the list would otherwise grow for
 * as long as the tab is open.
 */

/** The host queueing songs, one per `PICK_MS`, then starting the show. */
function picking(): void {
  timers = []
  phase = 'picking'

  if (picked < SHOW_SONGS) {
    picked += 1
    hostPick(getSetlist())
    later(picking, PICK_MS)
    return
  }

  beginShow()
}

function beginShow(): void {
  timers = []
  phase = 'parts'

  // Only an empty setlist can't start, and only the host's picks could have
  // filled it, which guests can't remove — but there is no show without one.
  if (!getSetlist().beginShow()) {
    picked = 0
    later(picking, PICK_MS)
    return
  }

  later(play, PARTS_MS)
}

/** One song of the show: start it, drift its lighting, then the score screen. */
function play(): void {
  timers = []
  phase = 'playing'

  const entry = getSetlist().startSong()
  const song = entry === null ? undefined : songFor(entry.hash)
  step += 1

  if (song === undefined) {
    endShow()
    return
  }

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
    phase = 'score'
    setNowPlaying({ playing: false, song: null, updatedAt: Date.now() })
    setVenue(VENUE_OFF)
    later(continueShow, IDLE_MS)
  }, PLAY_MS)
}

/** The score screen's Continue: the next entry, or the end of the show. */
function continueShow(): void {
  timers = []

  if (getSetlist().continueShow()) play()
  else endShow()
}

function endShow(): void {
  timers = []
  phase = 'away'

  getSetlist().endShow()
  later(reopen, AWAY_MS)
}

/** Back in the library, with the setlist wiped. */
function reopen(): void {
  timers = []
  phase = 'picking'
  picked = 0

  getSetlist().reopen()
  later(picking, PICK_MS)
}

/**
 * Pick the cycle up where it stopped.
 *
 * A song restarts from the top rather than resuming part-way, and a score
 * screen skips to Continue; the other phases start again from their beginning.
 * Nothing is replayed that a phone already saw: the host's pick count and the
 * setlist itself carry over.
 */
function startFeed(): void {
  if (running) return

  running = true
  getSetlist()

  switch (phase) {
    case 'picking':
      picking()
      break
    case 'parts':
      beginShow()
      break
    case 'playing':
      play()
      break
    case 'score':
      continueShow()
      break
    case 'away':
      endShow()
      break
  }
}

function stopFeed(): void {
  running = false
  for (const timer of timers) window.clearTimeout(timer)
  timers = []
}

// --- The `fetch` half -------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function notFound(): Response {
  return json({ error: 'Not found' }, 404)
}

/*
 * The setlist edits, checked the way `server/src/api/routes.ts` checks them:
 * the same 400s for a missing guest token or a malformed body, and the same
 * status per outcome, so a phone reading only the status hears what it would
 * from the real server.
 */

const GUEST_TOKEN = /^[A-Za-z0-9_-]{16,64}$/
const GUEST_HINT = 'Send X-YASS-Guest: a random token this browser keeps.'
const ENTRY_ROUTE = /^\/setlist\/entries\/([^/]+)(\/move)?$/

async function editSetlist(request: Request, route: string): Promise<Response> {
  const entries = route === '/setlist/entries'
  const entryRoute = ENTRY_ROUTE.exec(route)
  const isMove = entryRoute?.[2] !== undefined

  const known = entries
    ? request.method === 'POST'
    : entryRoute !== null && request.method === (isMove ? 'POST' : 'DELETE')
  if (!known) return notFound()

  const guest = request.headers.get('x-yass-guest')
  if (guest === null || !GUEST_TOKEN.test(guest)) return json({ error: GUEST_HINT }, 400)

  const body = request.method === 'POST' ? await readJson(request) : null

  if (entries) {
    const hash = typeof body?.hash === 'string' ? body.hash.trim() : ''
    if (!/^[0-9a-fA-F]{40}$/.test(hash)) return json({ error: 'Body must name a song hash.' }, 400)

    return editResponse(getSetlist().add(guest, hash.toUpperCase()))
  }

  const entryId = parseEntryId(entryRoute?.[1] ?? '')
  if (entryId === null) return json({ error: 'Not an entry ID.' }, 400)

  if (!isMove) return editResponse(getSetlist().remove(guest, entryId))

  const placement = parsePlacement(body)
  if (placement === null) {
    return json({ error: 'Body must be {position: start|end} or {position: after, anchorId}.' }, 400)
  }

  return editResponse(getSetlist().move(guest, entryId, placement))
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** YARG's IDs are u32 and start at 1. */
function parseEntryId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null
  const id = Number(raw)
  return id >= 1 && id <= 0xffffffff ? id : null
}

function parsePlacement(body: Record<string, unknown> | null): SetlistPlacement | null {
  if (body?.position === 'start' || body?.position === 'end') return { position: body.position }

  if (body?.position === 'after' && typeof body.anchorId === 'number') {
    const anchorId = parseEntryId(String(body.anchorId))
    return anchorId === null ? null : { position: 'after', anchorId }
  }

  return null
}

function editResponse(result: SetlistEditResult): Response {
  if (result.ok) return json(result)

  switch (result.reason) {
    case 'editsOff':
    case 'notYours':
      return json(result, 403)
    case 'unavailable':
    case 'connectionLost':
      return json(result, 503)
    case 'failed':
      return json(result, 502)
    default:
      return json(result, 409)
  }
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
    if (route === '/setlist') return json(getSetlist().state)
    if (route.startsWith('/setlist/')) return editSetlist(new Request(input, init), route)

    /*
     * `/health` and `/capabilities` are the two the client could plausibly ask
     * for; answering them keeps a probe from looking like an outage. Everything
     * else 404s exactly as the real server would for an unknown route —
     * including the art and preview routes, which the demo never reaches
     * because `lib/api.ts` hands out data URIs instead.
     */
    if (route === '/health') return json({ ok: true })
    if (route === '/capabilities') return json({ settings: false, media: false })

    return notFound()
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

    // A tick of latency: events sent inside the constructor would beat the
    // caller's listeners, which no real EventSource can do, and `lib/events.ts`
    // would wait for a first event that had already gone by.
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
      this.sink('setlist', getSetlist().state)
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
