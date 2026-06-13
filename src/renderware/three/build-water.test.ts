import { existsSync, readFileSync } from 'node:fs';
import { MeshBasicMaterial, RepeatWrapping, Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { WaterQuad } from '../parsers/text/water.parser';

import { parseWater } from '../parsers/text/water.parser';
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

// Real water.dat slice → builder: ties the parser's quads to a single merged mesh.
const WATER_DAT = 'tests/data/water.dat';

describe.skipIf(!existsSync(WATER_DAT))('buildWater (real water.dat slice)', () => {
  describe('positive cases', () => {
    it('merges every parsed quad into one indexed mesh (3/4 verts → 1/2 tris each)', () => {
      const quads = parseWater(readFileSync(WATER_DAT, 'utf8'));
      const mesh = buildWater(quads, new Texture());
      const expectedVerts = quads.reduce((n, q) => n + q.vertices.length, 0);
      const expectedIndices = quads.reduce((n, q) => n + (q.vertices.length === 4 ? 6 : 3), 0);
      expect(quads.length).toBeGreaterThan(0);
      expect(mesh.geometry.getAttribute('position').count).toBe(expectedVerts);
      expect(mesh.geometry.getIndex()?.count).toBe(expectedIndices);
      expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
    });
  });
});
