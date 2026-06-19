import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseWater } from './water.parser';

// A 20-quad slice of the real water.dat, committed to ./tests.
const realPath = join(process.cwd(), 'tests', 'original', 'data', 'water.dat');
const realExists = existsSync(realPath);

/** A water.dat vertex: x y z + 4 normal/flow params. */
function vertex(x: number, y: number, z: number): string {
  return `${x} ${y} ${z} 0 0 0.199 0.241`;
}

describe('parseWater', () => {
  describe('negative cases', () => {
    it('skips the header and blank lines', () => {
      expect(parseWater('processed\n\n   \n')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('reads a 4-vertex quad as four corner positions', () => {
      const line = `${vertex(-10, -20, 0)}    ${vertex(10, -20, 0)}    ${vertex(-10, 20, 0)}    ${vertex(10, 20, 5)}  1`;
      const [quad] = parseWater(`processed\n${line}`);
      expect(quad.vertices).toEqual([
        [-10, -20, 0],
        [10, -20, 0],
        [-10, 20, 0],
        [10, 20, 5],
      ]);
    });

    it('reads a 3-vertex triangle', () => {
      const line = `${vertex(0, 0, 1)}    ${vertex(1, 0, 1)}    ${vertex(0, 1, 1)}  2`;
      const [quad] = parseWater(`processed\n${line}`);
      expect(quad.vertices).toHaveLength(3);
      expect(quad.vertices[2]).toEqual([0, 1, 1]);
    });

    it.skipIf(!realExists)('reads the real water.dat slice (4-corner quads, leading row)', () => {
      const quads = parseWater(readFileSync(realPath, 'utf8'));
      expect(quads.length).toBeGreaterThan(0);
      expect(quads.every((quad) => quad.vertices.length === 3 || quad.vertices.length === 4)).toBe(true);
      // First row of water.dat is the -1584/-1826 .. -1360/-1642 sea quad.
      expect(quads[0].vertices).toEqual([
        [-1584, -1826, 0],
        [-1360, -1826, 0],
        [-1584, -1642, 0],
        [-1360, -1642, 0],
      ]);
    });
  });
});
