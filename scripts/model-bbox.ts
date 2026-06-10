import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { openArchive } from '../src/renderware/archive/img-archive';
import { buildCollisionIndex, getCollision } from '../src/renderware/collision/collision-index';
import { parseDff } from '../src/renderware/parsers/binary/dff';

/**
 * Compare a model's RENDER extents (DFF positions, per atomic with its frame transform's
 * translation applied) against its COLLISION extents (COL bounds + mesh) — both in model space.
 * If the COL covers an area the DFF doesn't, the render mesh is partial/mis-parsed; if both match,
 * a missing-but-collidable model points at a transform/culling bug instead.
 * Run: `npx tsx scripts/model-bbox.ts <modelName> [...more]`.
 */
const ROOT = join(import.meta.dirname, '..');
const archive = openArchive(new Uint8Array(readFileSync(join(ROOT, 'static', 'models', 'gta3-pf.img'))));
const colIndex = buildCollisionIndex(archive);

for (const model of process.argv.slice(2)) {
  const name = model.toLowerCase();
  console.log(`\n=== ${name}`);
  const dff = archive.get(`${name}.dff`);
  if (!dff) {
    console.log('  NO DFF');
  } else {
    const clump = parseDff(dff);
    for (const [index, frame] of clump.frames.entries()) {
      console.log(
        `  frame ${index} '${frame.name}' parent=${frame.parentIndex} pos(${frame.position.map((v) => v.toFixed(2)).join(', ')})`,
      );
    }
    // Two bboxes: direct frame only (what buildClumpParts applies today) vs the FULL parent chain.
    for (const mode of ['direct', 'chain'] as const) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      let vertices = 0;
      for (const atomic of clump.atomics) {
        const geometry = clump.geometries[atomic.geometryIndex];
        if (!geometry) {
          continue;
        }
        const offset = [0, 0, 0];
        let frameIndex = atomic.frameIndex;
        while (frameIndex >= 0 && frameIndex < clump.frames.length) {
          const frame = clump.frames[frameIndex];
          for (let axis = 0; axis < 3; axis += 1) {
            offset[axis] += frame.position[axis]; // translations only — rotations are identity here
          }
          if (mode === 'direct' || frame.parentIndex === frameIndex) {
            break;
          }
          frameIndex = frame.parentIndex;
        }
        vertices += geometry.positions.length / 3;
        for (let i = 0; i < geometry.positions.length; i += 3) {
          for (let axis = 0; axis < 3; axis += 1) {
            const value = geometry.positions[i + axis] + offset[axis];
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
          }
        }
      }
      console.log(
        `  DFF (${mode}): ${clump.atomics.length} atomics, ${vertices} verts; bbox min(${min.map((v) => v.toFixed(1)).join(', ')}) max(${max.map((v) => v.toFixed(1)).join(', ')})`,
      );
    }
  }
  const col = getCollision(colIndex, name);
  if (!col) {
    console.log('  NO COL');
    continue;
  }
  console.log(
    `  COL: ${col.faces.length} faces, ${col.spheres.length} spheres, ${col.boxes.length} boxes; bounds min(${col.bounds.min.map((v) => v.toFixed(1)).join(', ')}) max(${col.bounds.max.map((v) => v.toFixed(1)).join(', ')})`,
  );
}
