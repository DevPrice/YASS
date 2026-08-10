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

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

// --- Button -----------------------------------------------------------------

/** Tones as authored in the design system's Button (fill at 75%, brighter ring). */
type ButtonTone = 'confirm' | 'accent' | 'danger' | 'neutral'

const BUTTON_TONES: Record<ButtonTone, { fill: string; ring: string }> = {
  confirm: { fill: 'rgba(23,226,137,0.75)', ring: '#43FFAD' },
  accent: { fill: 'rgba(69,216,254,0.75)', ring: '#A5EFFF' },
  danger: { fill: 'rgba(243,43,55,0.75)', ring: '#FF7B84' },
  neutral: { fill: 'rgba(47,52,77,0.75)', ring: '#7B7F9A' },
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
  const { fill, ring } = BUTTON_TONES[tone]

  return (
    <button
      type="button"
      className={cx(
        'yarg-label inline-flex items-center justify-center gap-[10px] px-[20px] text-[13px] text-white',
        'h-[38px] cursor-pointer transition-[filter,background] duration-160',
        'hover:brightness-115 disabled:cursor-default disabled:opacity-30 disabled:hover:brightness-100',
        FOCUS_RING,
        className,
      )}
      style={{
        borderRadius: 'var(--radius-round)',
        background: quiet ? 'transparent' : fill,
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
        'shadow-[inset_0_0_0_2px_var(--yarg-border-card)] transition-shadow duration-160',
        className,
      )}
      style={{ borderRadius: 'var(--radius-pill)' }}
    >
      {leading ? <span className="shrink-0 text-content-faint">{leading}</span> : null}
      <input
        ref={inputRef}
        className="min-w-0 flex-1 bg-transparent py-[9px] text-[15px] text-content placeholder:text-content-faint focus:outline-none"
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
        'shadow-[inset_0_0_0_2px_var(--yarg-border-card)] transition-shadow duration-160',
        'hover:shadow-[inset_0_0_0_2px_var(--yarg-dark-6)]',
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
        tone === 'accent' ? 'text-accent' : 'text-count-muted',
      )}
      style={{
        borderRadius: 'var(--radius-sm)',
        background:
          tone === 'accent'
            ? 'linear-gradient(90deg, rgba(69,216,254,0.5) 0%, transparent 100%)'
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
}: PropsWithChildren<{ active: boolean; onClick: () => void; title?: string }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cx(
        'yarg-label cursor-pointer px-[15px] py-[6px] text-[11px] transition-all duration-160',
        active ? 'text-white' : 'text-content-muted opacity-60 hover:opacity-100',
        FOCUS_RING,
      )}
      style={{
        borderRadius: 'var(--radius-pill)',
        background: active ? 'rgba(69,216,254,0.2)' : 'transparent',
        boxShadow: active
          ? 'inset 0 0 0 2px rgba(69,216,254,0.5)'
          : 'inset 0 0 0 2px var(--yarg-border-card)',
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
export function HelperBar({ children }: PropsWithChildren) {
  return (
    <div
      className="flex h-[52px] shrink-0 items-center gap-[25px] bg-surface-bar px-[15px]"
      style={{ boxShadow: 'var(--shadow-bar)' }}
    >
      {children}
    </div>
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
