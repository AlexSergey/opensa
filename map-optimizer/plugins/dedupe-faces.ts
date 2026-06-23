import type { MapPlugin } from '../core/asset';
import type { Triangle } from '../core/ir';

/**
 * Remove **exact duplicate** triangles — same vertices, same winding, same material — which only z-fight and
 * waste draw calls. Conservative on purpose (plan 005): a reversed-winding twin (two-sided alpha), a
 * differing-material twin, and separate coplanar faces (decals) are all **kept**. Vertices are untouched; the
 * triangle count drops → the count-changing re-encoder regenerates BinMeshPLG.
 */
export function createDedupeFaces(): MapPlugin {
  return {
    name: 'dedupe-faces',
    transform(asset, context): void {
      let removed = 0;
      for (const mesh of asset.ir.meshes) {
        const before = mesh.triangles.length;
        const kept = dedupeFaces(mesh.triangles);
        if (kept.length < before) {
          mesh.triangles = kept;
          removed += before - kept.length;
        }
      }
      if (removed > 0) {
        asset.dirty = true;
        context.log(asset, 'dedupe-faces', `removed ${removed} duplicate faces`);
      }
    },
  };
}

/** Keep the first triangle per exact-duplicate key; drop the rest. Order-stable. */
export function dedupeFaces(triangles: readonly Triangle[]): Triangle[] {
  const seen = new Set<string>();
  const kept: Triangle[] = [];
  for (const triangle of triangles) {
    const key = canonicalKey(triangle);
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(triangle);
    }
  }

  return kept;
}

/** Cyclic-canonical key (rotate to the smallest index, preserving winding) + material. Distinguishes a
 *  reversed winding (two-sided) and a differing material, which must be kept. */
function canonicalKey(triangle: Triangle): string {
  const { a, b, c, material } = triangle;
  if (a <= b && a <= c) {
    return `${a},${b},${c},${material}`;
  }
  if (b <= a && b <= c) {
    return `${b},${c},${a},${material}`;
  }

  return `${c},${a},${b},${material}`;
}
