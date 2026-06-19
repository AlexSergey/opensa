import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { toArrayBuffer } from '../../test-utils';
import { parseDff } from './dff';

// Real Breakable cases (plan 045): the LA trash bin ships full shatter data (byte-verified
// 252 verts / 154 tris / 7 materials); the roadsign ships only the 4-byte `magic = 0` marker;
// the skull pillar has no Breakable chunk at all.
const BIN_DFF = 'tests/original/dff/breakable/binnt08_la.dff';
const MARKER_ONLY_DFF = 'tests/custom/proper-fixes-models/vegasnroad19.dff';
const NO_CHUNK_DFF = 'tests/original/dff/particle/skullpillar01_lvs.dff';

function load(path: string): ReturnType<typeof parseDff> {
  return parseDff(toArrayBuffer(new Uint8Array(readFileSync(path))));
}

describe('Breakable plugin parsing', () => {
  describe('negative cases', () => {
    it('treats a zero-magic marker as not breakable', () => {
      const clump = load(MARKER_ONLY_DFF);
      expect(clump.geometries.length).toBeGreaterThan(0);
      expect(clump.geometries.every((geometry) => geometry.breakable === undefined)).toBe(true);
    });

    it('leaves models without the chunk untouched', () => {
      const clump = load(NO_CHUNK_DFF);
      expect(clump.geometries.every((geometry) => geometry.breakable === undefined)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('parses the trash-bin shatter mesh with consistent arrays', () => {
      const clump = load(BIN_DFF);
      const breakables = clump.geometries.flatMap((geometry) => geometry.breakable ?? []);
      expect(breakables).toHaveLength(1);
      const breakable = breakables[0];

      // Byte-verified counts (header + packed arrays sum to the 7868-byte chunk exactly).
      expect(breakable.positions).toHaveLength(252 * 3);
      expect(breakable.uvs).toHaveLength(252 * 2);
      expect(breakable.colours).toHaveLength(252 * 4);
      expect(breakable.triangles).toHaveLength(154 * 3);
      expect(breakable.triangleMaterials).toHaveLength(154);
      expect(breakable.materials).toHaveLength(7);

      // Every triangle indexes real vertices and a real material.
      for (const index of breakable.triangles) {
        expect(index).toBeLessThan(252);
      }
      for (const material of breakable.triangleMaterials) {
        expect(material).toBeLessThan(7);
      }

      // The bin's shatter mesh reuses the bin texture (mask = alpha cut-out variant).
      expect(breakable.materials[0].texture).toBe('bins2_lae2');
      expect(breakable.materials[0].mask).toBe('bins2_lae2_m');
      expect(breakable.materials[0].ambient[0]).toBeCloseTo(1, 5);

      // Shatter geometry lives in model space — a street bin is around a metre tall.
      let minZ = Number.POSITIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (let i = 2; i < breakable.positions.length; i += 3) {
        minZ = Math.min(minZ, breakable.positions[i]);
        maxZ = Math.max(maxZ, breakable.positions[i]);
      }
      expect(maxZ - minZ).toBeGreaterThan(0.5);
      expect(maxZ - minZ).toBeLessThan(3);
    });

    it('parses real shatter data from a model whose magic is a raw runtime pointer', () => {
      // trafficlight1's exporter left a non-zero pointer in `magic` (not 1) — still real data.
      const clump = load('tests/custom/proper-fixes-models/trafficlight1.dff');
      const breakables = clump.geometries.flatMap((geometry) => geometry.breakable ?? []);
      expect(breakables).toHaveLength(1);
      expect(breakables[0].positions).toHaveLength(488 * 3);
      expect(breakables[0].triangles).toHaveLength(242 * 3);
      expect(breakables[0].materials).toHaveLength(22);
      expect(breakables[0].materials[0].texture).toBe('trafficlight_64');
      // Exporters leave heap garbage after the NUL in some name fields — must trim clean.
      for (const material of breakables[0].materials) {
        expect(material.texture).toMatch(/^[\x20-\x7e]*$/);
        expect(material.mask).toMatch(/^[\x20-\x7e]*$/);
      }
    });
  });
});
