import type { Texture } from 'three';

import { Bone, BufferAttribute, BufferGeometry, Group, Matrix4, Skeleton, SkinnedMesh } from 'three';

import type { RWClump, RWFrame, RWGeometry, RWSkin } from '../parsers/binary/types';

import { buildMaterial, groupTrianglesByMaterial } from './build-clump';
import { applyNightFill } from './night-fill';

/** A skinned character build: the renderable root plus its skeleton + named bones. */
export interface SkinnedClump {
  /** Bones keyed by frame name (trimmed), for the animation manager. */
  bonesByName: Map<string, Bone>;
  /** Renderable root (native Z-up; the caller orients it). */
  root: Group;
  skeleton: Skeleton;
}

/**
 * Build a {@link SkinnedMesh} + {@link Skeleton} from a skinned clump (a character
 * DFF), or `null` if no geometry carries skin data (caller falls back to the
 * static `buildClump`).
 *
 * Bones come from the frame hierarchy (one `Bone` per frame, local transform from
 * the RW frame, parented per `parentIndex`). The skeleton's bones are ordered to
 * match the skin's bone indices via the **HAnim** hierarchy (plan 052) — bone index
 * `i` → the frame whose HAnim bone id is the hierarchy's `i`-th — falling back to the
 * positional **frame `i + 1`** heuristic for models with no HAnim (frame 0 is the
 * dummy clump root). Bone inverses come from the **skin plugin's** inverse bind
 * matrices (`applySkinInverses`) — the authoritative bind pose — not the frame
 * hierarchy, so peds whose frame bind differs from the skin's (standard SA peds)
 * deform upright. No animation is applied here.
 */
export function buildSkinnedClump(clump: RWClump, textures?: Map<string, Texture>): null | SkinnedClump {
  const atomic = clump.atomics.find((a) => clump.geometries[a.geometryIndex]?.skin);
  if (!atomic) {
    return null;
  }
  const rw = clump.geometries[atomic.geometryIndex];
  const skin = rw.skin as RWSkin;

  const bones = clump.frames.map(boneFromFrame);
  clump.frames.forEach((frame, i) => {
    if (frame.parentIndex >= 0) {
      bones[frame.parentIndex].add(bones[i]);
    }
  });
  const rootBone = bones[clump.frames.findIndex((f) => f.parentIndex < 0)];

  const materials = rw.materials.map((m) => buildMaterial(m, rw, textures));
  materials.forEach(applyNightFill); // plan 034: self-illuminate the player at night
  const mesh = new SkinnedMesh(buildSkinnedGeometry(rw, skin), materials.length > 1 ? materials : materials[0]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(rootBone);
  mesh.updateMatrixWorld(true);

  const skeleton = new Skeleton(skinBoneOrder(clump, bones, skin.numBones));
  mesh.bind(skeleton); // computes bindMatrix (+ frame-derived inverses we override next)
  applySkinInverses(skeleton, skin);

  const root = new Group();
  root.name = 'RWSkinnedClump';
  root.add(mesh);

  const bonesByName = new Map<string, Bone>();
  for (const bone of bones) {
    if (bone.name) {
      bonesByName.set(bone.name, bone);
    }
  }

  return { bonesByName, root, skeleton };
}

/**
 * Replace three's frame-derived bone inverses with the skin plugin's **authoritative** inverse bind
 * matrices (plan 052). RW stores the true bind pose there; deriving it from the frame hierarchy only works
 * when the frames happen to match it (custom Tommy did; standard SA peds like army do not — their frame
 * bind is rotated, so the mesh rendered lying down). The matrices are padded `RwMatrix` (right/up/at/pos,
 * each with a 4th pad float), so force the homogeneous bottom row to `(0,0,0,1)`. No-op if malformed.
 */
function applySkinInverses(skeleton: Skeleton, skin: RWSkin): void {
  if (skin.inverseBindMatrices.length < skeleton.bones.length * 16) {
    return;
  }
  skeleton.boneInverses = skeleton.bones.map((_, i) => {
    const matrix = new Matrix4().fromArray(skin.inverseBindMatrices, i * 16);
    matrix.elements[3] = 0;
    matrix.elements[7] = 0;
    matrix.elements[11] = 0;
    matrix.elements[15] = 1;

    return matrix;
  });
}

function boneFromFrame(frame: RWFrame): Bone {
  const bone = new Bone();
  bone.name = frame.name.trim();
  // RW stores right/up/at basis vectors as rows; lay them into Matrix4 columns.
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = frame.rotation;
  const matrix = new Matrix4().set(
    r0,
    r3,
    r6,
    frame.position[0],
    r1,
    r4,
    r7,
    frame.position[1],
    r2,
    r5,
    r8,
    frame.position[2],
    0,
    0,
    0,
    1,
  );
  matrix.decompose(bone.position, bone.quaternion, bone.scale);

  return bone;
}

function buildSkinnedGeometry(rw: RWGeometry, skin: RWSkin): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(rw.positions, 3));
  if (rw.uvLayers.length > 0) {
    geometry.setAttribute('uv', new BufferAttribute(rw.uvLayers[0], 2));
  }
  geometry.setAttribute('skinIndex', new BufferAttribute(skin.boneIndices, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skin.boneWeights, 4));

  const index: number[] = [];
  let start = 0;
  groupTrianglesByMaterial(rw.triangles, rw.materials.length).forEach((tris, materialIndex) => {
    for (const tri of tris) {
      index.push(tri.a, tri.b, tri.c);
    }
    const count = tris.length * 3;
    if (count > 0) {
      geometry.addGroup(start, count, materialIndex);
      start += count;
    }
  });
  geometry.setIndex(index);

  if (rw.normals) {
    geometry.setAttribute('normal', new BufferAttribute(rw.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingSphere();

  return geometry;
}

/**
 * Order the skeleton's bones to match the skin's bone indices. RW skins index into the HAnim hierarchy
 * (the root frame's ordered bone ids); map each index → the bone whose frame carries that bone id. Falls
 * back to the positional "skin bone `i` ↔ frame `i + 1`" heuristic for models with no HAnim.
 */
function skinBoneOrder(clump: RWClump, bones: Bone[], numBones: number): Bone[] {
  const hierarchy = clump.frames.find((frame) => frame.boneHierarchy)?.boneHierarchy;
  if (!hierarchy) {
    return Array.from({ length: numBones }, (_, i) => bones[i + 1]);
  }
  const boneById = new Map<number, Bone>();
  clump.frames.forEach((frame, i) => {
    if (frame.boneId !== undefined) {
      boneById.set(frame.boneId, bones[i]);
    }
  });

  return Array.from({ length: numBones }, (_, i) => boneById.get(hierarchy[i]) ?? bones[i + 1]);
}
