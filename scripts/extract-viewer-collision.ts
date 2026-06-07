/**
 * One-time dev script: extract the COL (collision) for the object-viewer's models
 * out of `static/models/gta3.img` into small `static/viewer/<model>.col.json` files,
 * so `/object-viewer.html` can show collision without downloading the 795 MB archive.
 *
 * Map objects keep their COL in the IMG (not embedded in the DFF), so this pre-bakes
 * just the few models the viewer lists. Re-run after adding models to that list.
 *
 *   npx tsx scripts/extract-viewer-collision.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { openArchive } from '../src/renderware/archive/img-archive';
import { buildCollisionIndex, getCollision } from '../src/renderware/collision/collision-index';

/** Keep in sync with the object-viewer's MODELS (model = dff basename, lowercased). */
const MODELS = ['lae2_ground08', 'wattspark1_lae2'];
const IMG = 'static/models/gta3.img';
const OUT_DIR = 'static/viewer';

const file = readFileSync(IMG);
const archive = openArchive(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
const index = buildCollisionIndex(archive);

for (const name of MODELS) {
  const col = getCollision(index, name);
  if (!col) {
    console.warn(`no COL found for '${name}'`);
    continue;
  }
  const json = { ...col, vertices: Array.from(col.vertices) };
  writeFileSync(`${OUT_DIR}/${name}.col.json`, JSON.stringify(json));
  console.log(
    `wrote ${OUT_DIR}/${name}.col.json (faces=${col.faces.length} spheres=${col.spheres.length} boxes=${col.boxes.length})`,
  );
}
