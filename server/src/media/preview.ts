/**
 * Thirty seconds of a song, for a guest holding a phone.
 *
 * The hard part is not the encoding, it is choosing *which* thirty seconds and
 * *what* to mix — because a preview that starts on silence, or that plays only
 * the backing track, is worse than no preview.
 *
 * ## The window is YARG's, exactly
 *
 * `previewWindow` is a transcription of `YARG.Core/Audio/PreviewContext.cs`.
 * That matters because the chart author chose `preview_start_time` for a
 * reason, and because a song YASS previews from 0:20 and YARG previews from
 * 1:14 is two products disagreeing about the same file. All four branches are
 * ported, including the one where only an end time is given.
 *
 * ## The mix has to be a mix
 *
 * `song.ogg` in an ini chart is not the song — it is the **backing track**, the
 * part with no instruments on it. Measured on this library, it is 7 dB quieter
 * than the sum of the seven stems, and on a well-charted song it can be nearly
 * silent. So a preview mixes every stem except `crowd`, which is what YARG
 * plays. A chart that ships an explicit `preview.ogg` is the exception: that
 * file *is* the preview, and it is used alone.
 *
 * ## Output
 *
 * Opus at 64 kbps, ~150-200 KB, seekable, and playable in every browser a
 * guest might arrive with. Loudness-normalised, because a library assembled
 * from a hundred charters has no consistent level, and a preview that blows
 * someone's ears out is the last one they will play.
 *
 * `-ss` goes *before* each `-i`, so ffmpeg seeks to the window rather than
 * decoding from zero and discarding a minute of audio. That is the difference
 * between 0.7 s and something nobody would wait for over a network share.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openConPackage, findConListing } from './stfs.js'
import { parseDta, findSongNode, readSongAudio } from './dta.js'
import { runFfmpeg } from './ffmpeg.js'
import { openSngPackage } from './sng.js'
import { mediaCacheDir } from './store.js'
import type { ChartRef } from './types.js'

/** `PreviewContext`'s three constants. */
const DEFAULT_PREVIEW_DURATION = 30
const DEFAULT_START_TIME = 20
const DEFAULT_END_TIME = 50

/** Stems YARG mixes, in its order. `crowd` is deliberately absent. */
export const PREVIEW_STEMS = [
  'song',
  'guitar',
  'bass',
  'rhythm',
  'keys',
  'vocals',
  'vocals_1',
  'vocals_2',
  'drums',
  'drums_1',
  'drums_2',
  'drums_3',
  'drums_4',
] as const

/** `IniAudio.SupportedFormats`, in preference order. */
export const AUDIO_EXTENSIONS = ['.opus', '.ogg', '.mp3', '.wav', '.aiff'] as const

/** `preview.opus`, `preview.ogg`, … — a chart's own pre-made preview. */
export const PREVIEW_FILES = AUDIO_EXTENSIONS.map((extension) => `preview${extension}`)

export interface PreviewWindow {
  start: number
  /** Duration in seconds, which is what `-t` wants. */
  duration: number
}

export interface PreviewTiming {
  /** `preview_start_time` in ms. Negative or absent means unset. */
  startMs: number | null
  /** `preview_end_time` in ms. Zero or negative means unset. */
  endMs: number | null
  /** Length of the audio the window is being taken out of, in seconds. */
  lengthSeconds: number
}

/**
 * Where a preview should start and how long it should run.
 *
 * A direct port of `PreviewContext.Create`. The branch conditions look
 * redundant in places — `startMs < 0 || startSec >= length` tests both the
 * sentinel and the range — and they are kept that way on purpose: this is the
 * kind of logic where "tidying" the conditions silently changes which songs
 * take which branch.
 */
