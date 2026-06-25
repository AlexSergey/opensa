import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { toArrayBuffer } from '../../test-utils';
import { parseDff } from './dff';

// Real 2dfx ESCALATOR case (plan 044): the LA mall pair — one model hosting two opposed
// escalators (survey: escl_la, dir=1 at x≈-0.96 and dir=0 at x≈+0.98, same y/z path).
const ESCALATOR_DFF = 'tests/original/dff/escalator/escl_la.dff';
const LIGHTS_ONLY_DFF = 'tests/custom/proper-fixes-models/trafficlight1.dff';

function load(path: string): ReturnType<typeof parseDff> {
  return parseDff(toArrayBuffer(new Uint8Array(readFileSync(path))));
}

describe('2dfx ESCALATOR parsing', () => {
  describe('negative cases', () => {
    it('leaves models without escalator entries untouched', () => {
      const clump = load(LIGHTS_ONLY_DFF);
      expect(clump.geometries.every((geometry) => geometry.escalators === undefined)).toBe(true);
      // The shared 2dfx walk still yields the lights (regression for the corona path).
      expect(clump.geometries.some((geometry) => geometry.lights.length > 0)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('parses the LA mall pair with geometry-local path points and directions', () => {
      const clump = load(ESCALATOR_DFF);
      const escalators = clump.geometries.flatMap((geometry) => geometry.escalators ?? []);
      expect(escalators).toHaveLength(2);

      const up = escalators.find((entry) => entry.direction === 1);
      const down = escalators.find((entry) => entry.direction === 0);
      expect(up).toBeDefined();
      expect(down).toBeDefined();

      // Survey values: pos(-0.96,6.63,-3.24) bottom(-0.95,4.53,-3.24) top(-0.98,-4.37,3.38) end(-0.99,-6.45,3.38)
      expect(up!.position[1]).toBeCloseTo(6.63, 1);
      expect(up!.position[2]).toBeCloseTo(-3.24, 1);
      expect(up!.bottom[1]).toBeCloseTo(4.53, 1);
      expect(up!.top[2]).toBeCloseTo(3.38, 1);
      expect(up!.end[1]).toBeCloseTo(-6.45, 1);
      // The pair sits side by side on opposite x.
      expect(up!.position[0]).toBeLessThan(0);
      expect(down!.position[0]).toBeGreaterThan(0);
      // Landings are flat: position/bottom share z, top/end share z, and the incline rises.
      expect(up!.bottom[2]).toBeCloseTo(up!.position[2], 3);
      expect(up!.end[2]).toBeCloseTo(up!.top[2], 3);
      expect(up!.top[2]).toBeGreaterThan(up!.bottom[2]);
    });
  });
});
