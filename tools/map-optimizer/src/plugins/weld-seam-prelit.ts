import type { MapPlugin } from '../core/asset';
import type { SubMesh } from '../core/ir';

/**
 * Apply the cross-model seam-prelit overrides computed by the world pre-pass (`adapters/gta-sa/seam-weld.ts`,
 * plan 016, variant A). For the current model it overwrites the prelit **RGB** of every vertex at a welded
 * boundary position; **alpha is copied verbatim** (wind / floodlight / overlay data — same rule as the other
 * prelight passes).
 *
 * Matching is by **local position**, not vertex index: the earlier stages (weld / prune / smooth-normals)
 * re-index and split vertices, but never move them, so a position key survives — and every split copy at a seam
 * position is corrected in one pass. Must run **after `smooth-normals`** (splits exist) and **before
 * `synthesize-night`** (so the night set derives from the welded day prelit).
 */

/** One welded vertex: match by local position, overwrite RGB. Structurally the adapter's `VertexOverride`. */
export interface PrelitOverride {
  pos: readonly [number, number, number];
  rgb: readonly [number, number, number];
}

export function createWeldSeamPrelit(overridesByModel: ReadonlyMap<string, readonly PrelitOverride[]>): MapPlugin {
  return {
    accepts: (asset): boolean => overridesByModel.has(asset.name),
    name: 'weld-seam-prelit',
    transform(asset, context): void {
      const overrides = overridesByModel.get(asset.name);
      if (!overrides || overrides.length === 0) {
        return;
      }
      const rgbByPosition = new Map(overrides.map((override) => [positionKey(override.pos), override.rgb]));

      let welded = 0;
      for (const mesh of asset.ir.meshes) {
        welded += applyToMesh(mesh, rgbByPosition);
      }
      if (welded > 0) {
        asset.dirty = true;
        context.log(asset, 'weld-seam-prelit', `welded ${welded} seam vertex prelit`);
      }
    },
  };
}

/** Overwrite RGB (alpha kept) on every vertex whose local position has an override; returns the count. */
function applyToMesh(mesh: SubMesh, rgbByPosition: ReadonlyMap<string, readonly [number, number, number]>): number {
  if (!mesh.prelitColors) {
    return 0;
  }
  const count = mesh.positions.length / 3;
  let welded = 0;
  for (let v = 0; v < count; v += 1) {
    const rgb = rgbByPosition.get(
      positionKey([mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]),
    );
    if (!rgb) {
      continue;
    }
    mesh.prelitColors[v * 4] = rgb[0];
    mesh.prelitColors[v * 4 + 1] = rgb[1];
    mesh.prelitColors[v * 4 + 2] = rgb[2]; // alpha (v*4 + 3) left untouched
    welded += 1;
  }

  return welded;
}

/** A stable key for a local vertex position. Both sides read the same float32 values, so exact keys match. */
function positionKey(pos: readonly [number, number, number]): string {
  return `${pos[0]}|${pos[1]}|${pos[2]}`;
}
