/**
 * YARG's stage lighting, translated into a slowly drifting colour.
 *
 * The game is running a real venue: chases, sweeps, silhouettes, blackouts,
 * strobes. None of that belongs on a phone that a dozen people are reading a
 * song list on, so this throws away the movement and keeps the palette.
 *
 * **A cue is not one colour.** `coolAutomatic` is a blue chase running against
 * a green counter-chase; `harmony` rotates four; `bigRockEnding` cycles all of
 * them every four beats. Collapsing each cue to a single swatch made the banner
 * sit on one colour for a whole verse, which is both duller than the stage and
 * less true to it. So a cue maps to the set of colours that are up during it,
 * and the wash drifts between them at the song's tempo.
 *
 * **Nothing here can flash.** The drift is measured in seconds and the fade
 * fills the entire gap between steps, so the colour is always mid-transition
 * and never switches. The strobe field never reaches the client, and the
 * server publishes state changes at most twice a second — a change rate that
 * could trip WCAG 2.3.1 is not reachable from this file even by accident.
 *
 * Colours are tokens rather than literals, so an upstream palette change
 * reaches this the same way it reaches everything else.
 */

import { useEffect, useRef, useState } from 'react'

import type { LightingCue, PostProcessing, VenueState } from '@shared/types'

const RED = 'var(--yarg-imperial-red)'
const YELLOW = 'var(--yarg-mustard)'
const GREEN = 'var(--yarg-emerald)'
const BLUE = 'var(--yarg-vivid-sky-blue)'
const DEEP_BLUE = 'var(--yarg-brandeis-blue)'
const ORANGE = 'var(--yarg-ut-orange)'
const VIOLET = 'var(--yarg-veronica)'
const WHITE = 'var(--yarg-white)'

/**
 * Cue → the colours that are lit during it.
 *
 * Read off YARG's own StageKit interpreter, which is the closest thing to a
 * statement of intent — it drives four physical LED colours, and which of them
 * are on during a cue is not a matter of taste.
 *
 * Order matters: it is the order the wash walks. Single-entry palettes are
 * cues that really are one solid colour (`intro` and `silhouettes` are both
 * flat green), and those correctly sit still.
 *
 * Anything absent means no tint, which is right for more cues than not — the
 * blackouts, the menu and score states, and the strobe values that only ever
 * appear in a field we don't read.
 */
const CUE_PALETTE: Partial<Record<LightingCue, readonly string[]>> = {
  warmManual: [RED, ORANGE, YELLOW],
  warmAutomatic: [RED, ORANGE, YELLOW],
  coolManual: [BLUE, GREEN],
  coolAutomatic: [BLUE, GREEN],
  searchlights: [YELLOW, BLUE, RED],
  sweep: [RED, YELLOW, DEEP_BLUE, GREEN],
  harmony: [YELLOW, RED, GREEN, BLUE],
  bigRockEnding: [RED, YELLOW, GREEN, BLUE],
  frenzy: [RED, DEEP_BLUE, YELLOW],
  stomp: [YELLOW, BLUE],
  flareFast: [GREEN, BLUE],
  silhouettesSpotlight: [BLUE, GREEN],
  intro: [GREEN],
  silhouettes: [GREEN],
  flareSlow: [WHITE],
  dischord: [VIOLET],
}

/**
 * Grade → colour, where the grade names one.
 *
 * These outrank the cue and they do not drift, because they genuinely don't:
 * a cue is a lighting pattern, but `contrastRed` is a filter over the whole
 * camera. If YARG says the screen is red, the screen is red and stays red.
 */
const GRADE_TINT: Partial<Record<PostProcessing, string>> = {
  contrastRed: RED,
  desaturatedRed: RED,
  photoNegativeRedAndBlack: RED,
  contrastBlue: BLUE,
  desaturatedBlue: BLUE,
  scanlinesBlue: BLUE,
  polarizedRedAndBlue: DEEP_BLUE,
  contrastGreen: GREEN,
  sepiaTone: YELLOW,
  grainyFilm: YELLOW,
}

/**
 * Grades that drain the venue of colour.
 *
 * They suppress the cue rather than falling through to it. A chart that asks
 * for black and white and gets an orange wash is worse than one that gets
 * nothing.
 */
