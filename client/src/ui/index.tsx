/**
 * Presentational primitives, following the YARG design system's recipes.
 *
 * Upstream components are ported to Tailwind rather than vendored verbatim, so
 * the codebase keeps one styling idiom. `design/README.md` records which
 * upstream file each port came from and how to check for drift.
 *
 * Because a port is a fork, style through the vendored tokens and never through
 * literal values — that way re-vendoring tokens still picks up most upstream
 * changes without touching these files.
 *
 * Recipes followed:
 *   - Display type is UPPERCASE; label strings are authored lowercase.
 *   - Buttons are pills: tinted fill at 75% plus a 2px inset ring.
 *   - Cards are a flat fill plus a 2px inset stroke. No drop shadows.
 *   - Hover lifts brightness or fills a 20% tint. Never scale, never bounce.
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
} from 'react'

import randomSvg from '../design/assets/icons/random.svg?raw'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * The design system's shuffle icon.
 *
 * Imported `?raw` and inlined rather than used as an `<img src>`, because the
 * vendored icons were normalized to `currentColor` and a URL can't inherit
 * colour — the icon has to be in the document to pick up the button's text
 * colour across tones and hover.
 *
 * `dangerouslySetInnerHTML` on a build-time constant from our own repo, with no
 * interpolation, is the no-dependency version of this. If more of the eight
 * icons come into use, `vite-plugin-svgr` is the upgrade.
 */
export function RandomIcon() {
  return (
    <span
      aria-hidden
      className="inline-flex size-[18px] shrink-0 [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: randomSvg }}
    />
  )
}

/**
 * Focus ring, defined in `index.css` rather than as Tailwind's `ring-*`.
 *
 * `ring-*` compiles to a box-shadow, and Button, ToggleChip and TextField all
 * set `boxShadow` inline for their inset stroke — an inline style wins, so the
 * ring never rendered on them. An outline can't be overridden that way and
 * survives forced-colors mode.
 */
const FOCUS_RING = 'yarg-focusable'

/**
 * Touch sizing.
 *
 * Gated on `pointer: coarse` rather than a width breakpoint, because the two
 * questions are different: a 1280px laptop with a touchscreen needs the bigger
 * target and a 700px desktop window does not. The game's own 38px control
 * height stays exactly as authored wherever there's a mouse.
 */
const TOUCH_HEIGHT = 'pointer-coarse:min-h-[44px]'

// --- Button -----------------------------------------------------------------

/** Tones as authored in the design system's Button (fill at 75%, brighter ring). */
type ButtonTone = 'confirm' | 'accent' | 'danger' | 'neutral'

/**
 * Fill, ring, and the text colour the fill can actually carry.
 *
 * The fills come from the tokens through `color-mix` rather than being retyped
 * as `rgba(...)`. That was not just tidiness: the confirm fill had been
 * transcribed as `#17E289`, which is not `--yarg-emerald` `#2BE18D` — a fifth
 * green nobody chose.
 *
 * **Text colour is per tone because white does not survive every fill.** Over
 * the light tints white lands at 2.90:1 (accent) and 2.97:1 (confirm), under
 * even the 3:1 large-text floor. Night on those same fills is 6.88:1 and
 * 6.72:1. That is what `--color-accent-content` was mapped for; it had just
 * never been used. The dark tones keep white, which they carry at 6.36:1
 * (danger) and 14.35:1 (neutral).
 *
 * Ring colours stay as authored. They are highlight tints that exist only on
 * this component, they are not in the token file, and every one of them clears
 * 5:1 against the surfaces it sits on.
 */
const BUTTON_TONES: Record<ButtonTone, { fill: string; ring: string; text: string }> = {
  confirm: {
    fill: 'color-mix(in srgb, var(--yarg-emerald) 75%, transparent)',
    ring: '#43FFAD',
    text: 'var(--yarg-night)',
  },
  accent: {
    fill: 'color-mix(in srgb, var(--yarg-vivid-sky-blue) 75%, transparent)',
    ring: 'var(--yarg-text-cyan-soft)',
    text: 'var(--yarg-night)',
  },
  danger: {
    fill: 'color-mix(in srgb, var(--yarg-imperial-red) 75%, transparent)',
    ring: '#FF7B84',
    text: 'var(--yarg-white)',
  },
  neutral: {
    fill: 'color-mix(in srgb, var(--yarg-dark-6) 75%, transparent)',
    ring: 'var(--yarg-dark-7)',
    text: 'var(--yarg-white)',
  },
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone
  /** Quieter variant for toolbar actions — no fill until hovered. */
  quiet?: boolean
  icon?: ReactNode
}

export function Button({
  tone = 'neutral',
  quiet = false,
  icon,
  className,
  children,
  style,
  ...props
}: ButtonProps) {
  const { fill, ring, text } = BUTTON_TONES[tone]

  return (
    <button
      type="button"
      className={cx(
        'yarg-label inline-flex items-center justify-center gap-[10px] px-[20px] text-[13px]',
        'h-[38px] cursor-pointer transition-[filter,background] duration-160',
        'hover:brightness-115 disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100',
        TOUCH_HEIGHT,
        FOCUS_RING,
        className,
      )}
      style={{
        borderRadius: 'var(--radius-round)',
        background: quiet ? 'transparent' : fill,
        // A quiet button has no fill, so it takes its colour from the page,
        // not from what the fill could have carried.
        color: quiet ? 'var(--yarg-white)' : text,
        boxShadow: quiet ? 'none' : `inset 0 0 0 2px ${ring}`,
        ...style,
      }}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}

// --- Text field --------------------------------------------------------------

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode
  trailing?: ReactNode
  /** Explicit rather than `ref`, so it lands on the input and not the wrapper. */
  inputRef?: Ref<HTMLInputElement>
}

