import { existsSync, readFileSync } from 'node:fs';
import { SkinnedMesh } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWFrame, RWGeometry } from '../parsers/binary/types';

import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildSkinnedClump } from './build-skinned-clump';

const IDENTITY_ROTATION = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function clump(geo: RWGeometry): RWClump {
  // frame 0 = dummy root; frames 1..2 = the two skin bones.
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [frame('', -1), frame('Root', 0), frame('Bone', 1)],
    geometries: [geo],
  };
}

function frame(name: string, parentIndex: number): RWFrame {
  return { name, parentIndex, position: [0, 0, 0], rotation: IDENTITY_ROTATION };
}

/** A 3-vertex, one-material geometry, optionally skinned to `numBones` bones. */
function geometry(numBones?: number): RWGeometry {
  return {
    flags: 0,
    lights: [],
    materials: [{ color: [255, 255, 255, 255], texture: null, textured: false }],
    nightColors: null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: null,
    skin:
      numBones === undefined
        ? undefined
        : {
            boneIndices: new Uint8Array(12),
            boneWeights: new Float32Array(12),
            inverseBindMatrices: new Float32Array(numBones * 16),
            numBones,
            usedBones: [],
          },
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  };
}

describe('buildSkinnedClump', () => {
  describe('negative cases', () => {
    it('returns null when no geometry carries skin data', () => {
      expect(buildSkinnedClump(clump(geometry()))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('builds a SkinnedMesh whose skeleton matches the skin bone count', () => {
      const skinned = buildSkinnedClump(clump(geometry(2)));
      expect(skinned).not.toBeNull();
      expect(skinned?.skeleton.bones).toHaveLength(2);
      expect(skinned?.root.getObjectByProperty('type', 'SkinnedMesh')).toBeInstanceOf(SkinnedMesh);
    });

    it('exposes bones keyed by their frame name', () => {
      const skinned = buildSkinnedClump(clump(geometry(2)));
      expect([...(skinned?.bonesByName.keys() ?? [])].sort()).toEqual(['Bone', 'Root']);
    });

    it('falls back to frame order (skin bone i ↔ frame i+1) when there is no HAnim', () => {
      const skinned = buildSkinnedClump(clump(geometry(2)));
      expect(skinned?.skeleton.bones.map((b) => b.name)).toEqual(['Root', 'Bone']);
    });

    it('disables vertex colours on a PRELIT skinned material (no color attr → would render black)', () => {
      // PRELIT flag (0x8) set, but the skinned geometry never writes a `color` attribute (the T800 bug).
      const geo = geometry(2);
      geo.flags = 0x8;
      const skinned = buildSkinnedClump(clump(geo));
      const material = skinned!.root.getObjectByProperty('type', 'SkinnedMesh') as SkinnedMesh;
      const materials = Array.isArray(material.material) ? material.material : [material.material];
      expect(materials.every((m) => 'vertexColors' in m && !m.vertexColors)).toBe(true);
    });
  });
});

/** Identity inverse-bind (zero translation) for `numBones`, with the RW 4th-float pad left 0. */
function identityInverseBinds(numBones: number): Float32Array {
  const out = new Float32Array(numBones * 16);
  for (let b = 0; b < numBones; b += 1) {
    out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], b * 16);
  }

  return out;
}

describe('buildSkinnedClump (root bone anchored to skin bind)', () => {
  describe('positive cases', () => {
    it('snaps a root frame offset back to the skin bind (mods that offset Root, e.g. gostown BMYPOL1)', () => {
      // Root frame authored at +2 on X, but the skin bind puts it at the origin (identity inverse bind).
      // Dropped root translation track would otherwise leave the body shoved by 2 off the entity pivot.
      const geo = geometry(2);
      geo.skin!.inverseBindMatrices = identityInverseBinds(2);
      const model = clump(geo);
      model.frames[1].position = [2, 0, 0];

      const { skeleton } = buildSkinnedClump(model)!;
      const { x, y, z } = skeleton.bones[0].position;
      expect([x, y, z]).toEqual([0, 0, 0]);
    });

    it('keeps the root where the frame and skin bind already agree (no-op for standard peds)', () => {
      // Skin bind = translate(1,2,3) (its inverse), frame authored at the same place → unchanged.
      const geo = geometry(2);
      const binds = identityInverseBinds(2);
      binds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 0], 0);
      geo.skin!.inverseBindMatrices = binds;
      const model = clump(geo);
      model.frames[1].position = [1, 2, 3];

      const { skeleton } = buildSkinnedClump(model)!;
      const { x, y, z } = skeleton.bones[0].position;
      expect([x, y, z].map((n) => +n.toFixed(3))).toEqual([1, 2, 3]);
    });
  });
});

