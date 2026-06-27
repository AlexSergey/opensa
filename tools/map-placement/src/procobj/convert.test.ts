import type { ProcObjPlacement } from '@opensa/renderware/map/procobj-scatter';

import { describe, expect, it } from 'vitest';

import { cullByMinDistance, iplQuaternion } from './convert';

/** A placement at (x, y) with the given lottery — only the fields the cull reads matter. */
function place(x: number, y: number, lottery: number): ProcObjPlacement {
  return { align: false, lottery, normal: [0, 0, 1], position: [x, y, 0], rotation: 0, scale: 1, scaleZ: 1 };
}

describe('cullByMinDistance', () => {
  describe('negative cases', () => {
    it('returns every placement when the min distance is 0', () => {
      const points = [place(0, 0, 0), place(1, 0, 1)];

      expect(cullByMinDistance(points, 0)).toHaveLength(2);
    });
  });

  describe('positive cases', () => {
    it('drops placements within the min distance, keeping the earlier (lower-lottery) one', () => {
      // (5,0) is within 10 of (0,0) → culled; (100,0) is far → kept.
      const kept = cullByMinDistance([place(0, 0, 0), place(5, 0, 1), place(100, 0, 2)], 10);

      expect(kept.map((p) => p.position[0])).toEqual([0, 100]);
    });

    it('keeps placements exactly at the min distance apart (uses < , not ≤)', () => {
      const kept = cullByMinDistance([place(0, 0, 0), place(10, 0, 1)], 10);

      expect(kept).toHaveLength(2);
    });

    it('measures distance in XY only (ignores Z)', () => {
      const a = place(0, 0, 0);
      const b: ProcObjPlacement = { ...place(0, 0, 1), position: [0, 0, 999] };

      expect(cullByMinDistance([a, b], 10)).toHaveLength(1);
    });
  });
});

describe('iplQuaternion', () => {
  describe('positive cases', () => {
    it('is identity for a zero yaw', () => {
      expect(iplQuaternion(0).map((v) => v + 0)).toEqual([0, 0, 0, 1]); // `+ 0` normalises -0 → 0
    });

    it('encodes a conjugated Z rotation (negated z, unit length)', () => {
      const [x, y, z, w] = iplQuaternion(Math.PI / 2);

      expect([x, y]).toEqual([0, 0]);
      expect(z).toBeCloseTo(-Math.SQRT1_2, 6); // conjugate of +sin(π/4) around Z
      expect(w).toBeCloseTo(Math.SQRT1_2, 6);
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 6);
    });
  });
});
