/**
 * The now-playing banner.
 *
 * Follows the design system's "Currently Playing" language: album art under a
 * double scrim (one vertical, one horizontal) so text stays legible against any
 * artwork, over the card surface.
 *
 * **The banner is a fixed height in every state.** Songs start and stop while
 * people are mid-scroll, and a banner that grows or shrinks on each transition
 * shoves the list under their finger. The idle state fills the same box rather
 * than collapsing.
 */

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import type { NowPlaying } from '@shared/types'
import { Badge, ChevronRight, cx } from '../../ui'
import { SourceBadge } from '../../ui/library'
import { currentArtUrl } from '../../lib/api'
import { formatDuration, formatVocalParts } from '../../lib/format'
import { useVenue } from '../../lib/useVenue'
import { useVenueWash } from './venueWash'
import type { VenueWash } from './venueWash'

/** Tall enough for the badge, title and artist stack without clipping. */
const BANNER_HEIGHT = 92

/** The design's double scrim, laid over album art. */
const SCRIM =
  'linear-gradient(180deg, transparent -6.67%, #070910 103.33%), linear-gradient(90deg, transparent -119%, #070910 70.56%)'

export function NowPlayingBar({
  nowPlaying,
  connected,
  settled,
  onSelect,
}: {
  nowPlaying: NowPlaying
  connected: boolean
  /** False until the server has answered once, either way. */
  settled: boolean
  /**
   * Opens this song's details, or null when it can't be opened.
   *
   * Null whenever the playing song's hash doesn't join the library — the
   * exported CSV is a snapshot, so YARG can be playing a chart added since the
   * last export. The banner still names it; there is just nothing more to show.
   *
   * This is the only route to the playing song's details that doesn't involve
   * finding it: it can be three thousand rows down, and nobody is going to
   * scroll there to see what the drums are like.
   */
  onSelect: (() => void) | null
}) {
  const song = nowPlaying.song
  const playing = nowPlaying.playing && song !== null

  /*
   * The venue hook lives here rather than in `App`, unlike the other two.
   *
   * Nothing else on the page has any use for stage lighting, and `events.ts`
   * hands out one shared connection however many hooks subscribe — so lifting
   * it would buy nothing and cost a prop through every render of the shell.
   */
  const wash = useVenueWash(useVenue())

  return (
    <Shell
      wash={wash}
      backdrop={
        playing && song.hasArt ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `${SCRIM}, url("${currentArtUrl(song.hash)}")` }}
          />
        ) : null
      }
    >
      {playing ? (
        <>
          <AlbumArt hash={song.hash} hasArt={song.hasArt} />

          {/*
           * The whole text block is the target when there is something to open.
           * It renders as a plain `div` otherwise rather than a disabled button,
           * because a control that is sometimes inert is worse than a display
           * that is sometimes a control — and the "details" cue appears and
           * disappears with it, so nothing ever invites a press that does
           * nothing.
           */}
          <Content
            onSelect={onSelect}
            label={`Show details for ${song.name} by ${song.artist}`}
          >
            <div className="mb-[5px] flex items-center gap-[10px]">
              <Badge tone="accent">Now playing</Badge>
              {/* Where the chart came from, as a mark rather than a word. */}
              <SourceBadge source={song.source} size={16} showName={false} />
              {!connected ? <Badge title="Live updates interrupted">offline</Badge> : null}
              {onSelect ? (
                <span
                  aria-hidden
                  // Beside the badges rather than pushed to the far edge: the
                  // block is `flex-1`, so on a wide monitor `ml-auto` threw
                  // this 900px away from the title it opens and parked it next
                  // to the length/band/vocals stats, where it read as their
                  // heading.
                  className="yarg-label flex shrink-0 items-center gap-[5px] text-[10px] text-content-muted transition-colors duration-160 group-hover:text-white"
                >
                  details
                  <ChevronRight />
                </span>
              ) : null}
            </div>

            <p dir="auto" className="truncate-tight text-[22px] leading-none font-semibold text-white">
              {song.name}
            </p>
            <p
              dir="auto"
              className="mt-[5px] truncate-tight text-[17px] leading-none font-medium text-content-secondary italic"
            >
              {song.artist}
              {song.album ? (
                <span className="text-content-muted not-italic"> — {song.album}</span>
              ) : null}
            </p>
          </Content>

          <dl className="hidden shrink-0 gap-[25px] text-right sm:flex">
            <Detail label="length" value={formatDuration(song.lengthSeconds)} />
            <Detail
              label="band"
              value={song.bandDifficulty === null ? '—' : String(song.bandDifficulty)}
            />
            <Detail label="vocals" value={formatVocalParts(song.vocalsCount)} />
          </dl>
        </>
      ) : (
        <>
          <PlaceholderArt />
          <div className="min-w-0 flex-1">
            {/*
             * Three states, not two. Before `settled` we have simply not heard
             * back yet — saying "Reconnecting" there told every guest the app
             * was broken during the first second of every visit, because the
             * connection flag starts false and nothing distinguished "never
             * tried" from "lost it".
             */}
            <p className="yarg-label text-[15px] text-content-muted">
              {settled ? 'Nothing playing' : 'Connecting'}
            </p>
            <p className="mt-[5px] truncate text-[14px] text-content-faint">
              {!settled
                ? 'Checking what YARG is up to'
                : connected
                  ? 'Waiting for YARG to start a song'
                  : 'Reconnecting to the server'}
            </p>
          </div>
        </>
      )}
    </Shell>
  )
}

