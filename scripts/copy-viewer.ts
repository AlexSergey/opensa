/**
 * Regenerate the viewer fixtures (dff/txd + pre-baked col.json) from the local `game-src/viewer/` into
 * `static-viewer/viewer/` — the small, COMMITTED set the asset-light viewers + their e2e lane load (no full
 * game archive). `game-src/viewer/` is the (gitignored, local) source of truth; commit the trimmed
 * `static-viewer/` result. Local/dev only (needs game-src). Usage: `tsx scripts/copy-viewer.ts`.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const src = join(ROOT, 'game-src', 'viewer');
const out = join(ROOT, 'static-viewer', 'viewer');

if (!existsSync(src)) {
  throw new Error(`${src} not found — the viewer fixtures live in game-src/viewer (not committed)`);
}
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });
console.log(`copied viewer fixtures → static-viewer/viewer`);
