/**
 * Everything one chart carries.
 *
 * The list is a scan; this is the answer. It exists because the wire has always
 * carried far more than a row could show — twenty per-instrument difficulties,
 * the charter, the playlist, the age rating, the container format — and on a
 * phone the row shows five fields of it. Selecting a song is how the rest
 * arrives, and it is the same gesture at every width: a pane beside the list on
 * a desktop, a sheet over it on a phone, this component inside both.
 *
 * **Album art is real only for the song YARG is playing right now.** The CSV
 * export carries no chart paths, so the server has nothing to read art out of
 * for the other four thousand songs — see `server/src/core/art.ts`, and the
 * planned YARG-side index in the README, which is what unblocks it. Rather than
 * the same grey disc four thousand times, the plate sets the song's own title as
 * type. It is a placeholder that says something.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import type { Song, SongFormat } from '@shared/types'
import { Badge, Button, cx } from '../../ui'
import { ArtistName, DifficultyCapsule, PartsGrid, SourceBadge } from '../../ui/library'
import { currentArtUrl } from '../../lib/api'
import { formatDuration, formatVocalParts, formatYear } from '../../lib/format'

/**
 * Container formats, in words.
 *
 * `Ini` / `Sng` / `ExCON` are YARG's `EntryType` names, which are exactly the
 * kind of internal token this app spent its first version printing raw. The
 * filter dropdown still lists the ids because that is what the facet counts are
 * keyed by; this is the one place with room to say what they mean.
 */
const FORMAT_LABELS: Record<SongFormat, string> = {
  Ini: 'Chart folder',
  Sng: '.sng package',
  CON: 'CON package',
  ExCON: 'Extracted CON',
  Unknown: 'Unknown',
}

interface SongDetailProps {
  song: Song
  /** True when YARG is playing this exact chart right now. */
  isPlaying: boolean
  /**
   * The hash to fetch album art with, or null when there is no art to fetch.
   *
   * Non-null only for the playing song, and only when the server found art next
   * to its chart. Everything else gets the typographic plate.
   */
  artHash: string | null
  /**
   * Padding, which belongs to whatever is holding this.
   *
   * The pane has no chrome above the plate and wants a full 25px; the sheet
   * already spends 60px on a grab handle and a close button, and repeating the
   * inset under them left the artwork floating in the middle of nothing.
   */
  className?: string
}