/** The banner's text block: a button when it opens something, a div when not. */
function Content({
  onSelect,
  label,
  children,
}: {
  onSelect: (() => void) | null
  label: string
  children: ReactNode
}) {
  if (onSelect === null) return <div className="min-w-0 flex-1">{children}</div>

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      className={cx(
        'yarg-focusable min-w-0 flex-1 cursor-pointer text-left',
        // Nothing moves and nothing scales — the banner's whole job is holding
        // still while someone is mid-scroll. The cue is the "details" chevron
        // above brightening, which costs no layout at all.
        'group transition-colors duration-160',
      )}
    >
      {children}
    </button>
  )
}

/** Fixed-height frame shared by both states — the thing that stops the shift. */
function Shell({
  backdrop,
  wash,
  children,
}: {
  backdrop: ReactNode
  wash: VenueWash
  children: ReactNode
}) {
  return (
    /*
     * `isolate` is load-bearing: the wash below blends with what is painted
     * under it, and without a stacking context here that reaches past the
     * banner and lifts the song list too.
     */
    <div
      className="relative isolate shrink-0 overflow-hidden bg-surface-card"
      style={{ height: BANNER_HEIGHT }}
    >
      {backdrop}
      <div
        aria-hidden
        className="venue-wash"
        style={{
          backgroundColor: wash.color ?? 'transparent',
          opacity: wash.opacity,
          // The fade fills the whole gap between colours, so the wash is always
          // mid-transition rather than resting and then switching.
          '--venue-fade': `${wash.fadeMs}ms`,
        } as CSSProperties}
      />
      <div className="relative flex h-full items-center gap-[15px] px-[25px]">{children}</div>
    </div>
  )
}

/** Numbers are shown, not described: bright value, dim unit label. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="yarg-label text-[10px] text-count-muted">{label}</dt>
      <dd className="font-numeric mt-[5px] text-[15px] text-count">{value}</dd>
    </div>
  )
}

function PlaceholderArt() {
  return (
    <div
      className="flex size-[56px] shrink-0 items-center justify-center bg-surface-sunken text-content-faint"
      style={{ borderRadius: 'var(--radius-md)' }}
      aria-hidden
    >
      <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="1.75" fill="currentColor" />
      </svg>
    </div>
  )
}

/**
 * Album art thumbnail, or the placeholder disc.
 *
 * `hasArt` is false for packed chart containers, whose art lives inside the
 * archive. `onError` additionally covers the chart moving or a network share
 * dropping between the scan and the request.
 */
function AlbumArt({ hash, hasArt }: { hash: string | null; hasArt: boolean }) {
  const [failed, setFailed] = useState(false)

  if (!hasArt || failed) return <PlaceholderArt />

  return (
    <img
      key={hash ?? 'none'}
      src={currentArtUrl(hash)}
      alt=""
      onError={() => setFailed(true)}
      className="size-[56px] shrink-0 bg-surface-sunken object-cover"
      style={{
        borderRadius: 'var(--radius-md)',
        boxShadow: 'inset 0 0 0 2px var(--yarg-border-card)',
      }}
    />
  )
}
