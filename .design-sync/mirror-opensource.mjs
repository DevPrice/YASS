/**
 * Builds the pruned `@opensource` mirror the DS pre-bundle resolves against.
 *
 * Both `index.json` files are copied whole, so every one of the 240 source
 * names and 293 id spellings resolves exactly as it does in the app. Only
 * `base/icons` — the official games — comes across as art. `extra/` is 158
 * charter-group packs at 4.4 MB, and since every asset in this bundle has to
 * inline as a data URI, carrying them would roughly triple what the design
 * agent downloads for glyphs drawn at 20px.
 *
 * `extra/icons/` is still created, empty. `import.meta.glob` over a missing
 * directory and over an empty one both yield `{}`, but an empty directory says
 * the pruning was deliberate rather than a path that silently stopped matching.
 *
 * Re-run this whenever the `vendor/opensource` submodule moves.
 */

import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const src = fileURLToPath(new URL('../vendor/opensource', import.meta.url));
const dst = fileURLToPath(new URL('./.cache/opensource', import.meta.url));

try {
  statSync(src);
} catch {
  console.error(
    `[MIRROR] ${src} is missing — the vendor/opensource submodule is not checked out.\n` +
      `         Run: git submodule update --init`,
  );
  process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(`${dst}/extra/icons`, { recursive: true });

cpSync(`${src}/base/index.json`, `${dst}/base/index.json`);
cpSync(`${src}/extra/index.json`, `${dst}/extra/index.json`);
cpSync(`${src}/base/icons`, `${dst}/base/icons`, { recursive: true });

console.error(`[MIRROR] wrote ${dst} (base icons only; extra names kept, glyphs pruned)`);
