import type { AnimationClip, MeshBasicMaterial, Texture } from 'three';

import { Group, Mesh, Object3D } from 'three';

import type { IfpAnimation } from '../parsers/binary/ifp';
import type { RWClump } from '../parsers/binary/types';

import { buildAnimationClip } from './build-anim-clip';
import { buildGeometry, frameMatrix } from './build-clump';
import { buildWorldMaterial } from './world-material';

/** One built IFP-animated map object (plan 041): a frame-named node hierarchy + its looping clip. */
export interface AnimatedClump {
  /** The model's looping clip from its IDE-named IFP, or null when the package has no matching
   *  animation — the object then renders static in its bind pose. */
  clip: AnimationClip | null;
  /** Every part material, for the caller's IDE-flag treatment (the meshes share them). */
  materials: MeshBasicMaterial[];
  /** Renderable root (native Z-up; the caller places it by the IPL transform). */
  root: Group;
}

/**
 * Build an IDE `anim`-section model as a renderable hierarchy. Unlike the instanced map path
 * (which ignores DFF frames — SA re-frames ATOMIC model infos), `anim` models load in SA as
 * CLUMP model infos with **frames preserved**: the nodding-donkey arm is a child frame the IFP
 * clip rotates relative to the base. So: one named `Object3D` per frame (local transform kept,
 * parented by `parentIndex`), one `Mesh` per atomic under its frame node, world materials as
 * usual. The clip's tracks target nodes **by frame name** (the SA binding), so
 * `AnimationMixer(root)` resolves them directly.
 */
export function buildAnimatedClump(
  clump: RWClump,
  modelName: string,
  animations: readonly IfpAnimation[],
  textures?: Map<string, Texture>,
): AnimatedClump {
  const root = new Group();
  root.name = modelName;

  const nodes = clump.frames.map((frame, index) => {
    const node = new Object3D();
    node.name = frame.name.trim() || `frame_${index}`;
    frameMatrix(frame.rotation, frame.position).decompose(node.position, node.quaternion, node.scale);

    return node;
  });
  clump.frames.forEach((frame, index) => {
    (frame.parentIndex >= 0 ? nodes[frame.parentIndex] : root).add(nodes[index]);
  });

  const materials: MeshBasicMaterial[] = [];
  for (const atomic of clump.atomics) {
    const rw = clump.geometries[atomic.geometryIndex];
    const node = nodes[atomic.frameIndex];
    if (!rw || !node) {
      continue;
    }
    const atomicMaterials = rw.materials.map((m) => buildWorldMaterial(m, rw, textures));
    materials.push(...atomicMaterials);
    const mesh = new Mesh(buildGeometry(rw), atomicMaterials.length > 0 ? atomicMaterials : undefined);
    // Map convention (plan 038): only dynamics cast; the world material samples the map manually.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = node.name;
    node.add(mesh);
  }

  // The IFP names the model's clip after the model itself (counxref.ifp → "nt_noddonkbase").
  const animation = animations.find((entry) => entry.name.toLowerCase() === modelName.toLowerCase());
  // Translation tracks included: object clips animate part positions in parent-frame space
  // (unlike ped locomotion, where physics owns the root and translation is dropped).
  const clip = animation ? buildAnimationClip(animation, { includeTranslation: true }) : null;

  return { clip, materials, root };
}
