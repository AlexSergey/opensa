import { describe, expect, it } from 'vitest';

import { cellKey, cellOf, cellsWithin } from './grid';

function keysWithin(position: [number, number, number], radius: number, cellSize: number): Set<string> {
  return new Set(cellsWithin(position, radius, cellSize).map(([cx, cy]) => cellKey(cx, cy)));
}

describe('cellOf / cellKey', () => {
  describe('positive cases', () => {
    it('floors a world position to a cell (negative included) and keys it', () => {
      expect(cellOf([260, -10, 5], 250)).toEqual([1, -1]);
      expect(cellKey(1, -1)).toBe('1,-1');
    });
  });
});

describe('cellsWithin', () => {
  describe('positive cases', () => {
    it('returns only the view cell when the radius reaches no neighbour', () => {
      // centre of cell (0,0); nearest neighbour edge is 125 away > 100
      expect(keysWithin([125, 125, 0], 100, 250)).toEqual(new Set(['0,0']));
    });

    it('includes a neighbour cell the radius reaches across the edge', () => {
      // near the right edge of cell (0,0); cell (1,0) is 10 away ≤ 20
      expect(keysWithin([240, 125, 0], 20, 250)).toEqual(new Set(['0,0', '1,0']));
    });

    it('excludes corner cells beyond the radius (circular, not square)', () => {
      // from cell centre: edge neighbour is 125 away, corner ~177 away
      const keys = keysWithin([125, 125, 0], 150, 250);
      expect(keys.has('1,0')).toBe(true); // edge neighbour reachable (125 ≤ 150)
      expect(keys.has('1,1')).toBe(false); // corner neighbour too far (177 > 150)
    });
  });
});
