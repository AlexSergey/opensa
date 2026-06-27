import { describe, expect, it } from 'vitest';

import type { DecodedTexture, HdTree, HdTriangle } from '../../core';

import { applyTrunkPrelight, frameTransformPoint } from './io';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// +90° about Z (right/up/at basis, column-major flatten): right=(0,1,0), up=(-1,0,0), at=(0,0,1).
const ROT_Z90 = [0, 1, 0, -1, 0, 0, 0, 0, 1];

describe('frameTransformPoint', () => {
  describe('negative cases', () => {
    it('leaves a point unchanged under the identity frame', () => {
      expect(frameTransformPoint(IDENTITY, [0, 0, 0], [2, 3, 4])).toEqual([2, 3, 4]);
    });
  });

  describe('positive cases', () => {
    it('applies translation', () => {
      expect(frameTransformPoint(IDENTITY, [10, 20, 30], [1, 2, 3])).toEqual([11, 22, 33]);
    });

    it('applies the rotation basis then the translation (90° about Z: x→y, y→-x)', () => {
      const out = frameTransformPoint(ROT_Z90, [0, 0, 5], [1, 0, 0]);

      expect(out[0]).toBeCloseTo(0, 6);
      expect(out[1]).toBeCloseTo(1, 6);
      expect(out[2]).toBeCloseTo(5, 6);
    });
  });
});

const texture = (hasAlpha: boolean): DecodedTexture => ({ hasAlpha, height: 1, rgba: new Uint8Array(4), width: 1 });
const triangle = (texture: null | string, colors: HdTriangle['colors']): HdTriangle => ({
  colors,
  positions: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  texture,
  uvs: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
});

describe('applyTrunkPrelight', () => {
  describe('positive cases', () => {
    it('recolours trunk (opaque) triangles, leaves foliage (alpha) ones untouched', () => {
      const tree: HdTree = {
        bbox: { max: [1, 1, 1], min: [0, 0, 0] },
        name: 't',
        textures: new Map([
          ['bark', texture(false)],
          ['leaf', texture(true)],
        ]),
        triangles: [
          triangle('bark', null),
          triangle('leaf', [
            [9, 9, 9, 9],
            [9, 9, 9, 9],
            [9, 9, 9, 9],
          ]),
        ],
      };

      applyTrunkPrelight(tree, [50, 60, 70, 255]);

      expect(tree.triangles[0].colors).toEqual([
        [50, 60, 70, 255],
        [50, 60, 70, 255],
        [50, 60, 70, 255],
      ]); // trunk recoloured
      expect(tree.triangles[1].colors).toEqual([
        [9, 9, 9, 9],
        [9, 9, 9, 9],
        [9, 9, 9, 9],
      ]); // foliage kept
    });
  });
});
