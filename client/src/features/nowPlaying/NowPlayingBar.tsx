/**
 * The now-playing banner.
 *
 * Shows nothing at all when YARG is in menus — a blank `currentSong.json` is
 * the normal idle state, not an error worth reporting to a room full of people.
 */

import { useState } from 'react'

import type { NowPlaying } from '@shared/types'
import { Badge, cx } from '../../ui'
import { currentArtUrl } from '../../lib/api'
import { formatDuration, formatSource, formatVocalParts } from '../../lib/format'

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
      <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-3">
        <div className="size-12 shrink-0 rounded-md bg-surface-overlay" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-content-muted">Nothing playing</p>
          <p className="truncate text-xs text-content-faint">
            {connected ? 'Waiting for YARG to start a song' : 'Reconnecting to the server…'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-3">
      <AlbumArt hash={song.hash} hasArt={song.hasArt} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Now playing</Badge>
          {!connected ? <Badge title="Live updates interrupted">offline</Badge> : null}
        </div>

        <p className="truncate text-sm font-semibold text-content">{song.name}</p>
        <p className="truncate text-xs text-content-muted">
          {song.artist}
          {song.album ? ` — ${song.album}` : ''}
        </p>
      </div>

      <dl className="hidden shrink-0 gap-6 text-right text-xs text-content-muted sm:flex">
        <Detail label="Length" value={formatDuration(song.lengthSeconds)} />
        <Detail label="Band" value={song.bandDifficulty === null ? '—' : String(song.bandDifficulty)} />
        <Detail label="Vocals" value={formatVocalParts(song.vocalsCount)} />
        <Detail label="Source" value={formatSource(song.source)} />
      </dl>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] tracking-wide text-content-faint uppercase">{label}</dt>
      <dd className="text-content">{value}</dd>
    </div>
  )
}

/**
 * Album art, or a placeholder.
 *
 * `hasArt` is false for packed chart containers (`.sng`, CON), whose art lives
 * inside the archive. The `onError` fallback also covers the chart being moved
 * or a network share going away between the scan and the request.
 */
function AlbumArt({ hash, hasArt }: { hash: string | null; hasArt: boolean }) {
  const [failed, setFailed] = useState(false)

  if (!hasArt || failed) {
    return (
      <div
        className="flex size-12 shrink-0 items-center justify-center rounded-md bg-surface-overlay text-content-faint"
        aria-hidden
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="1.75" fill="currentColor" />
        </svg>
      </div>
    )
  }

  return (
    <img
      // Re-fetch when the song changes; the server serves one /api/art/current.
      key={hash ?? 'none'}
      src={currentArtUrl(hash)}
      alt=""
      onError={() => setFailed(true)}
      className={cx('size-12 shrink-0 rounded-md object-cover', 'bg-surface-overlay')}
    />
  )
}