/** Inset pill on the sunken surface, matching the game's search field. */
export function TextField({ leading, trailing, className, inputRef, ...props }: TextFieldProps) {
  return (
    <div
      className={cx(
        'flex items-center gap-[10px] bg-surface-sunken px-[15px]',
        'focus-within:shadow-[inset_0_0_0_2px_rgba(69,216,254,0.5)]',
        'shadow-[inset_0_0_0_2px_var(--color-border-strong)] transition-shadow duration-160',
        // The inset glow reads as the field lighting up, which is the design's
        // own language — but it's a box-shadow, so forced-colors drops it. The
        // outline rides along and is the only cue left in that mode.
        'yarg-focusable-within',
        className,
      )}
      style={{ borderRadius: 'var(--radius-pill)' }}
    >
      {leading ? <span className="shrink-0 text-content-faint">{leading}</span> : null}
      <input
        ref={inputRef}
        className={cx(
          'min-w-0 flex-1 bg-transparent py-[9px] text-[15px] text-content',
          'placeholder:text-content-faint focus:outline-none',
          // The wrapper carries the focus treatment, so the input suppressing
          // its own outline is intentional — see `focus-within` above.
          'pointer-coarse:py-[13px]',
        )}
        {...props}
      />
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </div>
  )
}

// --- Select ------------------------------------------------------------------

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}

export function Select({ label, className, children, ...props }: SelectProps) {
  const select = (
    <select
      className={cx(
        'w-full appearance-none bg-surface-sunken px-[15px] py-[9px] text-[14px] text-content',
        'shadow-[inset_0_0_0_2px_var(--color-border-strong)] transition-shadow duration-160',
        'hover:shadow-[inset_0_0_0_2px_var(--yarg-white)]',
        TOUCH_HEIGHT,
        FOCUS_RING,
        className,
      )}
      style={{ borderRadius: 'var(--radius-md)' }}
      {...props}
    >
      {children}
    </select>
  )

  if (!label) return select

  return (
    <label className="flex flex-col gap-[5px]">
      <span className="yarg-label text-[11px] text-count-muted">{label}</span>
      {select}
    </label>
  )
}

// --- Badge -------------------------------------------------------------------

export function Badge({
  children,
  title,
  tone = 'neutral',
}: PropsWithChildren<{ title?: string; tone?: 'neutral' | 'accent' }>) {
  return (
    <span
      title={title}
      className={cx(
        'yarg-label inline-flex items-center px-[8px] py-[3px] text-[10px]',
        tone === 'accent' ? 'text-white' : 'text-count-muted',
      )}
      style={{
        borderRadius: 'var(--radius-sm)',
        background:
          tone === 'accent'
            ? 'linear-gradient(90deg, rgba(69,216,254,0.45) 0%, transparent 100%)'
            : 'var(--yarg-surface-sunken)',
      }}
    >
      {children}
    </span>
  )
}

// --- Toggle chip -------------------------------------------------------------

/** Filter chip. Inactive chips sit dimmed and rise to full on hover. */
export function ToggleChip({
  active,
  onClick,
  children,
  title,
  label,
}: PropsWithChildren<{
  active: boolean
  onClick: () => void
  title?: string
  /** Spoken name, when the visible text alone doesn't carry the state. */
  label?: string
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        'yarg-label inline-flex cursor-pointer items-center gap-[5px] px-[15px] py-[6px]',
        'text-[11px] transition-all duration-160',
        active ? 'text-white' : 'text-content-faint hover:text-content',
        TOUCH_HEIGHT,
        FOCUS_RING,
      )}
      style={{
        borderRadius: 'var(--radius-pill)',
        background: active ? 'rgba(69,216,254,0.2)' : 'transparent',
        boxShadow: active
          ? 'inset 0 0 0 2px rgba(69,216,254,0.5)'
          : 'inset 0 0 0 2px var(--color-border-strong)',
      }}
    >
      {children}
    </button>
  )
}

// --- Layout helpers -----------------------------------------------------------

export function Panel({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <div className={cx('yarg-card', className)}>{children}</div>
}

/**
 * The helper bar.
 *
 * Kept from the game even though a browser has no gamepad — it's the strongest
 * identity cue in YARG's chrome. Treat it as branding, not a control surface.
 */
export function HelperBar({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cx(
        'flex h-[52px] shrink-0 items-center gap-[25px] bg-surface-bar px-[15px]',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-bar)' }}
    >
      {children}
    </div>
  )
}

/**
 * Sort direction chevron.
 *
 * Drawn rather than the ▲/▼ characters the file used to reach for: those pick
 * up whatever the fallback font decides, sit off the text baseline, and get
 * announced by screen readers. This one inherits `currentColor` and rotates,
 * so ascending and descending are the same shape.
 */
export function SortArrow({ direction }: { direction: 'asc' | 'desc' }) {
  return (
    <svg
      width="9"
      height="6"
      viewBox="0 0 9 6"
      fill="none"
      aria-hidden
      className="shrink-0 transition-transform duration-160"
      style={{ rotate: direction === 'asc' ? '180deg' : '0deg' }}
    >
      <path
        d="M1 1L4.5 4.5L8 1"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function EmptyState({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="flex flex-col items-center justify-center gap-[15px] px-[25px] py-[100px] text-center">
      <p className="yarg-label text-[20px] text-content">{title}</p>
      <div className="max-w-md text-[15px] text-content-muted">{children}</div>
    </div>
  )
}
