/**
 * The settings popover.
 *
 * Deliberately not a route in the web client. The client is what a room full
 * of guests is browsing; this shows absolute filesystem paths, the bind
 * address and a button that stops the server, and it belongs to the host
 * alone. The server's settings endpoints agree — they 404 for anything that
 * didn't arrive over loopback.
 *
 * Everything it can do goes through `window.yass`, the context-bridge surface
 * from `src/preload.ts`. There is no `fetch`, no filesystem, no Node.
 */

import { StrictMode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ENV_VARS, type Settings } from '@shared/types.js'
// Type-only, and it has to stay that way: `src/` is main-process code, and the
// renderer has no way to run any of it. The import is erased at build time.
import type { DesktopApi, DesktopState } from '../src/ipc.js'

import { QrCode } from './qr.js'

import './index.css'

declare global {
  interface Window {
    yass: DesktopApi
  }
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// --- Primitives -------------------------------------------------------------

const FOCUS = 'yarg-focusable'

const FIELD_CLASS = cx(
  'w-full rounded-[5px] bg-surface-sunken px-2.5 py-1.5 text-body text-content',
  'border border-border-strong outline-none placeholder:text-content-faint',
  'focus:border-accent',
  // A field the environment is forcing looks like what it is. Editable and
  // inert is the state this window used to offer, and then say "saved" about.
  'read-only:text-content-muted read-only:border-border',
  'disabled:text-content-muted disabled:border-border',
  FOCUS,
)

function Button({
  tone = 'neutral',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'accent' | 'neutral' | 'danger' }) {
  /*
   * The design system's buttons are pills: a fill at 75% plus a brighter 2px
   * inset ring. Text colour is per tone because white does not survive the
   * light accent fill — it lands under 3:1, where Night is 6.88:1.
   */
  const tones = {
    accent: {
      background: 'color-mix(in srgb, var(--yarg-vivid-sky-blue) 75%, transparent)',
      boxShadow: 'inset 0 0 0 2px var(--yarg-text-cyan-soft)',
      color: 'var(--yarg-night)',
    },
    neutral: {
      background: 'color-mix(in srgb, var(--yarg-dark-6) 75%, transparent)',
      boxShadow: 'inset 0 0 0 2px var(--yarg-dark-7)',
      color: 'var(--yarg-white)',
    },
    danger: {
      background: 'color-mix(in srgb, var(--yarg-imperial-red) 75%, transparent)',
      boxShadow: 'inset 0 0 0 2px #FF7B84',
      color: 'var(--yarg-white)',
    },
  }[tone]

  return (
    <button
      type="button"
      {...props}
      style={tones}
      className={cx(
        'yarg-label rounded-[50px] px-3 py-2 text-label tracking-wide',
        'transition-[filter] hover:brightness-125 disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100',
        FOCUS,
        className,
      )}
    />
  )
}

/** A bordered text button, for things that sit beside content rather than under it. */
function QuietButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        // `min-h-6` is SC 2.5.8's 24px floor: this was a 45×20 target, three
        // times over on a machine with several network adapters.
        'yarg-label inline-flex min-h-6 shrink-0 items-center rounded-[5px] px-2.5 text-label',
        'border border-border-strong text-content-muted hover:text-content',
        FOCUS,
        className,
      )}
    />
  )
}

/**
 * A found/not-found marker.
 *
 * The whole point of the settings screen is catching a path that has moved, so
 * the state of every path is stated rather than implied — and stated in words
 * as well as colour, because a red dot alone says nothing to somebody who
 * can't see it as red.
 */
function PathStatus({ ok, found, missing }: { ok: boolean; found: string; missing: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 text-note',
        ok ? 'text-success' : 'text-warning',
      )}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: 'currentColor' }}
      />
      {ok ? found : missing}
    </span>
  )
}

/**
 * The settings, folded away.
 *
 * A host opens this window to read an address or to fix something; they change
 * a path maybe twice a year. `<details>` rather than a hand-rolled toggle,
 * because the keyboard behaviour and the accessibility tree come with it.
 */