export function previewWindow(timing: PreviewTiming): PreviewWindow {
  const length = timing.lengthSeconds
  const startMs = timing.startMs ?? -1
  const endMs = timing.endMs ?? -1
  const startSec = startMs / 1000
  const endSec = endMs / 1000

  let start = 0
  let end: number

  if ((startMs < 0 || startSec >= length) && (endMs <= 0 || endSec > length)) {
    // Neither bound is usable. YARG's default is 0:20-0:50, which is far enough
    // in to be past an intro on most songs.
    if (DEFAULT_END_TIME <= length) {
      start = DEFAULT_START_TIME
      end = DEFAULT_END_TIME
    } else if (DEFAULT_PREVIEW_DURATION <= length) {
      start = (length - DEFAULT_PREVIEW_DURATION) / 2
      end = start + DEFAULT_PREVIEW_DURATION
    } else {
      start = 0
      end = length
    }
  } else if (startSec >= 0 && startSec < length) {
    start = startSec
    end = endSec
    if (end <= start) end = start + DEFAULT_PREVIEW_DURATION
    if (end > length) end = length
  } else {
    // Only an end time. Back up thirty seconds from it.
    end = endSec
    start = end - DEFAULT_PREVIEW_DURATION
    if (start < 0) start = 0
  }

  return { start, duration: Math.max(0, end - start) }
}

/** Parse a `key = value` line out of a `song.ini`. */
function readIniNumber(text: string, wanted: string): number | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('[')) continue

    const split = trimmed.indexOf('=')
    if (split === -1) continue

    if (trimmed.slice(0, split).trim().toLowerCase() === wanted) {
      const value = Number(trimmed.slice(split + 1).trim())
      return Number.isFinite(value) ? value : null
    }
  }

  return null
}

/**
 * Ask ffmpeg how long a file is.
 *
 * Via `ffmpeg -i` rather than `ffprobe`, because the fetched install carries
 * only `ffmpeg.exe` — probing with a tool we might not have would make
 * durations work on developer machines and fail on users'.
 *
 * ffmpeg exits non-zero when given no output file, which is expected here; the
 * duration is on stderr either way.
 */
async function probeDuration(ffmpegPath: string, path: string): Promise<number | null> {
  try {
    const { stderr } = await runFfmpeg(ffmpegPath, ['-hide_banner', '-i', path], {
      timeoutMs: 15_000,
    })

    const match = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(stderr)
    if (match === null) return null

    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  } catch {
    return null
  }
}

/** dB to a linear gain multiplier. */
const dbToGain = (db: number): number => Math.pow(10, db / 20)

/**
 * Constant-power stereo placement for one mogg channel.
 *
 * `pan` runs -1 (hard left) to 1 (hard right). Constant power rather than
 * linear, so a centred channel is not 3 dB quieter than a hard-panned one —
 * which is what makes a naive downmix of an eight-channel mogg sound hollow.
 */
function channelGains(pan: number, volumeDb: number): { left: number; right: number } {
  const clamped = Math.max(-1, Math.min(1, pan))
  const gain = dbToGain(volumeDb)

  return {
    left: gain * Math.sqrt((1 - clamped) / 2),
    right: gain * Math.sqrt((1 + clamped) / 2),
  }
}

/** Everything needed to run one ffmpeg invocation. */
interface PreviewPlan {
  /** Absolute paths, one `-i` each. */
  inputs: string[]
  /** Files to delete afterwards — extracted container payloads. */
  temporary: string[]
  /** The audio's own length, for the window calculation. */
  lengthSeconds: number | null
  startMs: number | null
  endMs: number | null
  /**
   * A `pan` filter, for the single multichannel input a mogg gives us.
   * Null when the inputs are ordinary stems to be `amix`ed.
   */
  panFilter: string | null
}

async function tempDir(): Promise<string> {
  const dir = join(mediaCacheDir(), 'tmp')
  await mkdir(dir, { recursive: true })
  return dir
}

