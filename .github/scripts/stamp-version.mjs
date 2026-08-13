// Writes a release version into the workspace package.json files, so that a
// `v0.2.0` tag does not ship a file called `YASS-0.1.0.exe`.
//
// electron-builder reads `desktop/package.json` and nothing else — that one
// field is what `${version}` in the artifactName templates resolves to. The
// other three come along because a repository that says 0.1.0 everywhere while
// handing out a 0.2.0 binary is a repository nobody can date a bug report
// against.
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

console.log(`packaging as ${version}`)
