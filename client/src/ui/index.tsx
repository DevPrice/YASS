/**
 * Presentational primitives.
 *
 * PLACEHOLDER — these exist so feature code can be written against a stable
 * component API before the YARG design system lands. When that repo becomes the
 * authority, replace the implementations here (or re-export from it) and the
 * feature components should not need to change.
 *
 * Rules for anything in this file:
 *   - No app logic, no data fetching, no knowledge of songs.
 *   - Colours come from the tokens in `index.css`, never hardcoded.
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

// --- Button -----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-content hover:bg-accent-hover',
  secondary:
    'bg-surface-overlay text-content border border-border hover:bg-surface-hover hover:border-border-strong',
  ghost: 'text-content-muted hover:text-content hover:bg-surface-hover',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({ variant = 'secondary', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        FOCUS_RING,
        className,
      )}
      {...props}
    />
  )
}

// --- Text field --------------------------------------------------------------

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Rendered inside the field, before the input — e.g. a search glyph. */
  leading?: ReactNode
  /** Rendered inside the field, after the input — e.g. a clear button. */
  trailing?: ReactNode
}

export function TextField({ leading, trailing, className, ...props }: TextFieldProps) {
  return (
    <div
      className={cx(
        'flex items-center gap-2 rounded-lg border border-border bg-surface-overlay px-3',
        'focus-within:border-border-strong focus-within:ring-2 focus-within:ring-accent/40',
        className,
      )}
    >
      {leading ? <span className="shrink-0 text-content-faint">{leading}</span> : null}
      <input
        className="min-w-0 flex-1 bg-transparent py-2 text-sm text-content placeholder:text-content-faint focus:outline-none"
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
        'w-full appearance-none rounded-lg border border-border bg-surface-overlay px-3 py-2',
        'text-sm text-content hover:border-border-strong',
        FOCUS_RING,
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )

  if (!label) return select

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-content-faint uppercase">
        {label}
      </span>
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
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-none font-medium',
        tone === 'accent'
          ? 'bg-accent/15 text-accent'
          : 'bg-surface-hover text-content-muted',
      )}
    >
      {children}
    </span>
  )
}

// --- Toggle chip -------------------------------------------------------------

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
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-border bg-surface-overlay text-content-muted hover:border-border-strong hover:text-content',
        FOCUS_RING,
      )}
    >
      {children}
    </button>
  )
}

// --- Layout helpers -----------------------------------------------------------

export function Panel({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cx(
        'rounded-card border border-border bg-surface-raised',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function EmptyState({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-base font-medium text-content">{title}</p>
      <div className="max-w-md text-sm text-content-muted">{children}</div>
    </div>
  )
}
