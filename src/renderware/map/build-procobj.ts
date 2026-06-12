import type { Object3D } from 'three';

import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';

import type { ImgArchive } from '../archive';
import type { IdeObjectDef } from '../parsers/text';
import type { BuildRegionOptions } from './build-region';
import type { ProcObjBatch, ProcObjPlacement } from './procobj-scatter';

import { getClump, getTextures } from '../archive';
import { buildClumpParts } from '../three/build-clump';
import { registerProcObjMesh } from './procobj-runtime';

/** Options for {@link buildProcObjMeshes}: the shared mod hook + the per-cell render budget. */
export interface ProcObjBuildOptions extends BuildRegionOptions {
  /** Per-cell render-budget lottery threshold (see `procObjLotteryCap`) — caps the runtime
   *  density cutoff so the cell never draws more clutter than budgeted. Default: unlimited. */
  lotteryCap?: number;
}

const UP = new Vector3(0, 0, 1);

// placementMatrix scratch (single-threaded module state, like the three.js math conventions).
const position = new Vector3();
const quaternion = new Quaternion();
const spin = new Quaternion();
const normal = new Vector3();
const scale = new Vector3();

/**
 * Turn one cell's scatter batches into renderable `InstancedMesh`es (plan 042, iteration 3c).
 * Models resolve through the regular IDE catalog (`defOf` — the clutter defs ship in the generic
 * IDEs); batches whose model has no def are skipped. Instances keep the batch's lottery order so
 * the runtime density cutoff works; each mesh registers with the procobj runtime and starts
 * INVISIBLE — the per-frame settings pass decides visibility/count (avoids a one-frame
 * full-density flash before the config applies).
 */
export function buildProcObjMeshes(
  archive: ImgArchive,
  batches: readonly ProcObjBatch[],
  defOf: (model: string) => IdeObjectDef | undefined,
  options: ProcObjBuildOptions = {},
): Object3D[] {
  const meshes: Object3D[] = [];
  const matrix = new Matrix4();

  for (const batch of batches) {
    const def = defOf(batch.model);
    if (!def || batch.placements.length === 0) {
      continue;
    }
    const parts = buildClumpParts(getClump(archive, def.modelName), getTextures(archive, def.txdName));
    const lotteries = new Float32Array(batch.placements.map((placement) => placement.lottery));
    for (const part of parts) {
      options.decoratePart?.(def, part); // mods compose here too (wind sways procedural bushes)
      const mesh = new InstancedMesh(part.geometry, part.material, batch.placements.length);
      mesh.castShadow = false;
      mesh.receiveShadow = false; // unlit world material — manual shadow sampling (plan 038)
      batch.placements.forEach((placement, index) => {
        mesh.setMatrixAt(index, placementMatrix(placement, matrix));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.visible = false; // the runtime settings pass enables it
      mesh.userData.procObj = { category: batch.category, model: batch.model };
      registerProcObjMesh(mesh, batch.category, lotteries, options.lotteryCap);
      meshes.push(mesh);
    }
  }

  return meshes;
}

/** Compose one placement transform: tilt to the face normal (align rules), spin around local up.
 *  Shared by the render meshes and the clutter colliders (procobj-colliders) — same world pose. */
export function placementMatrix(placement: ProcObjPlacement, matrix: Matrix4): Matrix4 {
  position.set(placement.position[0], placement.position[1], placement.position[2]);
  spin.setFromAxisAngle(UP, placement.rotation);
  if (placement.align) {
    normal.set(placement.normal[0], placement.normal[1], placement.normal[2]);
    quaternion.setFromUnitVectors(UP, normal).multiply(spin); // spin in model space, then tilt
  } else {
    quaternion.copy(spin);
  }
  scale.set(placement.scale, placement.scale, placement.scaleZ);

  return matrix.compose(position, quaternion, scale);
}
