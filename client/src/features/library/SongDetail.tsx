/**
 * Everything one chart carries.
 *
 * The list is a scan; this is the answer. It exists because the wire has always
 * carried far more than a row could show — twenty per-instrument difficulties,
 * the charter, the age rating — and on a phone the row shows five fields of it.
 * Selecting a song is how the rest arrives, and it is the same gesture at every
 * width: a pane beside the list on a desktop, a sheet over it on a phone, this
 * component inside both.
 *
 * "Everything one chart carries" is the title of this file and it is no longer
 * literally true: `playlist` and `format` are on the wire and are deliberately
 * not drawn. See the note over the fact grid.
 *
 * **Album art is real only for the song YARG is playing right now.** The CSV
 * export carries no chart paths, so the server has nothing to read art out of
 * for the other four thousand songs — see `server/src/core/art.ts`, and the
 * planned YARG-side index in the README, which is what unblocks it. Rather than
 * the same grey disc four thousand times, the plate sets the *album* and the
 * artist as type — the two things a real sleeve says. It is a placeholder that
 * says something, and it says the thing the picture it replaces would.
 *
 * **The layout is composed as though every song has a cover**, because
 * eventually every song will. The plate is a square image slot standing in for
 * a record it does not have a photograph of yet; nothing below it is arranged
 * around the stand-in being type, and nothing below it moves when real art
 * arrives.
 *
 * ## Why this stopped being a spreadsheet
 *
 * Everything under the plate used to be one `<dl>` of nine hairline-ruled rows,
 * label left and value right, and that is a table however it is styled. Band
 * difficulty — the number a band is here to read — carried exactly the weight of
 * `format: Chart folder`. Nine equal rows over 400px is a ledger.
 *
 * It is three groups now, and they are sized by how often somebody wants them:
 *
 *   1. **Who this is** — title, artist, album, and the source badge, which came
 *      up out of row six because it answers "which game is this from" and it is
 *      the one field that is a picture.
 *   2. **What it plays like** — the parts grid with the band tier on its header.
 *      This is the question the surface exists to answer, and it is the only
 *      thing on the page that is drawn rather than set: five instrument glyphs
 *      inside five difficulty rings, and a sixth ring for the band. Everything
 *      above and below it is type, and the group carries exactly one word —
 *      `band` — because that ring is the only one whose subject isn't a picture
 *      of itself.
 *   3. **The five short facts** — year, length, genre, charter, rating — as
 *      label-over-value cells in two columns. `2006` does not need 380px of
 *      ruled row to itself, and putting its label directly above it rather than
 *      380px to its left is what stopped the eye having to traverse the gap
 *      nine times.
 *
 * **There are no rules left in this component.** The last one fenced off a
 * separate provenance block, and once `playlist` and `format` were cut that
 * block was two rows — a group too small to earn a divider, and the last place
 * on the surface still setting a label left and a value right. Folding its
 * survivors into the fact grid is what finished the job the divider started.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import type { Song } from '@shared/types'
import { Badge, Button, cx } from '../../ui'
import { ArtistName, PartsGrid, SongTitle, SourceBadge, hasUntieredPart } from '../../ui/library'
import { currentArtUrl } from '../../lib/api'
import { formatDuration, formatYear, titleCredit } from '../../lib/format'

/*
 * `FORMAT_LABELS` used to live here — the map that turned YARG's `EntryType`
 * names into words, `Sng` into ".sng package". It went with the `format` row it
 * was written for and is dead code now that nothing renders a container format.
 *
 * Worth knowing it exists: the format facet in `Filters.tsx` still lists the raw
 * ids, because that is what the counts are keyed by, and this map is the ready
 * answer if that dropdown ever wants human words. `git log -S FORMAT_LABELS`.
 */

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
    /*
     * 25px is the resting interval; the one 35px break is bought with a margin
     * on the section that follows it. That break is the seam of the whole
     * surface — above it is which song this is, below it is whether the room
     * can play it — and at a flat 25px everywhere the two halves read as one
     * undifferentiated column, which is most of what "spreadsheet" meant.
     */
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
        {/*
         * The one surface that gives the title's asides a line of their own.
         * Every other housing is a single line that truncates, so the credit
         * and the version note trail the title there and take width off it;
         * here nothing truncates and the line is free. See `SongTitle`.
         */}
        <h2 dir="auto" className="text-[30px] leading-[1.05] font-semibold break-words text-white">
          <SongTitle song={song} notes="block" />
        </h2>
        {/*
         * 20px, not 19: `--text-artist-sm` is a real rung on the type scale and
         * 19 was a number somebody typed. The whole surface now sets at 30 / 20
         * / 15 / 12, every one of them a token, which is four steps where there
         * used to be eight sizes inside a 1.8:1 range.
         */}
        <p
          dir="auto"
          className="text-[20px] leading-tight font-medium break-words text-content-secondary italic"
        >
          <ArtistName song={song} />
        </p>
        {song.album ? (
          <p dir="auto" className="text-[15px] leading-tight break-words text-content-muted">
            {song.album}
          </p>
        ) : null}
        {/*
         * The source, promoted out of the fact list.
         *
         * It sat in row six as `source: Rock Band 3 DLC` — an icon and a name,
         * right-aligned, needing its own centred-baseline special case to stop
         * the name riding low against its label. But it is not a measurement of
         * the song like `length` is; it is part of what this record *is*, the
         * same way a label imprint is. Put against the album line it needs no
         * label at all: an icon and a game's name is self-evident, and that is
         * one fewer row, one fewer rule, and one less alignment exception.
         *
         * Muted rather than white, because its neighbours here are the album
         * and the artist rather than a column of answers. Identity reads in
         * three weights — white title, cyan artist, muted context.
         */}
        <SourceBadge
          source={song.source}
          size={22}
          nameClassName="text-[15px] leading-tight text-content-muted"
        />
      </div>

      {/*
       * The reason anybody opened this: five parts and how hard each one is.
       *
       * **Band difficulty is deliberately not here.** It was the header of this
       * group — a `band` label and the same ring, set to the right — and it is
       * a summary of the five rings directly beneath it. A summary earns its
       * place where the detail won't fit, and that is now exactly one surface:
       * the song row, which has a single slot for difficulty and four thousand
       * rows to scan. On a surface that shows every part, the one number that
       * stands for all of them is the least informative thing on it. It is
       * still on `Song` and still drawn by `BandDifficulty` in the list.
       *
       * That leaves the group with no label at all, and it needs none. Five
       * instruments in rings are self-evident, and `PartsGrid` names itself for
       * a screen reader.
       */}
      <section className="mt-[10px] flex flex-col gap-[15px]">
        <PartsGrid song={song} />

        {/*
         * The caveat, in words, where a phone can read it. `BandDifficulty`
         * carries the same sentence in a `title`, which a touch device cannot
         * reach — and this is the one surface with the room to just say it.
         *
         * It follows the zeros rather than the field it was written for. It
         * used to hang off band difficulty, which this surface no longer shows;
         * the grid above still draws per-part tiers, and any of those can be 0
         * with exactly the same ambiguity.
         */}
        {hasUntieredPart(song) ? (
          <p className="text-[12px] leading-[1.35] text-content-muted">
            YARG writes 0 both for a trivial chart and for one nobody tiered.
          </p>
        ) : null}
      </section>

      {/*
       * Five short answers in two columns, rather than five full-width rows.
       *
       * `2006`, `7:22`, `Rock`, `Harmonix` — none of them needs 380px of
       * ruled row, and each label sits directly above the value it names
       * instead of across a gap from it. Row-major order puts the song's own
       * facts first and the chart's last, which is the order they are wanted
       * in.
       *
       * Two fixed columns rather than a wrapping run, which was the first cut:
       * cells that size to their own content leave the shape at the mercy of
       * the strings, and `1975 (2011 remaster)` is wide enough that a 460px
       * pane fitted three of them and orphaned one onto a line of its own. Two
       * columns is the same shape in every pane, every sheet and every song,
       * and 192px still holds the longest value on one line.
       *
       * ## What is deliberately not here
       *
       * **`playlist` and `format`.** Neither answers anything somebody
       * choosing a song is asking. `format` is the chart's container — a fact
       * about how the file is packaged, which matters to YARG and to nobody
       * standing in a room deciding what to play. `playlist` is a real
       * organising idea, but a row that prints one name is not how it would
       * pay off; sorting or filtering by it is, and that is a list feature, not
       * a detail row. Both are still on the wire and still in `Song`, so
       * neither costs anything to bring back.
       *
       * **A `recording: Master / Cover version` row.** It answered a question
       * about the artist line eleven rows above it, in YARG's word for the
       * answer. The artist line says it itself now: `as made famous by`.
       *
       * **A `vocal parts` row.** The count is a picture now — the vocals glyph
       * is one microphone, two or three, drawn by `vocalsArt` — so the grid
       * above answers it in the place the eye is already looking. The row also
       * had to be called `vocal parts` rather than `vocals` to keep it apart
       * from the grid's own VOCALS label, which meant the difficulty of the
       * vocal chart: two different answers under one word, forty pixels apart.
       * Both the row and that label are gone. `formatVocalParts` still exists
       * and still says these words, in the accessible name of the glyph.
       *
       * `charted by` last and left-aligned rather than in a ruled block of its
       * own. It is the field that tells two charts of the same song apart —
       * 178 title-and-artist pairs in a real library have more than one — so it
       * stays, but it is a fact like the others and no longer a category.
       */}
      <dl className="grid grid-cols-2 gap-x-[25px] gap-y-[15px]">
        <Fact label="year" value={song.year || formatYear(song.yearNumber)} />
        <Fact label="length" value={formatDuration(song.lengthSeconds)} />
        <Fact label="genre" value={genre || '—'} />
        <Fact label="charted by" value={song.charter || '—'} />
        <Fact label="rating" value={song.ageRating || '—'} />
      </dl>
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
      {/*
       * Half the sentence it was. The long version listed four things the pane
       * would show and then said it would show them, which is a paragraph read
       * once and then occupying a third of a 1440px window forever.
       */}
      <p className="max-w-[32ch] text-[15px] leading-[1.35] text-content-muted">
        Its parts, how hard they are, and who charted it.
      </p>
      {onShowPlaying ? (
        <Button className="mt-[10px]" onClick={onShowPlaying}>
          show what&rsquo;s playing
        </Button>
      ) : null}
    </div>
  )
}

