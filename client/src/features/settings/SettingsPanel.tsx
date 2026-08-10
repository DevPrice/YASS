/**
 * Settings.
 *
 * The two paths here are the whole configuration story today: where YARG writes
 * its state, and where the user saved the CSV song-list export. Both are
 * text inputs rather than a file picker — the server may be running headless or
 * on another machine, so a browser file dialog would pick the wrong filesystem.
 */

import { useEffect, useState } from 'react'

import type { Settings, SettingsView } from '@shared/types'
import { Button, Panel, TextField, cx } from '../../ui'
import { fetchSettings, saveSettings } from '../../lib/api'

export function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [yargDataDir, setYargDataDir] = useState('')
  const [songListCsvPath, setSongListCsvPath] = useState('')
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'error'; message?: string }>({
    kind: 'idle',
  })

  useEffect(() => {
    void fetchSettings()
      .then((loaded) => {
        setView(loaded)
        setYargDataDir(loaded.settings.yargDataDir)
        setSongListCsvPath(loaded.settings.songListCsvPath)
      })
      .catch((err: unknown) => {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      })
  }, [])

  const save = async () => {
    setStatus({ kind: 'saving' })

    try {
      const saved = await saveSettings({ yargDataDir, songListCsvPath })
      setView(saved)
      setStatus({ kind: 'idle' })
      onSaved()
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  if (!view) {
    return (
      <Panel className="p-6 text-sm text-content-muted">
        {status.kind === 'error' ? status.message : 'Loading settings…'}
      </Panel>
    )
  }

  return (
    <Panel className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-content" htmlFor="yargDataDir">
          YARG data folder
        </label>
        <TextField
          id="yargDataDir"
          value={yargDataDir}
          onChange={(event) => setYargDataDir(event.target.value)}
          placeholder={view.defaultYargDataDir}
          spellCheck={false}
        />
        <PathStatus
          ok={view.status.currentSongJsonExists}
          okText="Found currentSong.json — now-playing is live."
          badText="No currentSong.json here. Check the build channel (release / nightly / dev), or the -persistent-data-path YARG was launched with."
        />
        <EnvOverrideNote field="yargDataDir" view={view} />
        <p className="text-xs text-content-faint">
          Default for this machine: <code className="text-content-muted">{view.defaultYargDataDir}</code>
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-content" htmlFor="songListCsvPath">
          Song list (CSV export)
        </label>
        <TextField
          id="songListCsvPath"
          value={songListCsvPath}
          onChange={(event) => setSongListCsvPath(event.target.value)}
          placeholder="C:\path\to\songs.csv"
          spellCheck={false}
        />
        <PathStatus
          ok={view.status.songListCsvExists}
          okText="Song list found."
          badText="No CSV at this path yet."
        />
        <EnvOverrideNote field="songListCsvPath" view={view} />
        <p className="text-xs text-content-faint">
          In YARG: Settings → Export Songs List → CSV. The list is a snapshot, so re-export
          after adding songs and hit Reload.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button tone="confirm" onClick={() => void save()} disabled={status.kind === 'saving'}>
          {status.kind === 'saving' ? 'saving' : 'save settings'}
        </Button>
        {status.kind === 'error' ? (
          <span className="text-[13px] text-danger">{status.message}</span>
        ) : null}
      </div>
    </Panel>
  )
}

function PathStatus({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <p className={cx('text-[13px]', ok ? 'text-success' : 'text-danger')}>{ok ? okText : badText}</p>
  )
}

/**
 * Warn when an environment variable is forcing a field.
 *
 * Saving still works — it writes the settings file — but the running process
 * keeps using the variable, so without this note the value would appear to
 * revert on its own.
 */
function EnvOverrideNote({ field, view }: { field: keyof Settings; view: SettingsView }) {
  if (!view.envOverrides.includes(field)) return null

  return (
    <p className="text-[13px] text-warning">
      Set by an environment variable, which wins until it&apos;s unset. Saving records your
      value in the settings file but won&apos;t change this run.
    </p>
  )
}
