import { describe, expect, it } from 'vitest';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { NamedZone } from './zone-name.system';

import { ZoneNameSystem } from './zone-name.system';

// A small district nested inside a big county box (both contain the same point).
const COUNTY: NamedZone = { max: [1000, 1000], min: [-1000, -1000], name: 'BONE' };
const DISTRICT: NamedZone = { max: [110, 110], min: [90, 90], name: 'LMEX' };

function track(zones: NamedZone[], position: () => Vec3): { seen: string[]; system: ZoneNameSystem } {
  const seen: string[] = [];
  const system = new ZoneNameSystem(zones, position, (key) => seen.push(key));

  return { seen, system };
}

describe('ZoneNameSystem', () => {
  describe('negative cases', () => {
    it('emits an empty key when the player is in no zone', () => {
      const { seen, system } = track([DISTRICT], () => [5000, 5000, 0]);
      system.update();
      expect(seen).toEqual(['']);
    });

    it('does not re-fire while the zone is unchanged', () => {
      const { seen, system } = track([COUNTY, DISTRICT], () => [100, 100, 0]);
      system.update();
      system.update();
      expect(seen).toEqual(['LMEX']);
    });
  });

  describe('positive cases', () => {
    it('reports the SMALLEST containing zone (district over county)', () => {
      const { seen, system } = track([COUNTY, DISTRICT], () => [100, 100, 0]);
      system.update();
      expect(seen).toEqual(['LMEX']);
    });

    it('falls back to the county when outside the district but inside the county', () => {
      let pos: Vec3 = [100, 100, 0]; // inside the district
      const { seen, system } = track([COUNTY, DISTRICT], () => pos);
      system.update(); // LMEX
      pos = [500, 500, 0]; // still in BONE county, outside LMEX
      system.update();
      expect(seen).toEqual(['LMEX', 'BONE']);
    });
  });
});
