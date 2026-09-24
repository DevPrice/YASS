/**
 * "Is there a newer YASS than this one?"
 *
 * Asks GitHub's releases API and stops there. The button this backs opens the
 * releases page in the host's browser; nothing downloads, installs or restarts
 * itself. That is not a stub for an auto-updater — `electron-updater` cannot
 * update a Windows `portable` target at all, and its AppImage path needs a
 * `publish` provider and a `latest-linux.yml` in the release, which
 * `release.yml` does not produce. Replacing one file where you put it is the
 * whole promise of both formats, and a process that rewrote itself while a
 * room full of guests were browsing would be breaking it.
 *
 * `/releases/latest` rather than the tag list, because it skips drafts and
 * prereleases — which is exactly how this repo ships. A tag build leaves a
 * *draft* holding the binaries and a person publishes it by hand after running
 * them, so this can never offer a release whose notes are unwritten and whose
 * binaries nobody has launched. The same rule hides `v0.2.0`, which is a tag
 * with no release behind it.
 *
 * Manual only: no timer, no check at startup. The one other outbound request
 * this app makes is the ffmpeg download, which is also a button, and "YASS
 * talks to the internet when you ask it to" is worth keeping true. It also
 * keeps a host clear of GitHub's 60-an-hour limit for unauthenticated callers,
 * which is shared by everything else on their address.
 */

import type { UpdateState } from './ipc.js'

/**
 * Hardcoded, not read back from a manifest.
 *
 * `desktop/package.json` has no `repository` field and is packaged inside the
 * asar; adding one and parsing it out at runtime to rebuild a URL that has
 * never changed is more indirection than the constant it would replace.
 */
const REPO = 'DevPrice/YASS'
const LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`

/** Long enough for a slow connection, short enough that a hang ends. */
const TIMEOUT_MS = 10_000

export interface Release {
  /** As tagged, `v` and all. */
  tag: string
  /** The release page, which is what a person is sent to. */
  url: string
  publishedAt: number
}

interface Version {
  release: [number, number, number]
  /** The `-rc.1` part, or null for a plain release. */
  prerelease: string | null
}

/**
 * `v1.2.3`, `1.2.3-rc.1`, `1.2.3+build` — or null for anything else.
 *
 * Build metadata is parsed and then dropped: semver §10 says it takes no part
 * in precedence.
 */
function parseVersion(text: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    text.trim(),
  )
  if (!match) return null

  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  }
}

/** Semver §11: identifier by identifier, numeric below alphanumeric. */
function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0
  // A release outranks every prerelease of the same numbers.
  if (a === null) return 1
  if (b === null) return -1

  const left = a.split('.')
  const right = b.split('.')

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i]
    const r = right[i]

    // A smaller set of identifiers ranks lower when all the preceding ones match.
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue

    const lNumeric = /^\d+$/.test(l)
    const rNumeric = /^\d+$/.test(r)

    if (lNumeric && rNumeric) return Number(l) < Number(r) ? -1 : 1
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1
    return l < r ? -1 : 1
  }

  return 0
}

/**
 * -1, 0 or 1 — or null if either side isn't a version.
 *
 * Null rather than a throw or a lie: the caller has to say something different
 * to the user when it cannot tell, and "0" would read as up to date.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null

  for (let i = 0; i < 3; i += 1) {
    const l = left.release[i] as number
    const r = right.release[i] as number
    if (l !== r) return l < r ? -1 : 1
  }

  return comparePrerelease(left.prerelease, right.prerelease)
}

/** The fields we use, out of a response with about sixty of them. */
export function parseRelease(raw: unknown): Release | null {
  if (!raw || typeof raw !== 'object') return null

  const { tag_name: tag, html_url: url, published_at: published } = raw as Record<string, unknown>
  if (typeof tag !== 'string' || typeof url !== 'string') return null

  const publishedAt = typeof published === 'string' ? Date.parse(published) : Number.NaN

  return { tag, url, publishedAt: Number.isNaN(publishedAt) ? 0 : publishedAt }
}

/**
 * What to say about a release, given the version that is running.
 *
 * Strictly newer only. A copy built from a working tree that is ahead of the
 * published release — which every local `npm run dist` is, between a bump and
 * a tag — is up to date, not a candidate for being talked backwards.
 */
export function pickUpdate(release: Release, current: string): UpdateState {
  const order = compareVersions(current, release.tag)

  // Names both sides rather than blaming the tag: the running version comes
  // from a manifest and should always parse, but a message that asserts which
  // half is wrong should be right about it.
  if (order === null) {
    return {
      status: 'failed',
      message: `Could not compare “${release.tag}” with v${current}.`,
    }
  }

  if (order >= 0) return { status: 'current', version: current }

  return {
    status: 'available',
    version: release.tag.replace(/^v/, ''),
    url: release.url,
    publishedAt: release.publishedAt,
  }
}

/**
 * Ask GitHub, and turn every way that can go wrong into a sentence.
 *
 * Never rejects. The popover has one line to say what happened in, and an
 * unreachable GitHub is the most likely outcome of pressing this button on a
 * machine that is hosting a party on its own LAN.
 */
export async function checkForUpdate(current: string): Promise<UpdateState> {
  let response: Response

  try {
    response = await fetch(LATEST_RELEASE, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // Required: the API refuses a request that doesn't identify itself.
        'User-Agent': `YASS/${current} (+https://github.com/${REPO})`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { status: 'failed', message: 'Could not reach GitHub.' }
  }

  if (!response.ok) {
    // 403 and 429 are both how the unauthenticated hourly limit arrives, and
    // it is shared by every other caller behind this address.
    if (response.status === 403 || response.status === 429) {
      return { status: 'failed', message: 'GitHub is rate-limiting this network. Try later.' }
    }

    // What `/releases/latest` returns when nothing is published yet — a repo
    // holding only drafts answers this way too.
    if (response.status === 404) {
      return { status: 'failed', message: 'GitHub has no published release to compare against.' }
    }

    return { status: 'failed', message: `GitHub answered ${response.status}.` }
  }

  let release: Release | null
  try {
    release = parseRelease(await response.json())
  } catch {
    release = null
  }

  if (!release) return { status: 'failed', message: 'GitHub’s answer was not a release.' }

  return pickUpdate(release, current)
}