function Disclosure({
  summary,
  flagged,
  open,
  onToggle,
  children,
}: {
  summary: string
  flagged: boolean
  open: boolean
  onToggle: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <details
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="group rounded-[10px] border border-border"
    >
      <summary
        className={cx(
          'flex cursor-default list-none items-center gap-2 rounded-[10px] px-3 py-2.5',
          '[&::-webkit-details-marker]:hidden',
          FOCUS,
        )}
      >
        <span className="yarg-label flex-1 text-label text-content-muted">{summary}</span>
        {/* Something in here needs looking at, said before it is opened. */}
        {flagged ? <span aria-hidden className="size-1.5 rounded-full bg-warning" /> : null}
        <svg
          viewBox="0 0 12 12"
          aria-hidden
          className="size-3 text-content-faint transition-transform group-open:rotate-180"
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="space-y-3 px-3 pb-3">{children}</div>
    </details>
  )
}

/**
 * A labelled control.
 *
 * The label wraps nothing, on purpose. It used to enclose the control *and* its
 * browse button *and* its hint, so the accessible name Chrome computed for the
 * path field was the whole lot run together — "YARG DATA FOLDER BROWSE
 * currentSong.json found". Now the label points at one control by id and the
 * surrounding prose is attached as a description, which is what a description
 * is for.
 */