const MONOCHROME = new Set<PostProcessing>([
  'blackAndWhite',
  'silverTone',
  'choppyBlackAndWhite',
  'polarizedBlackAndWhite',
  'scanlinesBlackAndWhite',
])

/** Held back deliberately: this is a wash behind text, not a light show. */
const BASE_OPACITY = 0.22
const CHORUS_OPACITY = 0.3

/**
 * How long the wash rests on one colour before moving to the next.
 *
 * Eight beats — two bars in common time — so the drift is tied to the song
 * without tracking it closely enough to read as a pulse. Clamped because a
 * doom-metal chart and a speedcore chart should both land somewhere between
 * "did that change?" and "stop doing that".
 */
const BEATS_PER_STEP = 8
const DEFAULT_STEP_MS = 4_000
const MIN_STEP_MS = 2_500
const MAX_STEP_MS = 6_000

function stepMs(bpm: number | null): number {
  if (bpm === null || bpm <= 0) return DEFAULT_STEP_MS
  const beats = (BEATS_PER_STEP * 60_000) / bpm
  return Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, beats))
}

export interface VenueWash {
  /** A colour token, or null when the banner should sit at its own colour. */
  color: string | null
  /**
   * The colour already on screen, which `color` comes up over.
   *
   * The drift is drawn as one layer fading in on top of another rather than as
   * a `background-color` that interpolates, because the second of those repaints
   * — see `.venue-wash` in `index.css`. Two layers need to know what they are
   * fading *from*, and it has to be what was actually last painted: the palette
   * changes under this whenever the cue does, so the colour one step back in the
   * current palette is frequently a colour that was never on screen.
   */
  previous: string | null
  /** How much of it to let through. */
  opacity: number
  /** Fade length — always the full step, so the colour never sits still. */
  fadeMs: number
}

export const NO_WASH: VenueWash = {
  color: null,
  previous: null,
  opacity: 0,
  fadeMs: DEFAULT_STEP_MS,
}

/** The palette in play right now, before any drift is applied. */
function palette(venue: VenueState): readonly string[] {
  if (!venue.streaming) return []

  const grade = venue.grade
  if (grade !== null && MONOCHROME.has(grade)) return []

  const graded = grade !== null ? GRADE_TINT[grade] : undefined
  if (graded !== undefined) return [graded]

  return (venue.cue !== null ? CUE_PALETTE[venue.cue] : undefined) ?? []
}

/**
 * The wash colour for this moment.
 *
 * Drift is a timer rather than anything driven from the server: forwarding the
 * beat would mean an event per beat per phone, to move a colour that takes two
 * bars to arrive. Tempo is enough to set the pace, and a few hundred
 * milliseconds of phase error is invisible in a four-second fade.
 */
export function useVenueWash(venue: VenueState): VenueWash {
  const colors = palette(venue)
  const period = stepMs(venue.bpm)

  const [step, setStep] = useState(0)

  // Joined rather than compared by identity: `palette` builds a fresh array
  // every render, so the array itself is never stable.
  const key = colors.join(' ')

  useEffect(() => {
    if (colors.length < 2) return

    const timer = setInterval(() => setStep((previous) => previous + 1), period)
    return () => clearInterval(timer)
  }, [key, period, colors.length])

  const color = colors.length === 0 ? null : (colors[step % colors.length] ?? null)

  /*
   * What was on screen last time this committed.
   *
   * Read during render and written after it, which is the only order that is
   * safe: a ref written while rendering would be a different value depending on
   * how many times React chose to render, and this has to be the colour that
   * was actually *painted*. Null on the first pass, so a wash arriving on a
   * banner that had none fades up out of nothing rather than out of a colour
   * the palette had not shown yet.
   */
  const shown = useRef<string | null>(null)
  const previous = shown.current
  useEffect(() => {
    shown.current = color
  }, [color])

  if (color === null) return NO_WASH

  return {
    color,
    previous,
    opacity: venue.section === 'chorus' ? CHORUS_OPACITY : BASE_OPACITY,
    fadeMs: period,
  }
}
