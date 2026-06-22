/**
 * Build the standalone viewers' fixtures into `static/viewer/` by extracting from a clean, UNMODIFIED GTA
 * San Andreas copy under `game-src/non-modified` (the same source `test-fixtures.ts` uses). These are
 * Rockstar assets, so NOTHING under `static/` is committed (`static/` is gitignored) — every contributor
 * regenerates locally:
 *
 *   npm run viewer:assets
 *
 * Produces (all extracted from `gta3.img`/`gta_int.img` unless noted):
 *   character/  bmypol1.dff + bmypol1.txd (the player ped) + ped.ifp (copied from `anim/`)
 *   vehicles/   admiral.dff/.txd, comet.dff/.txd
 *   objects/    the object-viewer's models + their txds, plus a pre-baked `<model>.col.json` (map-object
 *               collision lives in the IMG, not the DFF, so it is baked here for the asset-light viewer).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type ImgArchive, openArchive } from '../src/renderware/archive/img-archive';
import { buildCollisionIndex, getCollision } from '../src/renderware/collision/collision-index';

const ROOT = join('game-src', 'non-modified');
const ARCHIVES = ['models/gta3.img', 'models/gta_int.img'];
const OUT = 'static/viewer';

/** Object-viewer models whose COL is pre-baked to `<model>.col.json` (keep in sync with object-viewer.ts). */
const COL_MODELS = ['lae2_ground08', 'wattspark1_lae2'];

type Fixture =
  | { readonly dest: string; readonly entry: string; readonly type: 'extract' }
  | { readonly dest: string; readonly from: string; readonly type: 'copy' };

const extract = (entry: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, entry, type: 'extract' });
const copy = (from: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, from, type: 'copy' });

const MANIFEST: readonly Fixture[] = [
  // character — the player ped (bmypol1) + the locomotion anim (loaded directly, like the game)
  extract('bmypol1.dff', 'character/bmypol1.dff'),
  extract('bmypol1.txd', 'character/bmypol1.txd'),
  copy('anim/ped.ifp', 'character/ped.ifp'),
  // vehicles (vehicle-viewer's VEHICLES)
  extract('admiral.dff', 'vehicles/admiral.dff'),
  extract('admiral.txd', 'vehicles/admiral.txd'),
  extract('comet.dff', 'vehicles/comet.dff'),
  extract('comet.txd', 'vehicles/comet.txd'),
  // objects (object-viewer's MODELS) — dff + txd; collision is baked below
  extract('wattspark1_lae2.dff', 'objects/wattspark1_lae2.dff'),
  extract('lae2tempshit.txd', 'objects/lae2tempshit.txd'),
  extract('lae2_ground08.dff', 'objects/lae2_ground08.dff'),
  extract('burnsground.txd', 'objects/burnsground.txd'),
];

let archives: ImgArchive[] | null = null;

function extractEntry(name: string): null | Uint8Array {
  for (const archive of openArchives()) {
    const data = archive.get(name);
    if (data) {
      return new Uint8Array(data);
    }
  }

  return null;
}

function openArchives(): ImgArchive[] {
  archives ??= ARCHIVES.map((rel) => openArchive(new Uint8Array(readFileSync(join(ROOT, rel)))));

  return archives;
}

function produce(fixture: Fixture): null | Uint8Array {
  return fixture.type === 'copy' ? new Uint8Array(readFileSync(join(ROOT, fixture.from))) : extractEntry(fixture.entry);
}

const missing: string[] = [];
let written = 0;

function write(dest: string, data: null | Uint8Array): void {
  if (!data) {
    missing.push(dest);

    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, data);
  written += 1;
}

for (const fixture of MANIFEST) {
  let data: null | Uint8Array = null;
  try {
    data = produce(fixture);
  } catch {
    data = null;
  }
  write(fixture.dest, data);
}

// Pre-baked COL for the object-viewer models (collision lives in the IMG, not the DFF).
const colIndex = buildCollisionIndex(openArchives()[0]);
for (const name of COL_MODELS) {
  const col = getCollision(colIndex, name);
  const dest = `${OUT}/objects/${name}.col.json`;
  if (!col) {
    missing.push(dest);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify({ ...col, vertices: Array.from(col.vertices) }));
  written += 1;
}

console.log(`viewer:assets: wrote ${written}/${MANIFEST.length + COL_MODELS.length} into ${OUT}/`);
if (missing.length > 0) {
  console.error(`\n  MISSING ${missing.length} — source not found in ${ROOT}:`);
  for (const dest of missing) {
    console.error(`    - ${dest}`);
  }
  console.error(`\n  Ensure game-src/non-modified is a complete, unmodified GTA San Andreas install.`);
  process.exitCode = 1;
}