// A real custom mod ped (gostown's BMYPOL1) whose `Root` FRAME is authored at +2.16 on X while its skin bind
// puts the root at the origin. The IFP root translation track is dropped (locomotion stays in-place), so the
// frame offset would otherwise shove the whole body off the entity pivot. `anchorRootBone` snaps it back.
const GOSTOWN_BMYPOL1_DFF = 'tests/custom/character/gostown-bmypol1.dff';

describe('buildSkinnedClump (real gostown BMYPOL1.dff — offset root frame)', () => {
  const parsed = parseDff(toArrayBuffer(new Uint8Array(readFileSync(GOSTOWN_BMYPOL1_DFF))));

  describe('positive cases', () => {
    it('the model authors its Root frame with a large offset (the fact the fix guards)', () => {
      expect(parsed.frames[1].name.trim()).toBe('Root');
      expect(parsed.frames[1].position[0]).toBeGreaterThan(2);
    });

    it('anchors the skeleton root to the skin bind (origin), not the offset frame position', () => {
      const { skeleton } = buildSkinnedClump(parsed)!;
      expect(skeleton.bones[0].name).toBe('Root');
      const { x, y, z } = skeleton.bones[0].position;
      expect([x, y, z].map((n) => +n.toFixed(2))).toEqual([0, 0, 0]);
    });
  });
});

// Plan 052: the skin's bone indices follow the HAnim hierarchy, which need NOT match the frame order
// (true for standard SA peds, e.g. army). Frames here are stored A, C, B but the hierarchy is A, B, C.
function hanimClump(): RWClump {
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [
      frame('dummy', -1),
      { ...frame('A', 0), boneHierarchy: [0, 1, 2], boneId: 0 }, // root carries the hierarchy table
      { ...frame('C', 1), boneId: 2 },
      { ...frame('B', 2), boneId: 1 },
    ],
    geometries: [geometry(3)],
  };
}

describe('buildSkinnedClump (HAnim bone order)', () => {
  describe('positive cases', () => {
    it('orders the skeleton by the HAnim hierarchy, not the frame order', () => {
      const skinned = buildSkinnedClump(hanimClump());
      expect(skinned?.skeleton.bones.map((b) => b.name)).toEqual(['A', 'B', 'C']);
    });
  });
});

describe('buildSkinnedClump (skin inverse bind matrices)', () => {
  describe('positive cases', () => {
    it('uses the skin plugin inverse binds, forcing the padded RwMatrix bottom row to (0,0,0,1)', () => {
      const geo = geometry(2);
      // Bone 0 = a translation (5,6,7); RW pads each RwMatrix vector with a 4th float (here the [15] pad
      // is 0 in the file) — applySkinInverses must repair the homogeneous row so the matrix is valid.
      geo.skin!.inverseBindMatrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, /* pad */ 0], 0);
      const skinned = buildSkinnedClump(clump(geo));
      const inverse = skinned!.skeleton.boneInverses[0].elements;
      expect([inverse[12], inverse[13], inverse[14], inverse[15]]).toEqual([5, 6, 7, 1]);
    });
  });
});

// A real skinned player model — bmypol1 (a stock SA cop, extracted into tests/original via
// `npm run test:fixtures`): a full 32-bone standard SA biped. The tests' player character now that no
// custom character model is committed.
const BMYPOL1_DFF = 'tests/original/character/bmypol1.dff';