function Field({
  label,
  hint,
  env,
  children,
}: {
  label: string
  hint?: React.ReactNode
  /** The environment variable forcing this field, if one is. */
  env?: string
  children: (control: { id: string; 'aria-describedby': string | undefined }) => React.ReactNode
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const envId = env ? `${id}-env` : undefined
  const describedBy = [envId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="yarg-label text-label text-content-muted">
          {label}
        </label>
        {/* The variable's own name, rather than a tooltip nobody opens saying
            the words "env override". You cannot unset what you cannot name. */}
        {env ? (
          <code id={envId} className="selectable font-numeric text-label text-warning">
            set by {env}
          </code>
        ) : null}
      </div>
      {children({ id, 'aria-describedby': describedBy })}
      {hint ? (
        <span id={hintId} className="text-note text-content-faint">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

/** Copy something, and say so where the user is already looking. */
function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return [
    copied,
    () => {
      window.yass.copyText(text)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1400)
    },
  ]
}

function CopyRow({ url, label }: { url: string; label?: string }) {
  const [copied, copy] = useCopy(url)

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <code className="selectable block truncate font-numeric text-note text-accent">
          {url}
        </code>
        {label ? <span className="text-label text-content-faint">{label}</span> : null}
      </div>
      {/* Three buttons named exactly "copy" used to sit in the tab order with
          their addresses in adjacent non-focusable elements. */}
      <QuietButton aria-label={`Copy ${url}`} onClick={copy}>
        {copied ? 'copied' : 'copy'}
      </QuietButton>
    </div>
  )
}

/** `192.168.1.24:4321` → the address and the port, so the two can differ in weight. */
function splitPort(authority: string): [string, string] {
  const at = authority.lastIndexOf(':')
  return at === -1 ? [authority, ''] : [authority.slice(0, at), authority.slice(at + 1)]
}

/**
 * The one string this window exists to move into somebody's phone.
 *
 * It used to render at 12px under an 18px wordmark — the fourth-largest text in
 * a window whose entire output it is. Now it is the largest, in the numeric
 * face, next to a code that skips the typing altogether.
 */
function AddressBlock({ state }: { state: DesktopState }) {
  const primary = state.lan[0] ?? null
  const url = primary?.url ?? state.localUrl
  const [copied, copy] = useCopy(url ?? '')

  if (!url) return null

  const [host, port] = splitPort(url.replace(/^https?:\/\//, ''))
  const others = state.lan.slice(1)

  return (
    <>
      <div className="mt-3 flex items-start gap-3">
        <QrCode value={url} />

        <div className="min-w-0 flex-1">
          <p className="font-numeric text-address leading-none">
            <span className="selectable text-content">{host}</span>
            <span className="text-content-muted">:{port}</span>
          </p>
          <p className="mt-1.5 text-note text-content-faint">
            {primary ? primary.name : 'this machine only'}
          </p>
          <div className="mt-2.5">
            <QuietButton aria-label={`Copy ${url}`} onClick={copy}>
              {copied ? 'copied' : 'copy'}
            </QuietButton>
          </div>
        </div>
      </div>

      {/*
       * The rest, demoted rather than hidden. A developer's machine answers
       * with VirtualBox and WSL addresses that look exactly like the real one
       * and go nowhere; the ranking is a heuristic, so it must never be the
       * only way to reach an address it guessed wrong about.
       */}
      {others.length > 0 ? (
        <details className="group mt-2.5">
          <summary
            className={cx(
              'yarg-label inline-flex min-h-6 cursor-default list-none items-center gap-1.5',
              'rounded-[5px] pr-1 text-label text-content-muted hover:text-content',
              '[&::-webkit-details-marker]:hidden',
              FOCUS,
            )}
          >
            {others.length} other {others.length === 1 ? 'address' : 'addresses'}
            <svg
              viewBox="0 0 12 12"
              aria-hidden
              className="size-3 transition-transform group-open:rotate-180"
            >
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </summary>
          <div className="mt-2 space-y-2">
            {others.map((entry) => (
              <CopyRow key={entry.url} url={entry.url} label={entry.name} />
            ))}
          </div>
        </details>
      ) : null}

      <p className="mt-2.5 text-note text-content-faint">
        {primary
          ? "Point a guest's camera at the code. If they can't reach it, the firewall prompt was probably dismissed."
          : 'Bound to this machine only — nothing on the network can reach it.'}
      </p>
    </>
  )
}

// --- Status -----------------------------------------------------------------

const WAITING_TEXT: Record<DesktopState['server']['status'], string> = {
  starting: 'Starting…',
  running: 'Loading the song list…',
  stopped: 'Stopped',
  failed: 'Not running',
}

/**
 * What the card should be *about* — a different question from what the process
 * is doing.
 *
 * A server that bound its socket and loaded nothing is `running`, and saying so
 * in emerald above an address to hand out is true and useless: the guest opens
 * an empty app. Zero is not a count, it is a failure with a number in it, so it
 * gets its own case and its own remedy.
 */
type Health = 'failed' | 'empty' | 'ready' | 'waiting'

function health(state: DesktopState): Health {
  if (state.server.status === 'failed') return 'failed'
  if (state.server.status !== 'running' || state.songs === null) return 'waiting'
  return state.songs.count === 0 ? 'empty' : 'ready'
}

/**
 * How old the export is, in the units somebody would say out loud.
 *
 * The server watches the CSV, so the file being current is never in doubt — but
 * nothing watches YARG, and the list is exported by hand. "You installed songs
 * and last exported three weeks ago" is the single most likely reason a host is
 * looking at this window at all.
 */
function exportedAgo(at: number | null): { text: string; stale: boolean } | null {
  if (at === null) return null

  const days = Math.floor((Date.now() - at) / 86_400_000)
  if (days < 2) return null

  const stale = days >= 21
  if (days < 14) return { text: `exported ${days} days ago`, stale }
  if (days < 60) return { text: `exported ${Math.round(days / 7)} weeks ago`, stale }
  return { text: `exported ${Math.round(days / 30)} months ago`, stale }
}

/**
 * The headline word, said about the health rather than about the process.
 *
 * "Running" in emerald over an empty library is the exact sentence this window
 * used to open with, and it is the reason a host hands out an address to an app
 * with nothing in it.
 */
function headline(state: DesktopState, kind: Health): { label: string; tone: string } {
  if (kind === 'ready') return { label: 'Running', tone: 'text-success' }
  if (kind === 'empty') return { label: 'No songs', tone: 'text-warning' }
  if (kind === 'failed') return { label: 'Not running', tone: 'text-danger' }
  return { label: WAITING_TEXT[state.server.status], tone: 'text-content-muted' }
}

/** Enough warnings to recognise the problem by; a malformed CSV has hundreds. */
const WARNINGS_SHOWN = 3

function StatusBlock({
  state,
  busy,
  onRestart,
  onTryPort,
  onChooseExport,
}: {
  state: DesktopState
  busy: boolean
  onRestart: () => void
  onTryPort: (port: number) => void
  onChooseExport: () => void
}) {
  const songs = state.songs
  const kind = health(state)
  const status = headline(state, kind)
  const age = exportedAgo(songs?.generatedAt ?? null)

  /*
   * The remedy is offered only for the failure it actually remedies. A port one
   * number along fixes a collision and does nothing at all for a permissions
   * error, and a button that quietly fails twice is worse than no button.
   */
  const portTaken = kind === 'failed' && (state.server.message?.includes('already in use') ?? false)
  const nextPort = Math.min(65535, state.view.settings.port + 1)

  const hidden = songs ? songs.warnings.length - WARNINGS_SHOWN : 0

  return (
    <section className="rounded-[10px] bg-surface-card p-3" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center gap-2">
        {/*
         * A live region, because this window's entire purpose is telling you
         * what state the server is in and it used to announce none of it.
         */}
        <span role="status" className={cx('yarg-label flex-1 text-body', status.tone)}>
          {status.label}
        </span>
        {/* Beside the state it acts on, rather than in a row of unrelated verbs. */}
        {kind === 'ready' ? (
          <QuietButton
            aria-label="Open YASS in the browser"
            onClick={() => window.yass.openInBrowser()}
          >
            open
          </QuietButton>
        ) : null}
        <Button onClick={onRestart} disabled={busy}>
          {busy ? 'working…' : 'restart server'}
        </Button>
      </div>

      {state.server.message ? (
        <p role="alert" className="selectable mt-2 text-body text-danger">
          {state.server.message}
        </p>
      ) : null}

      {portTaken ? (
        <div className="mt-2.5">
          <Button tone="accent" disabled={busy} onClick={() => onTryPort(nextPort)}>
            try port {nextPort}
          </Button>
        </div>
      ) : null}

      {kind === 'empty' ? (
        <>
          <p className="mt-2 text-body text-content-muted">
            YARG writes the list from Settings → Export Songs List. Point YASS at it and the
            guests get a library.
          </p>
          <div className="mt-2.5">
            <Button tone="accent" disabled={busy} onClick={onChooseExport}>
              choose the export…
            </Button>
          </div>
        </>
      ) : null}

      {kind === 'ready' && songs ? (
        <p aria-live="polite" className="mt-2 text-body text-content-muted">
          <span className="font-numeric text-content">{songs.count.toLocaleString()}</span> songs
          loaded
          {age ? (
            <span className={age.stale ? 'text-warning' : 'text-content-faint'}>
              {' · '}
              {age.text}
            </span>
          ) : null}
        </p>
      ) : null}

      {songs && songs.warnings.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {songs.warnings.slice(0, WARNINGS_SHOWN).map((warning) => (
            <li key={warning} className="selectable text-note text-warning">
              {warning}
            </li>
          ))}
          {hidden > 0 ? (
            <li className="text-note text-content-faint">and {hidden} more like it</li>
          ) : null}
        </ul>
      ) : null}

      {/* Only once there is something at the other end of it to browse. */}
      {kind === 'ready' ? <AddressBlock state={state} /> : null}
    </section>
  )
}

// --- The form ---------------------------------------------------------------

/**
 * What the measurement has to add back: `py-4` top and bottom, plus the 1px
 * border the frameless window wears on each edge. Two pixels short and the
 * window grows a scrollbar for content that fits.
 */
const SCROLLER_PADDING = 32 + 2

/** The bind addresses worth offering; anything else the file already holds. */
const HOSTS = [
  { value: '0.0.0.0', label: 'Everything on the network' },
  { value: '127.0.0.1', label: 'This machine only' },
]

function hostLabel(value: string): string {
  return HOSTS.find((option) => option.value === value)?.label ?? value
}

/**
 * What the socket is on, against what the settings say — in a sentence that
 * names whichever one actually moved.
 *
 * The banner used to announce "the bind address only takes effect when the
 * server starts" whenever the *port* changed, which is a message about a field
 * the host did not touch. The draft is merged over the saved values, so this is
 * equally true before the save and after it, and it disappears by itself if you
 * edit the value back to what is already bound.
 */
function bindingPending(state: DesktopState, draft: Partial<Settings>): string | null {
  const bound = state.server
  if (bound.host === null || bound.port === null) return null

  const effective = { ...state.view.settings, ...draft }
  const portMoved = effective.port !== bound.port
  const hostMoved = effective.host !== bound.host

  if (portMoved && hostMoved) {
    return `The server is still on ${bound.host}:${bound.port}. Restart it to move to ${effective.host}:${effective.port}.`
  }
  if (portMoved) {
    return `The server is still on port ${bound.port}. Restart it to move to ${effective.port}.`
  }
  if (hostMoved) {
    return `The server is still reachable from “${hostLabel(bound.host)}”. Restart it to move.`
  }
  return null
}

function App() {
  const [state, setState] = useState<DesktopState | null>(null)
  const [draft, setDraft] = useState<Partial<Settings>>({})
  const [busy, setBusy] = useState(false)
  /** What the last save actually did, or null. */
  const [saved, setSaved] = useState<string | null>(null)
  /** The last thing that went wrong, because silence is not a response. */
  const [failure, setFailure] = useState<string | null>(null)
  /** Null until the host has an opinion; the default is computed from the paths. */
  const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null)

  const scrollerRef = useRef<HTMLElement>(null)
  const footerRef = useRef<HTMLElement>(null)

  const apply = useCallback((next: DesktopState) => {
    setState(next)
    // A push that lands mid-edit must not overwrite what is being typed, so
    // only the fields nobody has touched come from the server.
    setDraft((current) => {
      const kept: Partial<Settings> = {}
      for (const [key, value] of Object.entries(current)) {
        const live = next.view.settings[key as keyof Settings]
        if (value !== live) (kept as Record<string, unknown>)[key] = value
      }
      return kept
    })
  }, [])

  useEffect(() => {
    void window.yass.getState().then(setState)
    return window.yass.onState(apply)
  }, [apply])

  // A confirmation that never expires stops being a confirmation: the footer
  // used to still read "saved" ten minutes after a save nobody remembers.
  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(null), 2500)
    return () => window.clearTimeout(timer)
  }, [saved])

  /**
   * Tell main how tall this wants to be.
   *
   * Measured first-child-top to last-child-bottom rather than from the
   * scroller's `scrollHeight`: the scroller is `flex-1`, so its scroll height
   * can never come out smaller than the window, and the window could grow but
   * never shrink back.
   */
  const measure = useCallback(() => {
    const scroller = scrollerRef.current
    const first = scroller?.firstElementChild
    const last = scroller?.lastElementChild
    if (!first || !last) return

    const content = last.getBoundingClientRect().bottom - first.getBoundingClientRect().top
    window.yass.resize(content + SCROLLER_PADDING + (footerRef.current?.offsetHeight ?? 0))
  }, [])

  // After every render, because every render is a content change.
  useEffect(measure)
  // And once more when the faces land, which moves every line of text.
  useEffect(() => void document.fonts.ready.then(measure), [measure])

  const settings: Settings | null = useMemo(
    () => (state ? { ...state.view.settings, ...draft } : null),
    [state, draft],
  )

  const dirty = Object.keys(draft).length > 0

  if (!state || !settings) {
    return <div className="grid h-full place-items-center text-note text-content-faint">…</div>
  }

  const { status, envOverrides } = state.view
  const locked = (key: keyof Settings) => envOverrides.includes(key)
  const envVar = (key: keyof Settings) => (locked(key) ? ENV_VARS[key] : undefined)

  const edit = (patch: Partial<Settings>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setSaved(null)
  }

  /** Every rejection reaches a person, rather than resolving into nothing. */
  const report = (error: unknown) =>
    setFailure(error instanceof Error ? error.message : String(error))

  const run = async (action: () => Promise<DesktopState | void>) => {
    setBusy(true)
    setFailure(null)
    try {
      const next = await action()
      if (next) apply(next)
    } catch (error) {
      // Without this the window's response to a failed save is that the button
      // stops saying "working…" and nothing else happens anywhere.
      report(error)
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const outcome = await window.yass.saveSettings(draft)
      setDraft({})
      // Which of the two things a save can mean. `host` and `port` are the only
      // settings a running server can't take live, and the banner below says
      // which one is waiting.
      setSaved(outcome.applied ? 'saved and applied' : 'saved to the settings file')
      return outcome.state
    })

  /** The remedy for a taken port: move one along, then go there. */
  const tryPort = (port: number) =>
    run(async () => {
      await window.yass.saveSettings({ port })
      setDraft({})
      setSaved(null)
      return window.yass.restartServer()
    })

  /** The remedy for an empty library: the picker, straight from the card. */
  const chooseExport = () =>
    run(async () => {
      const picked = await window.yass.pickFile(settings.songListCsvPath)
      if (!picked) return
      setDraft({})
      return (await window.yass.saveSettings({ songListCsvPath: picked })).state
    })

  const pending = bindingPending(state, draft)

  // Opened for you when a path is wrong, because that is the one time the
  // settings are the reason you came.
  const needsAttention = !status.yargDataDirExists || !status.songListCsvExists

  return (
    <div className="flex h-full flex-col bg-surface text-content">
      {/*
       * No wordmark. You arrived here by clicking an icon you already know the
       * name of, and the 44px it cost was paid for out of the content below it.
       */}
      <main ref={scrollerRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <StatusBlock
          state={state}
          busy={busy}
          onRestart={() => void run(() => window.yass.restartServer())}
          onTryPort={(port) => void tryPort(port)}
          onChooseExport={() => void chooseExport()}
        />

        {failure ? (
          <p
            role="alert"
            className="selectable rounded-[5px] px-3 py-2 text-body text-danger"
            style={{ background: 'color-mix(in srgb, var(--yarg-imperial-red) 12%, transparent)' }}
          >
            {failure}
          </p>
        ) : null}

        {pending ? (
          <p
            className="rounded-[5px] px-3 py-2 text-body text-warning"
            style={{ background: 'color-mix(in srgb, var(--yarg-mustard) 12%, transparent)' }}
          >
            {pending}
          </p>
        ) : null}

        <Disclosure
          summary="Settings"
          flagged={needsAttention}
          open={settingsOpen ?? needsAttention}
          onToggle={setSettingsOpen}
        >
          {!state.liveApply && state.server.status === 'running' ? (
            <p className="text-note text-content-faint">
              Bound to one specific address, so changes are written to the settings file and
              applied on the next restart rather than live.
            </p>
          ) : null}

          <Field
            label="YARG data folder"
            env={envVar('yargDataDir')}
            hint={
              <PathStatus
                ok={status.currentSongJsonExists}
                found="currentSong.json found"
                missing={
                  status.yargDataDirExists
                    ? 'no currentSong.json yet — YARG writes it when it plays'
                    : 'folder not found'
                }
              />
            }
          >
            {(control) => (
              <div className="flex gap-2">
                <input
                  {...control}
                  className={FIELD_CLASS}
                  value={settings.yargDataDir}
                  spellCheck={false}
                  readOnly={locked('yargDataDir')}
                  onChange={(event) => edit({ yargDataDir: event.target.value })}
                />
                <Button
                  className="shrink-0"
                  aria-label="Browse for the YARG data folder"
                  disabled={locked('yargDataDir')}
                  onClick={() =>
                    void window.yass
                      .pickDirectory(settings.yargDataDir)
                      .then((picked) => {
                        // Cancel returns null and must leave the field alone.
                        if (picked) edit({ yargDataDir: picked })
                      })
                      .catch(report)
                  }
                >
                  browse
                </Button>
              </div>
            )}
          </Field>

          <Field
            label="Song list export"
            env={envVar('songListCsvPath')}
            hint={
              settings.songListCsvPath ? (
                <PathStatus ok={status.songListCsvExists} found="found" missing="file not found" />
              ) : (
                "YARG writes this from Settings → Export Songs List. Without it there's no song list."
              )
            }
          >
            {(control) => (
              <div className="flex gap-2">
                <input
                  {...control}
                  className={FIELD_CLASS}
                  value={settings.songListCsvPath}
                  spellCheck={false}
                  placeholder="not configured"
                  readOnly={locked('songListCsvPath')}
                  onChange={(event) => edit({ songListCsvPath: event.target.value })}
                />
                <Button
                  className="shrink-0"
                  aria-label="Browse for the song list export"
                  disabled={locked('songListCsvPath')}
                  onClick={() =>
                    void window.yass
                      .pickFile(settings.songListCsvPath)
                      .then((picked) => {
                        if (picked) edit({ songListCsvPath: picked })
                      })
                      .catch(report)
                  }
                >
                  browse
                </Button>
              </div>
            )}
          </Field>

          <Field
            label="Reachable from"
            env={envVar('host')}
            hint="Guests need this on the network. Restart the server to change it."
          >
            {(control) => (
              <select
                {...control}
                className={FIELD_CLASS}
                value={settings.host}
                disabled={locked('host')}
                onChange={(event) => edit({ host: event.target.value })}
              >
                {HOSTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                {/* Whatever the file holds stays selectable, so opening this
                    window can never silently rewrite a hand-edited address. */}
                {HOSTS.every((option) => option.value !== settings.host) ? (
                  <option value={settings.host}>{settings.host}</option>
                ) : null}
              </select>
            )}
          </Field>

          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Port" env={envVar('port')}>
                {(control) => (
                  <input
                    {...control}
                    className={cx(FIELD_CLASS, 'font-numeric')}
                    type="number"
                    min={1}
                    max={65535}
                    readOnly={locked('port')}
                    value={settings.port}
                    onChange={(event) => edit({ port: Number(event.target.value) })}
                  />
                )}
              </Field>
            </div>

            <div className="flex-1">
              <Field label="Poll interval" hint="ms" env={envVar('pollIntervalMs')}>
                {(control) => (
                  <input
                    {...control}
                    className={cx(FIELD_CLASS, 'font-numeric')}
                    type="number"
                    min={250}
                    max={10000}
                    step={250}
                    readOnly={locked('pollIntervalMs')}
                    value={settings.pollIntervalMs}
                    onChange={(event) => edit({ pollIntervalMs: Number(event.target.value) })}
                  />
                )}
              </Field>
            </div>
          </div>

          {/* `min-h-6` so the click target clears SC 2.5.8; the box itself is 16px. */}
          <label className="flex min-h-6 items-center gap-2.5 pt-1">
            <input
              type="checkbox"
              className={cx('size-4 accent-[var(--yarg-vivid-sky-blue)]', FOCUS)}
              checked={state.openAtLogin}
              onChange={(event) =>
                void run(() => window.yass.setOpenAtLogin(event.target.checked))
              }
            />
            <span className="text-body text-content-muted">Start YASS when I sign in</span>
          </label>

          <p className="font-numeric text-note text-content-faint">YASS v{state.version}</p>
        </Disclosure>
      </main>

      {/*
       * Only while there is something to commit. A permanent bar of four verbs
       * cost 58px of a window that cannot be resized, and three of the four are
       * in the tray's own menu — including the one that stops the music.
       */}
      {dirty || saved ? (
        <footer ref={footerRef} className="flex items-center gap-3 border-t border-border px-4 py-3">
          <Button
            tone="accent"
            disabled={!dirty || busy}
            onClick={() => void save()}
            className="min-w-[92px]"
          >
            {busy ? 'saving…' : 'save'}
          </Button>
          {dirty ? (
            <span className="text-note text-content-faint">
              Unsaved — this window forgets them when it closes.
            </span>
          ) : saved ? (
            <span role="status" className="text-note text-success">
              {saved}
            </span>
          ) : null}
        </footer>
      ) : null}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
