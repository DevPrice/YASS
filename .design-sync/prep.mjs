/**
 * Everything that has to happen before the design-sync converter runs.
 *
 * This is `cfg.buildCmd`. The converter expects a package with a built `dist/`
 * and reads its stylesheet off disk; YASS is an app with neither, so this
 * script manufactures both out of the repo's own toolchain rather than letting
 * the converter guess:
 *
 *   1. the pruned `@opensource` mirror the DS pre-bundle resolves against
 *   2. the client's real production build — the only thing that compiles the
 *      Tailwind the components' class strings refer to
 *   3. that build's stylesheet, copied to a stable name (Vite content-hashes
 *      the real one, and `cfg.cssEntry` cannot name a filename that changes
 *      every build)
 *   4. the ESM pre-bundle of the 19 exported components
 *
 * Run from the repository root.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/*
 * `shell` is opt-in per call, not blanket-on for Windows.
 *
 * npm and npx are `.cmd` shims there and don't execute without a shell — but
 * turning the shell on for `process.execPath` re-parses the command line, and
 * the default install path is `C:\Program Files\nodejs\node.exe`. The shell
 * splits that at the space and reports a status 1 with no stderr at all.
 */
const run = (cmd, args, { shell = false } = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell });

// 1. Pruned OpenSource mirror.
run(process.execPath, ['.design-sync/mirror-opensource.mjs']);

// 2. The client's own production build.
console.error('[PREP] building the client (compiles the Tailwind the components use)…');
run('npm', ['run', 'build', '-w', '@yass/client'], { shell: true });

// 3. Stable stylesheet name.
const assets = fileURLToPath(new URL('../client/dist/assets', import.meta.url));
const css = readdirSync(assets).filter((f) => f.endsWith('.css'));
if (css.length !== 1) {
  console.error(
    `[PREP] expected exactly one stylesheet in client/dist/assets, found ${css.length}: ${css.join(', ')}\n` +
      `       cfg.cssEntry names one file — if the client build started splitting CSS, pick the right one here.`,
  );
  process.exit(1);
}
const stable = fileURLToPath(new URL('../client/dist/ds-styles.css', import.meta.url));
copyFileSync(`${assets}/${css[0]}`, stable);
console.error(`[PREP] ${css[0]} → client/dist/ds-styles.css`);

/*
 * The design system's ground, restated at a specificity that survives.
 *
 * Two separate things make the vendored `tokens/base.css` body rule fail once
 * it is out of the app and inside a preview card:
 *
 *  · Every generated card ends its head with an inline
 *    `<style>body{…;background:#fff}</style>`, which is emitted after the
 *    stylesheet links. Source order would hand a white page to a design system
 *    that is dark everywhere. Specificity is compared before source order, so
 *    `html body` (0,0,2) beats the card's `body` (0,0,1) without needing
 *    `!important` and without forking the emitter, which owns the contract
 *    with the app's self-check.
 *
 *  · `--text-body` is declared twice upstream — a colour in `colors.css`, a
 *    20px font-size in `typography.css` — and `styles.css` imports the token
 *    files alphabetically, so typography lands last and wins. `base.css`'s
 *    `color:var(--text-body)` therefore resolves to `20px`, which is not a
 *    colour, so the text falls back to black on a near-black background. The
 *    `--yarg-`-prefixed originals have no such collision, so name them.
 *
 * This ships inside `cfg.cssEntry`, which the converter appends to
 * `_ds_bundle.css` — inside the `styles.css` import closure, and therefore
 * reaching real designs and not just the preview cards. That is intended: it
 * is the same ground the app paints with `bg-surface` on its root element.
 */
const GROUND = `
/* --- design-sync: see .design-sync/prep.mjs for why this is \`html body\` --- */
html body {
  background: var(--yarg-surface-app);
  color: var(--yarg-text-primary);
  font-family: var(--font-ui);
}
`;
writeFileSync(stable, readFileSync(stable, 'utf8') + GROUND, 'utf8');
console.error('[PREP] appended the DS ground rule (dark surface + readable text)');

