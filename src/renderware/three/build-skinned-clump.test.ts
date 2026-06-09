import { SkinnedMesh } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWFrame, RWGeometry } from '../parsers/binary/types';

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
  });
});