/*
 * `SectionLabel` used to live here — the uppercase 12px label that headed the
 * parts group. It went with the last thing it labelled. `parts` was a caption
 * on a row of instrument pictures, and `band` went when band difficulty did.
 * `Fact` below sets its own labels; this component was never shared with it.
 */

/**
 * A short answer and the word for it, stacked.
 *
 * Sized to its own content and left to wrap, so four of these are a strip in
 * the pane and two lines of two in a phone sheet with no breakpoint deciding
 * it. The label sits directly above the value rather than 380px to its left,
 * which is the difference between reading a fact and looking one up.
 *
 * No rule, no box. Proximity groups the pair and the 35px column gap separates
 * the pairs; anything drawn between them would be a third mark doing the job
 * two intervals already do.
 */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[5px]">
      <dt className="yarg-label text-[12px] text-count-muted">{label}</dt>
      <dd dir="auto" className="text-[15px] leading-tight break-words text-content">
        {value}
      </dd>
    </div>
  )
}

/**
 * Album art, or the record it belongs to set as type.
 *
 * **The plate names the album, not the song.** It stands in for a cover, and a
 * cover is a picture of a *record*: it says `Rumours` and `Fleetwood Mac`, and
 * it says the same thing on all eleven of its tracks. Setting the song's own
 * title here made the plate change with every row and printed the title twice
 * inside 400px — the pane's `<h2>` is directly beneath it — which is a third of
 * what the last review meant by "the detail states the same title three times".
 * Naming the album instead makes the stand-in behave the way the real art will:
 * the same square for the same record, and one more fact on screen rather than
 * the same one again.
 *
 * A song with no album falls back to its own title, which is not a compromise —
 * that is a single, and a single's sleeve carries the song's name.
 *
 * `onError` covers the third case: the server said it had art, and then the
 * chart moved or the network share the library lives on dropped between the
 * scan and the request.
 */
