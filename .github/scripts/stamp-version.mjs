// Turns this checkout into one that packages as a named release: the version
// into the workspace package.json files, and the versioned filenames back into
// electron-builder's artifactName templates. Two edits, one reason — a `v0.2.0`
// tag must not ship a file called `YASS-0.1.0.exe`, or one called `YASS.exe`
// that cannot be dated at all.
//
// electron-builder reads `desktop/package.json` and nothing else — that one
// field is what `${version}` in the artifactName templates resolves to. The
// other three come along because a repository that says 0.1.0 everywhere while
// handing out a 0.2.0 binary is a repository nobody can date a bug report
// against.
//
// The artifactName lines are the other half, and they default the other way:
// `desktop/electron-builder.yml` ships the unversioned names so that a
// developer running `npm run dist` gets a stable `dist/YASS.exe` instead of a
// new filename per build. This is the only thing that switches them over, and
// it runs only when build.yml was given a version — so "was this packaged as a
// release?" and "does the filename carry a version?" are the same question with
// one answer.
//
// Called only from CI, where the checkout is disposable; the rewrite is never
// committed. Run it locally and you will want to undo it afterwards.
import { readFile, writeFile } from 'node:fs/promises'

const PACKAGES = [
  'package.json',
  'client/package.json',
  'server/package.json',
  'desktop/package.json',
]

const raw = process.argv[2] ?? ''
const version = raw.replace(/^v/, '')

// electron-builder wants semver and says so by failing late, after the client,
// the server and the tray have all been built. Cheaper to refuse it here.
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.log(`::error::'${raw}' is not a version electron-builder can package`)
  process.exit(1)
}

// The version is the second key in every one of these files, so the first match
// is the right match. A textual replace rather than a JSON round-trip because
// they carry `//` comment keys and a deliberate key order, and reserializing
// would reformat all of it for the sake of one field.
const FIELD = /"version":\s*"[^"]*"/

for (const file of PACKAGES) {
  const before = await readFile(file, 'utf8')

  // Asked of the text, not of the result of rewriting it. A tag matching what
  // the manifests already say — the normal case, since bumping before tagging
  // is the habit this is here to make optional — rewrites to a byte-identical
  // file, and comparing before to after would read that as a missing field.
  if (!FIELD.test(before)) {
    console.log(`::error::no version field to stamp in ${file}`)
    process.exit(1)
  }

  await writeFile(file, before.replace(FIELD, `"version": "${version}"`))
}

// The unversioned defaults, and what a release turns each of them into. The
// replacement keeps `${version}` as a template rather than substituting the
// value: electron-builder resolves it from the manifest stamped just above, so
// a release build names its files by exactly the mechanism it always used, and
// this script stays the thing that chooses the shape rather than the thing that
// fills it in.
const BUILD_CONFIG = 'desktop/electron-builder.yml'
const ARTIFACT_NAMES = [
  ['artifactName: YASS.exe', 'artifactName: YASS-${version}.exe'],
  ['artifactName: YASS.AppImage', 'artifactName: YASS-${version}-x86_64.AppImage'],
]

let config = await readFile(BUILD_CONFIG, 'utf8')

for (const [plain, versioned] of ARTIFACT_NAMES) {
  // Exactly one, and the `artifactName:` prefix is what makes that true — the
  // bare filenames also appear in that file's prose. Anything else means the
  // config has moved on without this script, and guessing which occurrence was
  // meant is how a release ships the wrong filename. Refuse here instead, where
  // it costs a re-tag rather than a republished release.
  if (config.split(plain).length !== 2) {
    console.log(`::error::expected exactly one '${plain}' in ${BUILD_CONFIG}`)
    process.exit(1)
  }

  config = config.replace(plain, versioned)
}

await writeFile(BUILD_CONFIG, config)

console.log(`packaging as ${version}, with the version in the filenames`)
