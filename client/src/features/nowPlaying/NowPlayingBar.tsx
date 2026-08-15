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
 *
 * **On a short screen it is one line instead of three.** 92px is a quarter of a
 * phone held sideways, spent on the one song nobody is choosing — the whole
 * point of the surface behind it is the four thousand you might. So `short`
 * collapses the stack into a row: a 32px cover, the badges, the title and the
 * artist on one baseline, the length at the far end. It still says what is
 * playing and still opens its details; it costs 48px to do it. The venue wash
 * survives at full strength, because that is the thing tying the phone in
 * somebody's hand to the screen across the room.
 */

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import type { NowPlaying } from '@shared/types'
import { Badge, ChevronRight, cx } from '../../ui'
import { ArtistName, SongTitle, SourceBadge } from '../../ui/library'
import { currentArtUrl } from '../../lib/api'
import { formatArtistCredit, formatDuration, formatTitleCredit } from '../../lib/format'
import { useVenue } from '../../lib/useVenue'
import { useVenueWash } from './venueWash'
import type { VenueWash } from './venueWash'

/**
 * Tall enough for the badge, title and artist stack without clipping — and, on
 * a short screen, for the single row that replaces it.
 *
 * A class rather than the inline height it used to be, so the `short` variant
 * can reach it. See the note at the top of this file.
 */
