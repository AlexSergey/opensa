import { MeshBasicMaterial, RepeatWrapping, Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { WaterQuad } from '../parsers/text/water.parser';

import { buildWater } from './build-water';

function quad(): WaterQuad {
  return {
    vertices: [
      [-10, -20, 0],
      [10, -20, 0],
      [-10, 20, 0],
      [10, 20, 0],
    ],
  };
}

function triangle(): WaterQuad {
  return {
    vertices: [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
    ],
  };
}

describe('buildWater', () => {
  describe('positive cases', () => {
    it('merges quads (2 tris) and triangles (1 tri) into one indexed geometry', () => {
      const mesh = buildWater([quad(), triangle()], new Texture());
      const geometry = mesh.geometry;
      expect(geometry.getAttribute('position').count).toBe(7); // 4 + 3 vertices
      expect(geometry.getIndex()?.count).toBe(9); // 6 (quad) + 3 (triangle)
      expect(geometry.getAttribute('uv').count).toBe(7);
    });

    it('uses an unlit, translucent, double-sided material with a tiling texture', () => {
      const texture = new Texture();
      const mesh = buildWater([quad()], texture);
      const material = mesh.material as MeshBasicMaterial;
      expect(material).toBeInstanceOf(MeshBasicMaterial);
      expect(material.transparent).toBe(true);
      expect(material.map).toBe(texture);
      expect(texture.wrapS).toBe(RepeatWrapping);
      expect(texture.wrapT).toBe(RepeatWrapping);
    });
  });
});
