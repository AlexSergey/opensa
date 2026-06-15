/**
 * Copy the object-viewer's fixtures (dff/txd + pre-baked col.json) from `game-src/viewer/` into
 * `static/viewer/`, so the asset-light `/object-viewer.html` and its e2e lane have their models without
 * the full archive. `game-src/viewer/` is the (gitignored, local) source of truth.
 * Usage: `tsx scripts/copy-viewer.ts`.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const src = join(ROOT, 'game-src', 'viewer');
const out = join(ROOT, 'static', 'viewer');

if (!existsSync(src)) {
  throw new Error(`${src} not found — the viewer fixtures live in game-src/viewer (not committed)`);
}
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });
console.log(`copied viewer fixtures → static/viewer`);