// 4. The DS pre-bundle.
console.error('[PREP] pre-bundling the design system…');
run('npx', ['vite', 'build', '--config', '.design-sync/vite.ds.config.ts'], { shell: true });

/*
 * 5. Fold the pre-bundle down to pure ASCII.
 *
 * Nothing serves `_ds_bundle.js` with a charset. The preview server sends a
 * bare `Content-Type: text/javascript`, so the browser falls back to latin-1
 * and every multi-byte character arrives as mojibake. Most of that is only
 * ugly — em dashes in labels — but `foldForSearch`'s combining-marks class
 * (`/[̀-ͯ]/`) decodes to a reversed range and throws
 * `SyntaxError: Range out of order in character class` while the bundle is
 * still evaluating. The whole IIFE dies, `window.YASS` is never assigned, and
 * all 19 components fail as `[BUNDLE_EXPORT]` with no clue pointing here.
 *
 * esbuild does not solve this on its own: it escapes non-ASCII inside string
 * literals but passes regular-expression literals through verbatim, which is
 * exactly where the fatal one lives.
 *
 * Escaping is identity-preserving for JavaScript — `\uXXXX` means the same
 * character in strings, template literals, regex literals and identifiers
 * alike — so folding the whole file is safe and leaves nothing that depends on
 * the response's charset.
 */
const bundle = fileURLToPath(new URL('../client/.ds-lib/ds.js', import.meta.url));
const src = readFileSync(bundle, 'utf8');
let folded = 0;
const ascii = src.replace(/[^\x00-\x7F]/gu, (ch) => {
  folded += 1;
  const cp = ch.codePointAt(0);
  if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, '0')}`;
  // Astral plane: JS source escapes are 16-bit, so emit the surrogate pair.
  const v = cp - 0x10000;
  const hi = 0xd800 + (v >> 10);
  const lo = 0xdc00 + (v & 0x3ff);
  return `\\u${hi.toString(16)}\\u${lo.toString(16)}`;
});
writeFileSync(bundle, ascii, 'utf8');
console.error(`[PREP] folded ${folded} non-ASCII character(s) in the pre-bundle to \\uXXXX escapes`);

/*
 * 6. The declaration tree the converter reads props from.
 *
 * See `tsconfig.dts.json` for why this exists at all — without it every
 * component ships an API contract of `[key: string]: unknown`, which is the
 * one file the design agent actually codes against.
 */
console.error('[PREP] emitting declarations for the prop contracts…');
run('npx', ['tsc', '-p', '.design-sync/tsconfig.dts.json'], { shell: true });

/*
 * 7. The types barrel the prop extractor falls back to.
 *
 * Emitting declarations is necessary but not sufficient. The extractor first
 * hunts for an interface literally named `<Name>Props`, which only Button,
 * TextField and Select have; the other sixteen declare their props as an
 * inline object literal on the parameter. For those it falls back to reading
 * the first call signature of the component exported from the package's types
 * entry — `<pkgDir>/index.d.ts`, since `client/package.json` names no `types`.
 * With no such file the fallback finds no declarations, gives up, and emits
 * `[key: string]: unknown`.
 *
 * So: write the entry. Re-exporting the two emitted modules is enough for the
 * checker to resolve every component's parameter type through it.
 *
 * Generated rather than committed, and deliberately not added to
 * `client/package.json` as `types` — the client is a private app that ships no
 * types to anyone, and claiming otherwise would be a lie told to every tool
 * that reads that manifest.
 */
const barrel = fileURLToPath(new URL('../client/index.d.ts', import.meta.url));
writeFileSync(
  barrel,
  '// Generated by .design-sync/prep.mjs — the design-sync prop extractor reads this.\n' +
    "export * from './ds-types/client/src/ui/index';\n" +
    "export * from './ds-types/client/src/ui/library';\n",
  'utf8',
);
console.error('[PREP] wrote client/index.d.ts (types barrel for prop extraction)');
