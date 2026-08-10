/**
 * The now-playing banner.
 *
 * Follows the design system's "Currently Playing" language: album art under a
 * double scrim (one vertical, one horizontal) so text stays legible against any
 * artwork, over the card surface with its 2px inset stroke.
 *
 * Shows a quiet idle state when YARG is in menus — a blank `currentSong.json` is
 * normal, not an error worth announcing to a room.
 */

import { useState } from 'react'

import type { NowPlaying } from '@shared/types'
import { Badge } from '../../ui'
import { currentArtUrl } from '../../lib/api'
import { formatDuration, formatSource, formatVocalParts } from '../../lib/format'

/** The design's double scrim, laid over album art. */
const SCRIM =
  'linear-gradient(180deg, transparent -6.67%, #070910 103.33%), linear-gradient(90deg, transparent -119%, #070910 70.56%)'

export function NowPlayingBar({
  nowPlaying,
  connected,
}: {
  nowPlaying: NowPlaying
  connected: boolean
}) {
  const song = nowPlaying.song

  if (!nowPlaying.playing || !song) {
    return (
      <div className="flex shrink-0 items-center gap-[15px] bg-surface-card px-[25px] py-[15px]">
        <div
          className="size-[56px] shrink-0 bg-surface-sunken"
          style={{ borderRadius: 'var(--radius-md)' }}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="yarg-label text-[14px] text-content-muted">Nothing playing</p>
          <p className="truncate text-[14px] text-content-faint">
            {connected ? 'Waiting for YARG to start a song' : 'Reconnecting to the server'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative shrink-0 overflow-hidden bg-surface-card">
      {/* Art bled across the banner, scrimmed rather than colour-graded. */}
      {song.hasArt ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `${SCRIM}, url("${currentArtUrl(song.hash)}")` }}
        />
      ) : null}

      <div className="relative flex items-center gap-[15px] px-[25px] py-[15px]">
        <AlbumArt hash={song.hash} hasArt={song.hasArt} />

        <div className="min-w-0 flex-1">
          <div className="mb-[5px] flex items-center gap-[10px]">
            <Badge tone="accent">Now playing</Badge>
            {!connected ? <Badge title="Live updates interrupted">offline</Badge> : null}
          </div>

          <p className="truncate text-[24px] leading-none font-semibold text-white">{song.name}</p>
          <p className="mt-[5px] truncate text-[18px] leading-none font-medium text-content-secondary italic">
            {song.artist}
            {song.album ? <span className="text-content-muted not-italic"> — {song.album}</span> : null}
          </p>
        </div>

        <dl className="hidden shrink-0 gap-[25px] text-right sm:flex">
          <Detail label="length" value={formatDuration(song.lengthSeconds)} />
          <Detail
            label="band"
            value={song.bandDifficulty === null ? '—' : String(song.bandDifficulty)}
          />
          <Detail label="vocals" value={formatVocalParts(song.vocalsCount)} />
          <Detail label="source" value={formatSource(song.source)} />
        </dl>
      </div>
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

/**
 * Album art thumbnail, or a placeholder disc.
 *
 * `hasArt` is false for packed chart containers, whose art lives inside the
 * archive. `onError` additionally covers the chart moving or a network share
 * dropping between the scan and the request.
 */
function AlbumArt({ hash, hasArt }: { hash: string | null; hasArt: boolean }) {
  const [failed, setFailed] = useState(false)

  if (!hasArt || failed) {
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

  return (
    <img
      key={hash ?? 'none'}
      src={currentArtUrl(hash)}
      alt=""
      onError={() => setFailed(true)}
      className="size-[56px] shrink-0 bg-surface-sunken object-cover"
      style={{ borderRadius: 'var(--radius-md)', boxShadow: 'inset 0 0 0 2px var(--yarg-border-card)' }}
    />
  )
}
