/**
 * Whether this device makes a sound, and how much of one.
 *
 * **It is chrome, not part of a song.** The control used to be a filled accent
 * pill sitting under the album art in the detail pane, which was wrong twice
 * over: it was the loudest object on a surface whose subject is the artwork and
 * the title, and it answered a question about the *room* from inside a card
 * about one record. Sound is a property of the device — it outlives every song
 * you look at — so it belongs where the app's other standing facts are.
 *
 * That is the helper bar wherever the detail is a pane, and the sheet's own
 * header wherever the detail is a sheet — the same breakpoint, not the bar's
 * own. The bar arrives 256px before the second pane does, and in that band a
 * control drawn in it would spend the whole time a song is open sitting behind
 * the sheet's backdrop: visible, dimmed and inert. Exactly one of the two
 * housings exists at any width; see the call sites in `App`.
 *
 * Neither placement covers a cover, neither appears and disappears under the
 * thumb, and both sit in the same place for every song.
 *
 * **The word is load-bearing.** The label reads `previews` and not `volume`,
 * because eighteen pixels to the left of it the same bar says `yarg is playing`
 * — and a bare speaker between those two things looks exactly like a control
 * for the game's audio, which this cannot touch. One word settles it.
 */

import type { CSSProperties } from 'react'

import { cx } from '../../ui'
import type { PreviewStatus } from '../../lib/usePreview'
import { usePreviewSound } from '../../lib/usePreview'

/**
 * A speaker, with waves, or with a cross through it.
 *
 * Drawn rather than imported because the design system has no audio glyph — its
 * icon set is instruments and gamepad buttons, which is what a game menu needs.
 * The cone is filled and everything hung off it is stroked, so the states differ
 * in the mark beside the speaker rather than in the speaker itself.
 *
 * The waves count the level, which costs nothing and means the glyph and the
 * slider are never telling different stories: turned most of the way down, the
 * speaker shows one arc whether or not anybody is looking at the track.
 */
function SpeakerGlyph({ muted, level, size = 16 }: { muted: boolean; level: number; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="shrink-0">
      <path
        fill="currentColor"
        d="M4 9h3.6L12.4 5.1A.75.75 0 0 1 13.6 5.7v12.6a.75.75 0 0 1-1.2.6L7.6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z"
      />
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {muted ? (
          <>
            <path d="M17 9.5l5 5" />
            <path d="M22 9.5l-5 5" />
          </>
        ) : (
          <>
            <path d="M16.8 9.2a4 4 0 0 1 0 5.6" />
            {level > 0.5 ? <path d="M19.6 6.8a7.5 7.5 0 0 1 0 10.4" /> : null}
          </>
        )}
      </g>
    </svg>
  )
}

/**
 * Whether a preview is being waited on.
 *
 * A cold one is generated on the spot, which takes about a second — the one
 * wait in this feature anybody notices. The pulse both housings put on the glyph
 * is the whole report: a spinner for one second is a flash of anxiety, and
 * nothing is blocked in the meantime.
 */
function isStarting(muted: boolean, status: PreviewStatus): boolean {
  return !muted && status === 'loading'
}

/**
 * The toggle itself: a speaker, the word, and nothing drawn around them.
 *
 * **No fill and no ring, in either state.** The filled pill this replaces was
 * the loudest object on whatever surface it landed on, and the reason it was a
 * pill at all was discoverability — a control that appeared and disappeared
 * with the song being looked at had to shout to be found. It does not appear
 * and disappear any more. It is in the same place in every session, in the
 * register the surrounding chrome is already set in, which is what buys the
 * quiet: you find it by knowing where it is rather than by it catching your eye
 * on the way past.
 *
 * `aria-pressed` rather than a label that changes to the verb, because the
 * housing is now a strip of controls rather than a card of facts — a toggle
 * among toggles, which is what that attribute is for.
 *
 * **On a phone this is the whole control**, in the sheet's header, and there is
 * no slider beside it. A phone has two volume buttons on the side that everyone
 * holding one already knows how to use, and on iOS they are the only volume
 * there is — Safari refuses writes to `HTMLMediaElement.volume` precisely so
 * that stays true. An on-screen track would be a second, weaker answer to a
 * question the hardware has already answered, in the one layout with no room to
 * spare for it. It sits opposite the close button, which is a bare 14px cross:
 * two controls of the same weight, one at each end of the header, with the grab
 * handle between them and the album art below left to be the thing worth
 * looking at.
 */
export function PreviewSoundButton({ className }: { className?: string }) {
  const { muted, status, volume, toggle } = usePreviewSound()
  const starting = isStarting(muted, status)

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!muted}
      aria-busy={starting || undefined}
      title={muted ? 'Play previews of the song you are looking at' : 'Stop playing previews'}
      className={cx(
        'yarg-label yarg-focusable tap-target flex cursor-pointer items-center gap-[7px] text-[12px]',
        // The chrome's own register, in both states: the same muted caps the
        // keyboard hints beside it are set in, so the control belongs to the bar
        // rather than sitting on top of it.
        'text-content-muted transition-colors duration-160 hover:text-content',
        className,
      )}
    >
      {/*
       * The accent marks the state that is doing something, which is the rule
       * the whole app uses it by — carried by a 16px glyph and three pixels of
       * track rather than by a filled pill, so "the sound is on" is a mark and
       * not an announcement. It is deliberately the only thing here that changes
       * colour: a label that lit up too would make a preference read like an
       * alert.
       */}
      <span className={cx('flex', !muted && 'text-accent', starting && 'animate-pulse')}>
        <SpeakerGlyph muted={muted} level={volume} />
      </span>
      previews
    </button>
  )
}

/**
 * The desktop control: the toggle, and the level beside it.
 *
 * Both, rather than a slider alone that mutes at the bottom. Turning previews
 * off and back on is a decision somebody makes twice in an evening — a phone
 * call, somebody talking — and asking for a drag to the end of a track and back,
 * with the old level lost on the way, would make the common thing the fiddly
 * one. The button is the decision; the slider is the setting.
 */
export function PreviewVolume({ className }: { className?: string }) {
  const { muted, volume, setVolume } = usePreviewSound()

  return (
    <div className={cx('flex items-center gap-[12px]', className)}>
      <PreviewSoundButton />

      {/*
       * The slider reads 0 while muted and rises out of it, so the two controls
       * can never disagree — and dragging up from the bottom is the second way
       * to turn the sound on, which is the one a hand already on the track will
       * reach for. See `setPreviewVolume`.
       */}
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(event) => setVolume(event.currentTarget.valueAsNumber)}
        aria-label="Preview volume"
        aria-valuetext={`${Math.round(volume * 100)}%`}
        data-live={muted ? 'false' : 'true'}
        className="yarg-slider yarg-focusable"
        style={{ '--slider-value': `${volume * 100}%` } as CSSProperties}
      />
    </div>
  )
}
