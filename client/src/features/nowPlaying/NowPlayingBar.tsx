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
import type { ReactNode } from 'react'

import type { NowPlaying } from '@shared/types'
import { Badge } from '../../ui'
import { SourceBadge } from '../../ui/library'
import { currentArtUrl } from '../../lib/api'
import { formatDuration, formatVocalParts } from '../../lib/format'

/** Tall enough for the badge, title and artist stack without clipping. */
const BANNER_HEIGHT = 92

/** The design's double scrim, laid over album art. */
const SCRIM =
  'linear-gradient(180deg, transparent -6.67%, #070910 103.33%), linear-gradient(90deg, transparent -119%, #070910 70.56%)'

export function NowPlayingBar({
  nowPlaying,
  connected,
  settled,
}: {
  nowPlaying: NowPlaying
  connected: boolean
  /** False until the server has answered once, either way. */
  settled: boolean
}) {
  const song = nowPlaying.song
  const playing = nowPlaying.playing && song !== null

  return (
    <Shell
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

          <div className="min-w-0 flex-1">
            <div className="mb-[5px] flex items-center gap-[10px]">
              <Badge tone="accent">Now playing</Badge>
              {/* Where the chart came from, as a mark rather than a word. */}
              <SourceBadge source={song.source} size={16} showName={false} />
              {!connected ? <Badge title="Live updates interrupted">offline</Badge> : null}
            </div>

            <p dir="auto" className="truncate text-[22px] leading-none font-semibold text-white">
              {song.name}
            </p>
            <p
              dir="auto"
              className="mt-[5px] truncate text-[17px] leading-none font-medium text-content-secondary italic"
            >
              {song.artist}
              {song.album ? (
                <span className="text-content-muted not-italic"> — {song.album}</span>
              ) : null}
            </p>
          </div>

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

/** Fixed-height frame shared by both states — the thing that stops the shift. */
function Shell({ backdrop, children }: { backdrop: ReactNode; children: ReactNode }) {
  return (
    <div
      className="relative shrink-0 overflow-hidden bg-surface-card"
      style={{ height: BANNER_HEIGHT }}
    >
      {backdrop}
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