export function SongDetail({ song, isPlaying, artHash, className }: SongDetailProps) {
  const genre = [song.genre, song.subgenre].filter(Boolean).join(' · ')

  return (
    <div className={cx('flex flex-col gap-[25px]', className)}>
      <ArtPlate key={song.id} song={song} artHash={artHash} />

      <div className="flex flex-col gap-[10px]">
        {isPlaying ? (
          <div>
            <Badge tone="accent">Now playing</Badge>
          </div>
        ) : null}

        {/*
         * No truncation anywhere below this line. The row has to truncate — it
         * is 80px tall and there are four thousand of them — and that left long
         * titles permanently unreadable, because there was nowhere else to
         * read them. This is that somewhere: titles wrap, values wrap, and
         * "Through the Fire and Flames" arrives whole.
         */}
        <h2 dir="auto" className="text-[30px] leading-[1.05] font-semibold break-words text-white">
          {song.name}
        </h2>
        <p
          dir="auto"
          className="text-[19px] leading-tight font-medium break-words text-content-secondary italic"
        >
          <ArtistName song={song} />
        </p>
        {song.album ? (
          <p dir="auto" className="text-[15px] leading-tight break-words text-content-muted">
            {song.album}
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-[15px]">
        <SectionLabel>parts</SectionLabel>
        <PartsGrid song={song} />
      </section>

      {/*
       * No heading over the fact list.
       *
       * There was one — "chart" — and it read as a field whose value had gone
       * missing, because it is the same size, colour and face as the labels
       * directly beneath it and the first fact's rule closed a box underneath
       * it. `parts` earns its heading by naming a grid that is otherwise
       * unlabelled. This list labels every row it has.
       */}
      <section>
        <dl className="flex flex-col">
          <Fact
            label="band"
            value={<DifficultyCapsule tier={song.bandDifficulty} />}
            note={
              song.bandDifficulty === 0
                ? 'YARG writes 0 both for a trivial chart and for one nobody tiered.'
                : undefined
            }
          />
          <Fact label="year" value={song.year || formatYear(song.yearNumber)} />
          <Fact label="length" value={formatDuration(song.lengthSeconds)} />
          <Fact label="genre" value={genre || '—'} />
          <Fact label="vocals" value={formatVocalParts(song.vocalParts)} />
          <Fact
            label="source"
            align="center"
            value={
              <SourceBadge
                source={song.source}
                size={22}
                className="justify-end text-right"
                nameClassName="text-[15px] text-content"
              />
            }
          />
          <Fact label="charter" value={song.charter || '—'} />
          {song.playlist ? <Fact label="playlist" value={song.playlist} /> : null}
          {/*
           * No `recording: Master / Cover version` row.
           *
           * It answered a question about the artist line eleven rows above it,
           * in YARG's word for the answer — and it was the row a reader had to
           * hold in their head on the way back up. The artist line says it
           * itself now: `as made famous by`.
           */}
          <Fact label="rating" value={song.ageRating || '—'} />
          <Fact label="format" value={FORMAT_LABELS[song.format]} />
        </dl>
      </section>
    </div>
  )
}

/**
 * The empty pane, which only the desktop two-pane layout can reach — on a phone
 * the sheet does not exist until a song is chosen.
 *
 * It offers the one shortcut the list cannot: the playing song may be three
 * thousand rows down, and nobody is going to scroll to it to find out what the
 * drums are like.
 */
export function SongDetailEmpty({ onShowPlaying }: { onShowPlaying: (() => void) | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[15px] px-[35px] text-center">
      <p className="yarg-label text-[17px] text-content">Pick a song</p>
      <p className="max-w-[32ch] text-[14px] leading-[1.35] text-content-muted">
        Which parts are charted and how hard they are, who charted it, what game it came from — all
        of it lands here.
      </p>
      {onShowPlaying ? (
        <Button className="mt-[10px]" onClick={onShowPlaying}>
          show what&rsquo;s playing
        </Button>
      ) : null}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="yarg-label text-[11px] text-count-muted">{children}</span>
}

/**
 * One labelled value.
 *
 * Ruled with the same hairline as the song rows rather than boxed, because a
 * card inside a card is two edges doing one job — and every surface in this
 * palette sits within 1.15:1 of every other, so a second card would read as a
 * misprint rather than as depth.
 */
function Fact({
  label,
  value,
  note,
  align = 'baseline',
}: {
  label: string
  value: ReactNode
  note?: string
  /**
   * Text values line up on their baselines, which is what makes a column of
   * them read as a column. A value carrying a picture cannot: a flex row takes
   * its baseline from its first item, and an image has none, so the browser
   * falls back to the image's bottom edge and the source name sits a few pixels
   * low against its own label. That row centres instead.
   */
  align?: 'baseline' | 'center'
}) {
  return (
    <div
      className={cx(
        'flex justify-between gap-[15px] py-[10px]',
        align === 'center' ? 'items-center' : 'items-baseline',
      )}
      style={{ borderTop: '1px solid var(--color-border-row)' }}
    >
      <dt className="yarg-label shrink-0 text-[11px] text-count-muted">{label}</dt>
      <dd dir="auto" className="min-w-0 text-right text-[15px] break-words text-content">
        {value}
        {note ? (
          <span className="mt-[5px] block text-[12px] leading-[1.35] text-content-muted">
            {note}
          </span>
        ) : null}
      </dd>
    </div>
  )
}

/**
 * Album art, or the song's own name set as type.
 *
 * `onError` covers the third case: the server said it had art, and then the
 * chart moved or the network share the library lives on dropped between the
 * scan and the request.
 */
function ArtPlate({ song, artHash }: { song: Song; artHash: string | null }) {
  const [failed, setFailed] = useState(false)

  return (
    <div
      className={cx(
        // Its own container, so the plate's type is sized against the plate
        // rather than the viewport — the same square is ~340px inside a phone
        // sheet and ~410px inside the desktop pane, and one `clamp()` on
        // viewport width cannot serve both.
        '@container relative aspect-square overflow-hidden bg-surface-sunken',
        /*
         * Width capped by *height*, because a square is the one shape that can
         * be too wide by being too tall — and the plate is the least useful
         * thing on this surface. It is real album art only for the one song
         * YARG is playing; the rest of the time it is the title in a box, while
         * the parts grid underneath it is the reason anybody opened this.
         *
         * `--plate-cap` is how each housing spends its height. The pane is a
         * tall column and can afford a full-width square; the sheet is 675px
         * on a phone and was giving 60% of that to artwork it does not have.
         * The 180px floor stops a landscape phone from shrinking the plate to
         * the point where the title has to set at its minimum size and wrap
         * five times.
         */
        'mx-auto w-full max-w-[min(100%,max(180px,var(--plate-cap,45svh)))]',
      )}
      style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)' }}
    >
      {artHash !== null && !failed ? (
        <img
          src={currentArtUrl(artHash)}
          // Decorative: the title and artist are set directly below it.
          alt=""
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div
          // The title and artist repeat the header below, so announcing them
          // twice would be the only thing this adds to a screen reader.
          aria-hidden
          className="yarg-plate absolute inset-0 flex flex-col justify-end gap-[10px] p-[25px]"
        >
          <p
            dir="auto"
            /*
             * `py`/`-my` for the same reason `truncate-tight` exists, and more
             * of it: `line-clamp` is `overflow: hidden` too, and at 0.95 the
             * line box is 11px shorter than the glyphs at the size this clamps
             * to. Uppercase display type has no descenders to lose, but it has
             * umlauts — MOTÖRHEAD ÜBER ALLES was being served with the dots cut
             * off the top. The negative margin gives the space back, so the
             * plate's type sits exactly where it did.
             */
            className="yarg-label line-clamp-4 py-[0.2em] -my-[0.2em] text-[clamp(24px,15cqw,72px)] leading-[0.95] break-words text-white"
          >
            {song.name}
          </p>
          <p
            dir="auto"
            className="truncate-tight text-[15px] leading-none font-medium text-content-secondary italic"
          >
            <ArtistName song={song} />
          </p>
        </div>
      )}
    </div>
  )
}