describe.skipIf(!existsSync(BMYPOL1_DFF))('buildSkinnedClump (real bmypol1.dff)', () => {
  const parsed = parseDff(toArrayBuffer(new Uint8Array(readFileSync(BMYPOL1_DFF))));

  describe('positive cases', () => {
    it('builds a SkinnedMesh whose skeleton matches the DFF skin bone count', () => {
      const boneCount = parsed.geometries[0].skin?.numBones;
      const skinned = buildSkinnedClump(parsed);
      expect(skinned).not.toBeNull();
      expect(boneCount).toBe(32);
      expect(skinned!.skeleton.bones).toHaveLength(boneCount!);
      expect(skinned!.bonesByName.size).toBe(boneCount!);
      expect(skinned!.root.getObjectByProperty('type', 'SkinnedMesh')).toBeInstanceOf(SkinnedMesh);
    });

    it('names the standard SA biped bones (Root/Pelvis/Spine/Head)', () => {
      const { bonesByName } = buildSkinnedClump(parsed)!;
      for (const bone of ['Root', 'Pelvis', 'Spine', 'Head']) {
        expect(bonesByName.has(bone)).toBe(true);
      }
    });
  });
});

// A real mod whose skeleton root is RENAMED: Shrek's root bone is `MrAndres5555`, not the stock
// `Root`/`Normal`. Animation retargeting matches the IFP root track by name, so a renamed root dropped
// that track → the body kept its bind facing (spawned back-to-car, animations reversed). The fix passes
// `skeleton.bones[0].name` to the AnimationController; this guards the model fact it relies on.
const SHREK_DFF = 'tests/custom/character/Shrek.dff';

describe('buildSkinnedClump (real Shrek.dff — renamed skeleton root)', () => {
  const parsed = parseDff(toArrayBuffer(new Uint8Array(readFileSync(SHREK_DFF))));

  describe('positive cases', () => {
    it('builds a full 32-bone skeleton whose root is renamed (no stock Root/Normal bone)', () => {
      const { bonesByName, skeleton } = buildSkinnedClump(parsed)!;
      expect(skeleton.bones).toHaveLength(32);
      expect(skeleton.bones[0].name).toBe('MrAndres5555');
      expect(bonesByName.has('Root')).toBe(false);
      expect(bonesByName.has('Normal')).toBe(false);
    });

    it('still names the standard SA biped bones below the renamed root', () => {
      const { bonesByName } = buildSkinnedClump(parsed)!;
      for (const bone of ['Pelvis', 'Spine', 'Spine1', 'Head']) {
        expect(bonesByName.has(bone)).toBe(true);
      }
    });
  });
});

// A stock SA ped (army, from gta3.img via `npm run test:fixtures`): its skeleton FRAMES are in a
// different order than the HAnim hierarchy (R Thigh/L Thigh precede Spine), so the old positional
// `frame i+1` mapping bound vertices to the wrong bones (plan 052 regression guard).
const ARMY_DFF = 'tests/original/character/army.dff';

describe.skipIf(!existsSync(ARMY_DFF))('buildSkinnedClump (real army.dff — HAnim ≠ frame order)', () => {
  const parsed = parseDff(toArrayBuffer(new Uint8Array(readFileSync(ARMY_DFF))));

  describe('positive cases', () => {
    it('orders skin bones by the HAnim hierarchy, not the frame order', () => {
      // Frame order has R Thigh/L Thigh at indices 3/4; the HAnim hierarchy puts Spine there.
      const { skeleton } = buildSkinnedClump(parsed)!;
      expect(skeleton.bones.slice(0, 4).map((b) => b.name)).toEqual(['Root', 'Pelvis', 'Spine', 'Spine1']);
    });

    it('uses the skin plugin inverse binds (so the mesh stands upright under animation)', () => {
      const { skeleton } = buildSkinnedClump(parsed)!;
      // Authoritative inverse binds have a valid homogeneous bottom row (frame-derived ones differ here).
      expect(skeleton.boneInverses.every((m) => m.elements[15] === 1)).toBe(true);
    });
  });
});
