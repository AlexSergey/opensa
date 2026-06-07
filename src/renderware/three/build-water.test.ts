import { MeshBasicMaterial, RepeatWrapping, Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { WaterQuad } from '../parsers/text/water.parser';

import { buildWater, oceanFrame } from './build-water';

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

describe('oceanFrame', () => {
  describe('negative cases', () => {
    it('skips strips where the data already reaches the half extent', () => {
      // Data spans the full width (x = ±100), so the left/right strips are degenerate.
      const full: WaterQuad = {
        vertices: [
          [-100, -20, 0],
          [100, -20, 0],
          [-100, 20, 0],
          [100, 20, 0],
        ],
      };
      const frame = oceanFrame([full], 100, 0);
      expect(frame).toHaveLength(2); // only bottom + top
    });

    it('falls back to a single full plane when there are no quads', () => {
      expect(oceanFrame([], 100, 0)).toHaveLength(1);
    });
  });

  describe('positive cases', () => {
    it('frames the data bounds with four sea-level border quads', () => {
      const frame = oceanFrame([quad()], 100, 0); // quad bounds: x[-10,10] y[-20,20]
      expect(frame).toHaveLength(4);
      expect(frame.every((q) => q.vertices.every((v) => v[2] === 0))).toBe(true);
      // The left strip fills from -half to the data's minX.
      expect(frame[0].vertices[0][0]).toBe(-100);
      expect(frame[0].vertices[1][0]).toBe(-10);
    });
  });
});
