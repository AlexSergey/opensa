import { describe, expect, it } from 'vitest';

import type { HdTree, TreeLodConfig, Vec3 } from './types';

import { config } from '../config';
import { renderImpostor } from './render';

const cfg: TreeLodConfig = { ...config, cards: 4, textureSize: 128 };

/** A one-triangle HD tree spanning the given bbox (enough to drive the atlas-shape pick). */
function tree(min: Vec3, max: Vec3): HdTree {
  return {
    bbox: { max, min },
    name: 'test',
    textures: new Map(),
    triangles: [
      {
        colors: null,
        positions: [min, [max[0], min[1], min[2]], max],
        texture: null,
        uvs: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
    ],
  };
}

describe('renderImpostor atlas shape', () => {
  describe('negative cases (stays square)', () => {
    it('keeps a square atlas for a ~square tree', () => {
      const impostor = renderImpostor(tree([-5, -5, 0], [5, 5, 8]), cfg);

      expect([impostor.width, impostor.height]).toEqual([128, 128]);
    });

    it('keeps square exactly at the threshold (height = 2× width, not greater)', () => {
      const impostor = renderImpostor(tree([-5, -5, 0], [5, 5, 20]), cfg); // span 10 × 10 × 20, ratio == 2

      expect([impostor.width, impostor.height]).toEqual([128, 128]);
    });
  });

  describe('positive cases (goes portrait)', () => {
    it('uses a portrait atlas for a tall narrow tree', () => {
      const impostor = renderImpostor(tree([-1, -1, 0], [1, 1, 20]), cfg); // span 2 × 2 × 20, ratio == 10

      expect([impostor.width, impostor.height]).toEqual([128, 256]);
    });

    it('fills the portrait image (width × 2·width × 4 bytes)', () => {
      const impostor = renderImpostor(tree([-1, -1, 0], [1, 1, 20]), cfg);

      expect(impostor.image.length).toBe(128 * 256 * 4);
    });

    it('places card UV rects within the portrait bounds', () => {
      const impostor = renderImpostor(tree([-1, -1, 0], [1, 1, 20]), cfg);

      for (const card of impostor.cards) {
        expect(card.uvRect.x + card.uvRect.w).toBeLessThanOrEqual(impostor.width);
        expect(card.uvRect.y + card.uvRect.h).toBeLessThanOrEqual(impostor.height);
      }
    });
  });
});