const BANNER_HEIGHT = 'h-[92px] short:h-[48px]'

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
            // The normalized title, not the raw field: with the credit lifted
            // out of both, a song whose title *and* artist named the guest
            // would otherwise have this sentence say her name twice.
            label={`Show details for ${formatTitleCredit(song)} ${formatArtistCredit(song)}`}
          >
            {/*
             * `short:contents` dissolves this row into the one above it.
             *
             * The badges, the title and the artist are three stacked blocks at
             * full height and one baseline-aligned row when there is none, and
             * the difference is entirely which box they belong to. Dropping the
             * wrapper out of the layout — rather than rendering a second copy of
             * its three children under a media query — is what keeps that one
             * arrangement of one set of elements, which is the same trade every
             * other dual-layout surface in this app makes.
             */}
            <div className="mb-[5px] flex items-center gap-[10px] short:contents">
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
                  //
                  // On one line it goes to the end of the row instead, where the
                  // chevron alone says the block opens — `details` sitting in
                  // front of the title would read as a label on it. The word is
                  // in the button's accessible name either way.
                  className={cx(
                    'yarg-label flex shrink-0 items-center gap-[5px] text-[10px] text-content-muted',
                    'transition-colors duration-160 group-hover:text-white',
                    'short:order-last',
                  )}
                >
                  <span className="short:hidden">details</span>
                  <ChevronRight />
                </span>
              ) : null}
            </div>

            <p
              dir="auto"
              className={cx(
                'truncate-tight text-[22px] leading-none font-semibold text-white',
                // Shrinks ahead of the artist beside it, and only down to a
                // floor: a title clipped to two words is still the thing the
                // row is about, and the artist can afford to go first.
                'short:min-w-[8ch] short:shrink short:text-[15px]',
              )}
            >
              <SongTitle song={song} />
            </p>
            <p
              dir="auto"
              className={cx(
                'mt-[5px] truncate-tight text-[17px] leading-none font-medium text-content-secondary italic',
                'short:mt-0 short:min-w-0 short:shrink-[3] short:text-[13px]',
              )}
            >
              <ArtistName song={song} />
              {/* The album is the first thing to go: it is the least of the
                  three and the only one repeated on the row you are about to
                  open. */}
              {song.album ? (
                <span className="text-content-muted not-italic short:hidden"> — {song.album}</span>
              ) : null}
            </p>
          </Content>

          {/*
           * Length, and nothing else.
           *
           * This was three stats — `length`, `band`, `vocals`. The other two
           * left for the same reason, one commit apart: the banner is a strip
           * that says what is playing, and a chart's difficulty and its harmony
           * count are things you read when you are *choosing* a song, which is
           * what the list and the detail pane are for. Neither was worth the
           * width here, and band difficulty was a summary of five numbers this
           * surface never shows.
           *
           * Length survives because it answers a question about the song that
           * is playing rather than about a song you might play: how long until
           * this one ends.
           */}
          <dl className="hidden shrink-0 gap-[25px] text-right sm:flex">
            <Detail label="length" value={formatDuration(song.lengthSeconds)} />
          </dl>
        </>
      ) : (
        <>
          <PlaceholderArt />
          {/*
           * The idle state collapses the same way the playing one does — two
           * stacked lines become one row — so a banner that is holding still
           * mid-scroll holds the same height whichever it is showing. That is
           * the fixed-height rule at the top of this file, restated at 48px.
           */}
          <div className="min-w-0 flex-1 short:flex short:items-baseline short:gap-[10px]">
            {/*
             * Three states, not two. Before `settled` we have simply not heard
             * back yet — saying "Reconnecting" there told every guest the app
             * was broken during the first second of every visit, because the
             * connection flag starts false and nothing distinguished "never
             * tried" from "lost it".
             */}
            <p className="yarg-label shrink-0 text-[15px] text-content-muted short:text-[13px]">
              {settled ? 'Nothing playing' : 'Connecting'}
            </p>
            <p className="mt-[5px] min-w-0 truncate text-[14px] text-content-faint short:mt-0 short:text-[13px]">
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
  /*
   * The stack, or the row — the same three children either way.
   *
   * `short:flex` is what the badge row's `short:contents` resolves into: with
   * that wrapper out of the layout its children land here, and this is the box
   * that lines all five of them up. Centred rather than on a baseline, because
   * two of the five are pictures.
   */
  const layout = 'min-w-0 flex-1 short:flex short:items-center short:gap-[10px]'

  if (onSelect === null) return <div className={layout}>{children}</div>

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      className={cx(
        layout,
        'yarg-focusable cursor-pointer text-left',
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
    <div className={cx('relative isolate shrink-0 overflow-hidden bg-surface-card', BANNER_HEIGHT)}>
      {backdrop}
      <div
        aria-hidden
        className="venue-wash"
        style={{
          opacity: wash.opacity,
          // The fade fills the whole gap between colours, so the wash is always
          // mid-transition rather than resting and then switching.
          '--venue-fade': `${wash.fadeMs}ms`,
        } as CSSProperties}
      >
        {/* The colour already on screen, held while the next comes up over it. */}
        <div
          className="venue-wash-layer"
          style={{ backgroundColor: wash.previous ?? 'transparent' }}
        />
        {/* Keyed by the colour, so each one is a new element that starts its
            fade at zero. See `.venue-wash-in`. */}
        <div
          key={wash.color ?? 'none'}
          className="venue-wash-layer venue-wash-in"
          style={{ backgroundColor: wash.color ?? 'transparent' }}
        />
      </div>
      {/*
       * The one edge inset the app shell cannot hand down.
       *
       * `<main>` pads itself out of the display cutout, which covers the list,
       * the toolbar and the jump rail in one place — but the banner is a
       * sibling above it and has to clear the notch itself. It is padding
       * rather than a margin so the album backdrop and the venue wash still
       * run out to the physical edge of the glass behind it; the type and the
       * cover are what have to stay inside.
       */}
      <div
        className={cx(
          'relative flex h-full items-center gap-[15px] short:gap-[10px]',
          'pl-[max(25px,env(safe-area-inset-left))] pr-[max(25px,env(safe-area-inset-right))]',
          'short:pl-[max(15px,env(safe-area-inset-left))] short:pr-[max(15px,env(safe-area-inset-right))]',
        )}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Numbers are shown, not described: bright value, dim unit label.
 *
 * Back to `string` — it took `ReactNode` for as long as one of these held a
 * difficulty ring. Kept as a component rather than inlined at its one call
 * site, since it is the shape the banner's stats take and there were three of
 * them a moment ago.
 */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    // Label over value at full height, label beside value on one line — the
    // same pair either way, and the only shape that fits a 48px bar.
    <div className="short:flex short:items-baseline short:gap-[6px]">
      <dt className="yarg-label text-[10px] text-count-muted">{label}</dt>
      <dd className="font-numeric mt-[5px] text-[15px] text-count short:mt-0 short:text-[13px]">
        {value}
      </dd>
    </div>
  )
}

function PlaceholderArt() {
  return (
    <div
      className={cx(
        'flex size-[56px] shrink-0 items-center justify-center bg-surface-sunken text-content-faint',
        'short:size-[32px]',
      )}
      style={{ borderRadius: 'var(--radius-md)' }}
      aria-hidden
    >
      <svg width="22" height="22" viewBox="0 0 20 20" fill="none" className="short:size-[16px]">
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
      className="size-[56px] shrink-0 bg-surface-sunken object-cover short:size-[32px]"
      style={{
        borderRadius: 'var(--radius-md)',
        boxShadow: 'inset 0 0 0 2px var(--yarg-border-card)',
      }}
    />
  )
}
