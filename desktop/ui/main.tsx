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

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { Settings } from '@shared/types.js'
// Type-only, and it has to stay that way: `src/` is main-process code, and the
// renderer has no way to run any of it. The import is erased at build time.
import type { DesktopApi, DesktopState } from '../src/ipc.js'

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
  'w-full rounded-[5px] bg-surface-sunken px-2.5 py-1.5 text-[13px] text-content',
  'border border-border-strong outline-none placeholder:text-content-faint',
  'focus:border-accent',
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
        'yarg-label rounded-[50px] px-3 py-2 text-[11px] tracking-wide',
        'transition-[filter] hover:brightness-125 disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100',
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
        'inline-flex items-center gap-1.5 text-[11px]',
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

function Field({
  label,
  hint,
  overridden,
  children,
}: {
  label: string
  hint?: React.ReactNode
  overridden?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="yarg-label text-[11px] text-content-muted">{label}</span>
        {overridden ? (
          <span className="text-[10px] text-warning" title="Set by an environment variable">
            env override
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="text-[11px] text-content-faint">{hint}</span> : null}
    </label>
  )
}

/** Copy a URL, and say so where the user is already looking. */
function CopyRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <div className="flex items-center gap-2">
      <code className="selectable min-w-0 flex-1 truncate font-numeric text-[12px] text-accent">
        {url}
      </code>
      <button
        type="button"
        className={cx(
          'yarg-label shrink-0 rounded-[5px] px-2 py-1 text-[10px] text-content-muted',
          'border border-border-strong hover:text-content',
          FOCUS,
        )}
        onClick={() => {
          window.yass.copyText(url)
          setCopied(true)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setCopied(false), 1400)
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  )
}

// --- Status -----------------------------------------------------------------

const STATUS_TEXT: Record<DesktopState['server']['status'], { label: string; tone: string }> = {
  starting: { label: 'Starting…', tone: 'text-content-muted' },
  running: { label: 'Running', tone: 'text-success' },
  stopped: { label: 'Stopped', tone: 'text-content-muted' },
  failed: { label: 'Not running', tone: 'text-danger' },
}

