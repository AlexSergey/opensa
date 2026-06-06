import type { Texture } from 'three';

import { Bone, BufferAttribute, BufferGeometry, Group, Matrix4, Skeleton, SkinnedMesh } from 'three';

import type { RWClump, RWFrame, RWGeometry, RWSkin } from '../parsers/binary/types';

import { buildMaterial, groupTrianglesByMaterial } from './build-clump';

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
 * match the skin's bone indices — for GTA SA peds **skin bone `i` ↔ frame `i + 1`**
 * (frame 0 is the dummy clump root). Bone inverses are computed by three from the
 * bones' own bind world matrices (`new Skeleton(bones)`), which keeps the **bind
 * pose exactly the raw mesh** regardless of the frame↔bone mapping; the mapping
 * only affects animation (next task). No animation is applied here.
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
  const mesh = new SkinnedMesh(buildSkinnedGeometry(rw, skin), materials.length > 1 ? materials : materials[0]);
  mesh.add(rootBone);
  mesh.updateMatrixWorld(true);

  // Skin bone i ↔ frame i + 1 (frame 0 = dummy root); skeleton order matches skinIndex.
  const skinBones = Array.from({ length: skin.numBones }, (_, i) => bones[i + 1]);
  const skeleton = new Skeleton(skinBones);
  mesh.bind(skeleton);

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
