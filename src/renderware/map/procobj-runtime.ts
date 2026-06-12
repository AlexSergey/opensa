import type { InstancedMesh } from 'three';

import type { ProcObjCategoryName } from './procobj-categories';

/**
 * Live gating for scattered clutter meshes (plan 042, iteration 3c). Every procobj
 * `InstancedMesh` registers once at cell build; the game loop applies the per-category config
 * each frame: `enabled` toggles visibility, `drawDistance` hides far meshes (bounding-sphere
 * distance to the view), and `density` becomes an instance-count cutoff — placements are
 * lottery-sorted (see procobj-scatter), so `count = #(lottery < density)` needs no rebuild.
 * Detached meshes (streamed-out cells, kept in the adapter cache) are skipped, like the
 * animated-object mixers.
 */

export interface ProcObjSettings {
  density: number;
  drawDistance: number;
  enabled: boolean;
}

interface ProcObjEntry {
  category: ProcObjCategoryName;
  /** Sorted placement lotteries (mirrors the instance order) — density cutoff via binary search. */
  lotteries: Float32Array;
  /** Per-cell render-budget threshold (procObjLotteryCap) — caps the density cutoff. */
  lotteryCap: number;
  mesh: InstancedMesh;
}

const entries: ProcObjEntry[] = [];

/** Register one scattered clutter mesh (instances already lottery-sorted). */
export function registerProcObjMesh(
  mesh: InstancedMesh,
  category: ProcObjCategoryName,
  lotteries: Float32Array,
  lotteryCap = Number.POSITIVE_INFINITY,
): void {
  entries.push({ category, lotteries, lotteryCap, mesh });
}

/** Test hook: drop all registered meshes (the registry is module-level shared state). */
export function resetProcObjMeshes(): void {
  entries.length = 0;
}

/**
 * Apply the per-category settings to every attached clutter mesh. `view` is the player/camera
 * position in GTA Z-up world space (the meshes' local space under the streaming root).
 */
export function updateProcObjMeshes(
  view: readonly [number, number, number],
  settings: Readonly<Record<ProcObjCategoryName, ProcObjSettings>>,
): void {
  for (const entry of entries) {
    const { lotteries, mesh } = entry;
    if (!mesh.parent) {
      continue; // streamed out — cached, not in the scene
    }
    const setting = settings[entry.category];
    const count = setting.enabled ? lotteryCutoff(lotteries, Math.min(setting.density, entry.lotteryCap)) : 0;
    if (count === 0) {
      mesh.visible = false;
      continue;
    }
    const sphere = mesh.boundingSphere;
    const inRange =
      sphere === null ||
      distance(view, sphere.center.x, sphere.center.y, sphere.center.z) - sphere.radius <= setting.drawDistance;
    mesh.visible = inRange;
    if (inRange) {
      mesh.count = count;
    }
  }
}

function distance(view: readonly [number, number, number], x: number, y: number, z: number): number {
  return Math.hypot(view[0] - x, view[1] - y, view[2] - z);
}

/** Number of leading instances with `lottery < density` (binary search — lotteries are sorted). */
function lotteryCutoff(lotteries: Float32Array, density: number): number {
  let low = 0;
  let high = lotteries.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lotteries[mid] < density) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}
