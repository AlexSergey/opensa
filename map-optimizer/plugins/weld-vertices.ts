import type { MapPlugin } from '../core/asset';
import type { SubMesh } from '../core/ir';

import { remapVertices } from './vertex-compaction';

/**
 * Merge vertices that are identical in **all** attributes (position + normal + UV + prelit + night) and
 * re-index the triangles. Purely removes redundant duplicate vertices — no visual change — and exercises the
 * count-changing re-encoder (plan 004). A no-op when nothing merges (counts unchanged → faithful path).
 */
export function createWeldVertices(): MapPlugin {
  return {
    name: 'weld-vertices',
    transform(asset, context): void {
      let removed = 0;
      for (const mesh of asset.ir.meshes) {
        removed += weldMesh(mesh);
      }
      if (removed > 0) {
        asset.dirty = true;
        context.log(asset, 'weld-vertices', `merged ${removed} duplicate vertices`);
      }
    },
  };
}

/** Weld one sub-mesh in place; returns the number of vertices removed (0 = unchanged). */
export function weldMesh(mesh: SubMesh): number {
  const vertexCount = mesh.positions.length / 3;
  const keyToNew = new Map<string, number>();
  const oldToNew = new Int32Array(vertexCount);
  const sourceOf: number[] = []; // new index → an old vertex with that key

  for (let v = 0; v < vertexCount; v += 1) {
    const key = vertexKey(mesh, v);
    let mapped = keyToNew.get(key);
    if (mapped === undefined) {
      mapped = sourceOf.length;
      keyToNew.set(key, mapped);
      sourceOf.push(v);
    }
    oldToNew[v] = mapped;
  }

  if (sourceOf.length === vertexCount) {
    return 0; // no duplicates
  }
  remapVertices(mesh, oldToNew, sourceOf);

  return vertexCount - sourceOf.length;
}

/** All-attribute key — only fully-identical vertices share it (so welding is visually lossless). */
function vertexKey(mesh: SubMesh, v: number): string {
  const parts = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
  if (mesh.normals) {
    parts.push(mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]);
  }
  if (mesh.uvs) {
    parts.push(mesh.uvs[v * 2], mesh.uvs[v * 2 + 1]);
  }
  if (mesh.prelitColors) {
    const o = v * 4;
    parts.push(mesh.prelitColors[o], mesh.prelitColors[o + 1], mesh.prelitColors[o + 2], mesh.prelitColors[o + 3]);
  }
  if (mesh.nightColors) {
    const o = v * 4;
    parts.push(mesh.nightColors[o], mesh.nightColors[o + 1], mesh.nightColors[o + 2], mesh.nightColors[o + 3]);
  }

  return parts.join(',');
}