function ArtPlate({ song, artHash }: { song: Song; artHash: string | null }) {
  const [failed, setFailed] = useState(false)
  // The credited title rather than the raw field, so a single whose name
  // carries `(feat. …)` sets the plate with the song and not the credit.
  const record = song.album.trim() === '' ? titleCredit(song).title : song.album

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
         * be too wide by being too tall, and a cover that fills the pane pushes
         * the answer out of it. The parts grid is what the reader came for; the
         * cover only has to be big enough to recognise.
         *
         * `--plate-cap` is how each housing spends its height, and the default
         * is what the desktop pane takes. It was 45svh, which at 1440×900 put
         * the bottom of the parts grid 17px inside the fold and at 1366×768 —
         * the other commonest desktop size there is — put it 55px *outside*
         * one. 34svh is a 306px cover at 900 and a 261px cover at 768, and the
         * grid clears the fold at both with the fact strip starting behind it.
         *
         * The 180px floor stops a landscape phone from shrinking the plate to
         * the point where the title has to set at its minimum size and wrap
         * five times.
         */
        'mx-auto w-full max-w-[min(100%,max(180px,var(--plate-cap,34svh)))]',
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
          // The album and artist are both printed in the header below, so
          // announcing them twice would be the only thing this adds to a
          // screen reader.
          aria-hidden
          className="yarg-plate absolute inset-0 flex flex-col justify-end gap-[10px] p-[25px]"
        >
          <p
            dir="auto"
            /*
             * Padding on the top edge only, for the reason `truncate-tight`
             * exists: `line-clamp` is `overflow: hidden` too, and at 0.95 the
             * line box is 11px shorter than the glyphs at the size this clamps
             * to. MOTÖRHEAD ÜBER ALLES was being served with the dots cut off
             * the umlauts. The negative margin gives the space back, so the
             * plate's type sits exactly where it did.
             *
             * **The bottom half of that pair had to go.** `overflow: hidden`
             * clips to the *padding* box, so padding-bottom grew the clip
             * rectangle past the fourth line and let the fifth bleed under the
             * ellipsis — measured at 15.2px on a 92-character title, which
             * reads as `MONEY…` followed by the top halves of `LIKE`. Nothing
             * is lost by dropping it: `.yarg-label` is uppercase, so there is
             * no descender below the last baseline to protect, and at 0.95 the
             * line box still leaves ~0.23em of empty space under it.
             */
            /*
             * 13cqw, not 15. `break-words` is the safety net for a title that
             * is one unbreakable string, and at 15cqw it had become the normal
             * case instead: in the pane at a 1024px window the plate is 277px,
             * which set the type at 41.5px and served BOHEMIA / N / RHAPSOD / Y.
             * Ordinary eight-letter words now fit the line they are on.
             */
            className="yarg-label line-clamp-4 pt-[0.2em] -mt-[0.2em] text-[clamp(24px,13cqw,72px)] leading-[0.95] break-words text-white"
          >
            {record}
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
