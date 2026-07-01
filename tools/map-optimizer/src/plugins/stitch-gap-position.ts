import type { MapPlugin } from '../core/asset';
import type { SubMesh } from '../core/ir';

/**
 * Apply the gap-stitch position moves computed by the world pre-pass (`adapters/gta-sa/gap-stitch.ts`, plan 017,
 * variant A). For the current model it overwrites the **position** of every boundary vertex the pre-pass paired,
 * moving it to the pair midpoint so the hairline crack closes; **all other attributes stay**.
 *
 * Matching is by **local position** (the moves are keyed on the original position): the pipeline re-indexes and
 * splits vertices later but never moves them, so the key survives. Must run **first** (before `weld-vertices`) so
 * every downstream pass — weld / smooth-normals / seam-weld — sees the stitched geometry (and `smooth-normals`'s
 * count-changing rebuild recomputes the bounding sphere over the moved positions).
 */

/** One welded vertex: match by original local position, overwrite the position. Structurally `PositionOverride`. */
export interface StitchOverride {
  newPos: readonly [number, number, number];
  pos: readonly [number, number, number];
}

export function createStitchGapPosition(overridesByModel: ReadonlyMap<string, readonly StitchOverride[]>): MapPlugin {
  return {
    accepts: (asset): boolean => overridesByModel.has(asset.name),
    name: 'stitch-gap-position',
    transform(asset, context): void {
      const overrides = overridesByModel.get(asset.name);
      if (!overrides || overrides.length === 0) {
        return;
      }
      const byPosition = new Map(overrides.map((override) => [positionKey(override.pos), override.newPos]));

      let moved = 0;
      for (const mesh of asset.ir.meshes) {
        moved += applyToMesh(mesh, byPosition);
      }
      if (moved > 0) {
        asset.dirty = true;
        context.log(asset, 'stitch-gap-position', `moved ${moved} boundary vertex(es)`);
      }
    },
  };
}

/** Overwrite the position of every vertex whose original local position has an override; returns the count. */
function applyToMesh(mesh: SubMesh, byPosition: ReadonlyMap<string, readonly [number, number, number]>): number {
  const count = mesh.positions.length / 3;
  let moved = 0;
  for (let v = 0; v < count; v += 1) {
    const newPos = byPosition.get(
      positionKey([mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]),
    );
    if (!newPos) {
      continue;
    }
    mesh.positions[v * 3] = newPos[0];
    mesh.positions[v * 3 + 1] = newPos[1];
    mesh.positions[v * 3 + 2] = newPos[2];
    moved += 1;
  }

  return moved;
}

/** A stable key for a local vertex position. Both sides read the same float32 values, so exact keys match. */
function positionKey(pos: readonly [number, number, number]): string {
  return `${pos[0]}|${pos[1]}|${pos[2]}`;
}
