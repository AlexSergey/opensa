import type { MapPlugin } from '../core/asset';
import type { SubMesh } from '../core/ir';

import { remapVertices } from './vertex-compaction';

/**
 * Drop vertices no triangle references, compacting every per-vertex attribute and re-indexing the faces.
 * Purely a size win — unreferenced data can't be drawn (plan 006). A vertex-count change → rides the
 * count-changing re-encoder. A no-op when every vertex is used.
 */
export function createPruneVertices(): MapPlugin {
  return {
    name: 'prune-vertices',
    transform(asset, context): void {
      let removed = 0;
      for (const mesh of asset.ir.meshes) {
        removed += pruneMesh(mesh);
      }
      if (removed > 0) {
        asset.dirty = true;
        context.log(asset, 'prune-vertices', `pruned ${removed} unused vertices`);
      }
    },
  };
}

/** Prune one sub-mesh in place; returns the number of vertices removed (0 = unchanged). */
export function pruneMesh(mesh: SubMesh): number {
  const vertexCount = mesh.positions.length / 3;
  const used = new Uint8Array(vertexCount);
  for (const triangle of mesh.triangles) {
    used[triangle.a] = 1;
    used[triangle.b] = 1;
    used[triangle.c] = 1;
  }

  const oldToNew = new Int32Array(vertexCount).fill(-1);
  const sourceOf: number[] = []; // new index → kept old vertex (original order)
  for (let v = 0; v < vertexCount; v += 1) {
    if (used[v]) {
      oldToNew[v] = sourceOf.length;
      sourceOf.push(v);
    }
  }

  if (sourceOf.length === vertexCount) {
    return 0; // all vertices used
  }
  remapVertices(mesh, oldToNew, sourceOf);

  return vertexCount - sourceOf.length;
}