/** Loose ini chart: a preview file, or every stem but the crowd. */
async function planIni(ref: ChartRef, ffmpegPath: string): Promise<PreviewPlan | null> {
  let names: Map<string, string>
  try {
    names = new Map(
      (await readdir(ref.path, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => [entry.name.toLowerCase(), entry.name]),
    )
  } catch {
    return null
  }

  let startMs: number | null = null
  let endMs: number | null = null

  const iniName = names.get('song.ini')
  if (iniName !== undefined) {
    try {
      const text = await readFile(join(ref.path, iniName), 'utf8')
      startMs = readIniNumber(text, 'preview_start_time')
      endMs = readIniNumber(text, 'preview_end_time')
    } catch {
      // No metadata; the defaults apply.
    }
  }

  // A chart's own preview file is used alone, and its length is its own.
  for (const candidate of PREVIEW_FILES) {
    const actual = names.get(candidate)
    if (actual === undefined) continue

    const path = join(ref.path, actual)
    return {
      inputs: [path],
      temporary: [],
      lengthSeconds: await probeDuration(ffmpegPath, path),
      startMs,
      endMs,
      panFilter: null,
    }
  }

  const inputs: string[] = []
  for (const stem of PREVIEW_STEMS) {
    for (const extension of AUDIO_EXTENSIONS) {
      const actual = names.get(`${stem}${extension}`)
      if (actual !== undefined) {
        inputs.push(join(ref.path, actual))
        break
      }
    }
  }

  if (inputs.length === 0) return null

  return {
    inputs,
    temporary: [],
    // Probing the first stem is one extra ffmpeg call and avoids depending on
    // the CSV having a length for this song.
    lengthSeconds: await probeDuration(ffmpegPath, inputs[0]!),
    startMs,
    endMs,
    panFilter: null,
  }
}

/**
 * SNG container: the same choice, but the audio has to come out first.
 *
 * Everything inside is masked, so ffmpeg cannot read it in place and cannot
 * seek within it — each stem is written whole to a temp file. That makes an
 * SNG preview the most expensive kind, which is why they are generated on
 * demand and then kept.
 */
async function planSng(ref: ChartRef, ffmpegPath: string, hash: string): Promise<PreviewPlan | null> {
  const pkg = await openSngPackage(ref.path)
  if (pkg === null) return null

  const temporary: string[] = []
  const dir = await tempDir()

  try {
    const startMs = Number(pkg.metadata.get('preview_start_time') ?? NaN)
    const endMs = Number(pkg.metadata.get('preview_end_time') ?? NaN)

    const write = async (name: string): Promise<string> => {
      const listing = pkg.listings.get(name)!
      const path = join(dir, `${hash}.${name}`)
      await writeFile(path, await pkg.readFile(listing))
      temporary.push(path)
      return path
    }

    for (const candidate of PREVIEW_FILES) {
      if (!pkg.listings.has(candidate)) continue

      const path = await write(candidate)
      return {
        inputs: [path],
        temporary,
        lengthSeconds: await probeDuration(ffmpegPath, path),
        startMs: Number.isFinite(startMs) ? startMs : null,
        endMs: Number.isFinite(endMs) ? endMs : null,
        panFilter: null,
      }
    }

    const inputs: string[] = []
    for (const stem of PREVIEW_STEMS) {
      for (const extension of AUDIO_EXTENSIONS) {
        const name = `${stem}${extension}`
        if (pkg.listings.has(name)) {
          inputs.push(await write(name))
          break
        }
      }
    }

    if (inputs.length === 0) return null

    return {
      inputs,
      temporary,
      lengthSeconds: await probeDuration(ffmpegPath, inputs[0]!),
      startMs: Number.isFinite(startMs) ? startMs : null,
      endMs: Number.isFinite(endMs) ? endMs : null,
      panFilter: null,
    }
  } catch {
    return null
  } finally {
    await pkg.close()
  }
}

/**
 * Console package: one multichannel `.mogg`.
 *
 * A mogg is an `int32` version, an `int32` offset, and then a plain
 * multichannel Ogg Vorbis stream. Versions other than `0x0A` and `0xF0` are
 * encrypted; YARG refuses those at scan time and so do we — the alternative is
 * feeding ffmpeg noise and emitting a preview of static.
 *
 * The channel layout is not a layout ffmpeg knows: it is whatever the DTA's
 * `pans` and `vols` say, one entry per channel. So the downmix is an explicit
 * `pan` filter rather than ffmpeg's default stereo fold.
 */
async function planCon(ref: ChartRef, hash: string): Promise<PreviewPlan | null> {
  if (ref.subName === undefined) return null

  const pkg = await openConPackage(ref.path)
  if (pkg === null) return null

  try {
    const moggListing = findConListing(pkg, `songs/${ref.subName}/${ref.subName}.mogg`)
    if (moggListing === null) return null

    const mogg = await pkg.read(moggListing)
    if (mogg.length < 8) return null

    const version = mogg.readInt32LE(0)
    if (version !== 0x0a && version !== 0xf0) {
      console.warn(`[media] ${ref.subName}: encrypted mogg (version ${version}); no preview`)
      return null
    }

    const offset = mogg.readInt32LE(4)
    if (offset < 8 || offset >= mogg.length) return null

    const dir = await tempDir()
    const path = join(dir, `${hash}.ogg`)
    await writeFile(path, mogg.subarray(offset))

    let startMs: number | null = null
    let endMs: number | null = null
    let panFilter: string | null = null

    const dtaListing = findConListing(pkg, 'songs/songs.dta')
    if (dtaListing !== null) {
      const document = parseDta((await pkg.read(dtaListing)).toString('utf8'))
      const node = findSongNode(document, ref.dtaName ?? ref.subName)

      if (node !== null) {
        const audio = readSongAudio(node)
        if (audio.preview !== null) {
          startMs = audio.preview.start
          endMs = audio.preview.end
        }
        panFilter = buildPanFilter(audio.pans, audio.vols, audio.crowdChannels)
      }
    }

    return { inputs: [path], temporary: [path], lengthSeconds: null, startMs, endMs, panFilter }
  } catch {
    return null
  } finally {
    await pkg.close()
  }
}

/**
 * An ffmpeg `pan` expression folding N mogg channels to stereo.
 *
 * Returns null when there is nothing to describe, in which case ffmpeg's own
 * downmix runs — which is right for an ordinary stereo mogg and merely
 * approximate for a multitrack one.
 */
export function buildPanFilter(
  pans: readonly number[],
  vols: readonly number[],
  crowdChannels: readonly number[] = [],
): string | null {
  if (pans.length === 0) return null

  const crowd = new Set(crowdChannels)
  const left: string[] = []
  const right: string[] = []

  for (let channel = 0; channel < pans.length; channel++) {
    // The crowd track is applause, not music. YARG leaves it out of a preview
    // and so does the loose-stem path above.
    if (crowd.has(channel)) continue

    const { left: l, right: r } = channelGains(pans[channel]!, vols[channel] ?? 0)
    if (l > 0.0001) left.push(`${l.toFixed(4)}*c${channel}`)
    if (r > 0.0001) right.push(`${r.toFixed(4)}*c${channel}`)
  }

  if (left.length === 0 && right.length === 0) return null

  return `pan=stereo|c0=${left.join('+') || '0*c0'}|c1=${right.join('+') || '0*c0'}`
}

/** An unpacked console package keeps the same files loose on disk. */
async function planExCon(ref: ChartRef, hash: string): Promise<PreviewPlan | null> {
  if (ref.subName === undefined) return null

  const base = join(ref.path, 'songs', ref.subName)

  try {
    const mogg = await readFile(join(base, `${ref.subName}.mogg`))
    if (mogg.length < 8) return null

    const version = mogg.readInt32LE(0)
    if (version !== 0x0a && version !== 0xf0) return null

    const offset = mogg.readInt32LE(4)
    if (offset < 8 || offset >= mogg.length) return null

    const dir = await tempDir()
    const path = join(dir, `${hash}.ogg`)
    await writeFile(path, mogg.subarray(offset))

    let startMs: number | null = null
    let endMs: number | null = null
    let panFilter: string | null = null

    try {
      const document = parseDta(await readFile(join(ref.path, 'songs', 'songs.dta'), 'utf8'))
      const node = findSongNode(document, ref.dtaName ?? ref.subName)

      if (node !== null) {
        const audio = readSongAudio(node)
        if (audio.preview !== null) {
          startMs = audio.preview.start
          endMs = audio.preview.end
        }
        panFilter = buildPanFilter(audio.pans, audio.vols, audio.crowdChannels)
      }
    } catch {
      // No DTA; defaults apply and ffmpeg folds the channels itself.
    }

    return { inputs: [path], temporary: [path], lengthSeconds: null, startMs, endMs, panFilter }
  } catch {
    return null
  }
}

export interface GenerateOptions {
  ffmpegPath: string
  ref: ChartRef
  hash: string
  destination: string
  /**
   * The song's length from the CSV, used when the audio itself cannot be
   * probed cheaply — a mogg, mainly, where probing means a second pass over a
   * file we just extracted.
   */
  fallbackLengthSeconds: number | null
}

/**
 * Build one preview, or return false.
 *
 * False is an ordinary outcome — an encrypted mogg, a chart with no audio, a
 * share that went away — and the route turns it into a 404.
 */
export async function generatePreview(options: GenerateOptions): Promise<boolean> {
  const { ffmpegPath, ref, hash, destination } = options

  let plan: PreviewPlan | null = null

  try {
    switch (ref.format) {
      case 'Ini':
        plan = await planIni(ref, ffmpegPath)
        break
      case 'Sng':
        plan = await planSng(ref, ffmpegPath, hash)
        break
      case 'CON':
        plan = await planCon(ref, hash)
        break
      case 'ExCON':
        plan = await planExCon(ref, hash)
        break
    }

    if (plan === null || plan.inputs.length === 0) return false

    const length = plan.lengthSeconds ?? options.fallbackLengthSeconds
    if (length === null || length <= 0) {
      // With no idea how long the song is there is no way to choose a window,
      // and guessing risks a preview of silence past the end.
      return false
    }

    const window = previewWindow({
      startMs: plan.startMs,
      endMs: plan.endMs,
      lengthSeconds: length,
    })

    if (window.duration <= 0) return false

    const temp = `${destination}.${process.pid}.tmp.opus`
    const args = ['-hide_banner', '-loglevel', 'error', '-y']

    // `-ss` and `-t` before every `-i`, so each input is *seeked* rather than
    // decoded from the beginning and thrown away.
    for (const input of plan.inputs) {
      args.push('-ss', window.start.toFixed(3), '-t', window.duration.toFixed(3), '-i', input)
    }

    const fadeOutAt = Math.max(0, window.duration - 1)
    const chain: string[] = []

    if (plan.panFilter !== null) {
      chain.push(plan.panFilter)
    } else if (plan.inputs.length > 1) {
      // `normalize=0` because ffmpeg's default divides by the input count,
      // which would make a seven-stem chart quieter than a one-stem one — the
      // exact artefact this whole mixing exercise exists to avoid.
      chain.push(`amix=inputs=${plan.inputs.length}:normalize=0`)
    }

    chain.push(
      // Single-pass loudnorm: approximate, but it turns a library of wildly
      // inconsistent charter levels into something you can leave the volume
      // alone for.
      'loudnorm=I=-16:TP=-1.5',
      'afade=t=in:d=0.5',
      `afade=t=out:st=${fadeOutAt.toFixed(3)}:d=1`,
    )

    args.push(
      '-filter_complex',
      chain.join(','),
      '-ac',
      '2',
      '-c:a',
      'libopus',
      '-b:a',
      '64k',
      '-vn',
      temp,
    )

    const result = await runFfmpeg(ffmpegPath, args, { timeoutMs: 90_000 })

    if (result.code !== 0) {
      console.warn(`[media] preview failed (${result.code}): ${result.stderr.trim().slice(0, 400)}`)
      await rm(temp, { force: true })
      return false
    }

    // Guard against ffmpeg exiting 0 with nothing useful — a window that fell
    // entirely past the end of the audio produces a valid, empty file.
    const info = await stat(temp).catch(() => null)
    if (info === null || info.size < 1024) {
      await rm(temp, { force: true })
      return false
    }

    await rename(temp, destination)
    return true
  } catch (error) {
    console.warn('[media] preview generation failed:', error)
    return false
  } finally {
    for (const path of plan?.temporary ?? []) {
      await rm(path, { force: true }).catch(() => {})
    }
  }
}
