import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { toArrayBuffer } from '../../test-utils';
import { parseDff } from './dff';

// Real 2dfx PARTICLE case (plan 044): the LV skull torch pillar by the pirate ship — the model
// carries a `fire` FX-system emitter (survey: PARTICLE skullpillar01_lvs "fire" pos(0,-0.3,2.1)).
const SKULL_DFF = 'tests/dff/particle/skullpillar01_lvs.dff';
const LIGHTS_ONLY_DFF = 'tests/dff/trafficlight-backface-culling/trafficlight1.dff';

function load(path: string): ReturnType<typeof parseDff> {
  return parseDff(toArrayBuffer(new Uint8Array(readFileSync(path))));
}

describe('2dfx PARTICLE parsing', () => {
  describe('negative cases', () => {
    it('leaves models without particle entries untouched', () => {
      const clump = load(LIGHTS_ONLY_DFF);
      expect(clump.geometries.every((geometry) => geometry.particles === undefined)).toBe(true);
      // The shared 2dfx walk still yields the lights (regression for the corona path).
      expect(clump.geometries.some((geometry) => geometry.lights.length > 0)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('parses the skull-torch fire emitter with its geometry-local position', () => {
      const clump = load(SKULL_DFF);
      const particles = clump.geometries.flatMap((geometry) => geometry.particles ?? []);
      expect(particles).toHaveLength(1);
      expect(particles[0].effectName).toBe('fire');
      expect(particles[0].position[0]).toBeCloseTo(0, 1);
      expect(particles[0].position[1]).toBeCloseTo(-0.3, 1);
      expect(particles[0].position[2]).toBeCloseTo(2.1, 1);
    });
  });
});