function StatusBlock({
  state,
  onRestart,
  busy,
}: {
  state: DesktopState
  onRestart: () => void
  busy: boolean
}) {
  const status = STATUS_TEXT[state.server.status]
  const songs = state.songs

  return (
    <section className="rounded-[10px] bg-surface-card p-3" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className={cx('yarg-label text-[13px]', status.tone)}>{status.label}</span>
        <Button onClick={onRestart} disabled={busy}>
          {busy ? 'working…' : 'restart server'}
        </Button>
      </div>

      {state.server.message ? (
        <p className="selectable mt-2 text-[12px] text-danger">{state.server.message}</p>
      ) : null}

      {state.server.status === 'running' ? (
        <>
          <p className="mt-2 text-[12px] text-content-muted">
            {songs === null ? (
              'Loading the song list…'
            ) : (
              <>
                <span className="font-numeric text-content">{songs.count.toLocaleString()}</span>{' '}
                songs loaded
              </>
            )}
          </p>

          {songs?.warnings.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {songs.warnings.map((warning) => (
                <li key={warning} className="selectable text-[11px] text-warning">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 space-y-1.5">
            {state.lanUrls.length > 0 ? (
              state.lanUrls.map((url) => <CopyRow key={url} url={url} />)
            ) : state.localUrl ? (
              <CopyRow url={state.localUrl} />
            ) : null}
          </div>

          {state.lanUrls.length > 0 ? (
            <p className="mt-2 text-[11px] text-content-faint">
              Hand one of these to a guest. If they can't reach it, the firewall prompt was
              probably dismissed.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-content-faint">
              Bound to this machine only — nothing on the network can reach it.
            </p>
          )}
        </>
      ) : null}
    </section>
  )
}

// --- The form ---------------------------------------------------------------

/** The bind addresses worth offering; anything else the file already holds. */
const HOSTS = [
  { value: '0.0.0.0', label: 'Everything on the network' },
  { value: '127.0.0.1', label: 'This machine only' },
]

function App() {
  const [state, setState] = useState<DesktopState | null>(null)
  const [draft, setDraft] = useState<Partial<Settings>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

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

  const settings: Settings | null = useMemo(
    () => (state ? { ...state.view.settings, ...draft } : null),
    [state, draft],
  )

  const dirty = Object.keys(draft).length > 0

  if (!state || !settings) {
    return <div className="grid h-full place-items-center text-[12px] text-content-faint">…</div>
  }

  const { status, envOverrides } = state.view
  const overridden = (key: keyof Settings) => envOverrides.includes(key)
  const edit = (patch: Partial<Settings>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setSaved(false)
  }

  const run = async (action: () => Promise<DesktopState | void>) => {
    setBusy(true)
    try {
      const next = await action()
      if (next) apply(next)
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const next = await window.yass.saveSettings(draft)
      setDraft({})
      setSaved(true)
      return next
    })

  // The port is the only setting that can't be applied live, so it is the only
  // one that can put the app in a "restart to apply" state.
  const portPending = dirty && (draft.port !== undefined || draft.host !== undefined)

  return (
    <div className="flex h-full flex-col bg-surface text-content">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <h1 className="yarg-label text-[18px] text-content">YASS</h1>
        <span className="font-numeric text-[10px] text-content-faint">v{state.version}</span>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <StatusBlock
          state={state}
          busy={busy}
          onRestart={() => void run(() => window.yass.restartServer())}
        />

        {state.restartRequired || portPending ? (
          <p
            className="rounded-[5px] px-3 py-2 text-[12px] text-warning"
            style={{ background: 'color-mix(in srgb, var(--yarg-mustard) 12%, transparent)' }}
          >
            The bind address only takes effect when the server starts. Restart it to move to
            the new one.
          </p>
        ) : null}

        {!state.liveApply && state.server.status === 'running' ? (
          <p className="text-[11px] text-content-faint">
            Bound to one specific address, so changes are written to the settings file and
            applied on the next restart rather than live.
          </p>
        ) : null}

        <Field
          label="YARG data folder"
          overridden={overridden('yargDataDir')}
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
          <div className="flex gap-2">
            <input
              className={FIELD_CLASS}
              value={settings.yargDataDir}
              spellCheck={false}
              onChange={(event) => edit({ yargDataDir: event.target.value })}
            />
            <Button
              className="shrink-0"
              onClick={() =>
                void window.yass.pickDirectory(settings.yargDataDir).then((picked) => {
                  // Cancel returns null and must leave the field alone.
                  if (picked) edit({ yargDataDir: picked })
                })
              }
            >
              browse
            </Button>
          </div>
        </Field>

        <Field
          label="Song list export"
          overridden={overridden('songListCsvPath')}
          hint={
            settings.songListCsvPath ? (
              <PathStatus ok={status.songListCsvExists} found="found" missing="file not found" />
            ) : (
              "YARG writes this from Settings → Export Songs List. Without it there's no song list."
            )
          }
        >
          <div className="flex gap-2">
            <input
              className={FIELD_CLASS}
              value={settings.songListCsvPath}
              spellCheck={false}
              placeholder="not configured"
              onChange={(event) => edit({ songListCsvPath: event.target.value })}
            />
            <Button
              className="shrink-0"
              onClick={() =>
                void window.yass.pickFile(settings.songListCsvPath).then((picked) => {
                  if (picked) edit({ songListCsvPath: picked })
                })
              }
            >
              browse
            </Button>
          </div>
        </Field>

        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Port" overridden={overridden('port')}>
              <input
                className={cx(FIELD_CLASS, 'font-numeric')}
                type="number"
                min={1}
                max={65535}
                value={settings.port}
                onChange={(event) => edit({ port: Number(event.target.value) })}
              />
            </Field>
          </div>

          <div className="flex-1">
            <Field label="Poll interval" overridden={overridden('pollIntervalMs')}>
              <input
                className={cx(FIELD_CLASS, 'font-numeric')}
                type="number"
                min={250}
                max={10000}
                step={250}
                value={settings.pollIntervalMs}
                onChange={(event) => edit({ pollIntervalMs: Number(event.target.value) })}
              />
            </Field>
          </div>
        </div>

        <Field
          label="Reachable from"
          overridden={overridden('host')}
          hint="Guests need this on the network. Restart the server to change it."
        >
          <select
            className={FIELD_CLASS}
            value={settings.host}
            onChange={(event) => edit({ host: event.target.value })}
          >
            {HOSTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {/* Whatever the file holds stays selectable, so opening this window
                can never silently rewrite a hand-edited bind address. */}
            {HOSTS.every((option) => option.value !== settings.host) ? (
              <option value={settings.host}>{settings.host}</option>
            ) : null}
          </select>
        </Field>

        <label className="flex items-center gap-2.5 pt-1">
          <input
            type="checkbox"
            className={cx('size-4 accent-[var(--yarg-vivid-sky-blue)]', FOCUS)}
            checked={state.openAtLogin}
            onChange={(event) =>
              void run(() => window.yass.setOpenAtLogin(event.target.checked))
            }
          />
          <span className="text-[12px] text-content-muted">Start YASS when I sign in</span>
        </label>
      </div>

      <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
        <Button
          tone="accent"
          disabled={!dirty || busy}
          onClick={() => void save()}
          className="min-w-[92px]"
        >
          {saved && !dirty ? 'saved' : 'save'}
        </Button>
        <Button onClick={() => void window.yass.reloadClients()} disabled={!state.liveApply}>
          reload browsers
        </Button>
        <Button
          onClick={() => window.yass.openInBrowser()}
          disabled={state.server.status !== 'running'}
        >
          open
        </Button>
        <span className="flex-1" />
        <Button tone="danger" onClick={() => window.yass.quit()}>
          quit
        </Button>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
