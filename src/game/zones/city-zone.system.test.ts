import { describe, expect, it } from 'vitest';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { City, CityBox } from './city';

import { CityZoneSystem } from './city-zone.system';

const LA_BOX: CityBox = { city: 'LA', max: [3000, -850], min: [480, -3000] };

function track(boxes: CityBox[], position: () => Vec3): { seen: City[]; system: CityZoneSystem } {
  const seen: City[] = [];
  const system = new CityZoneSystem(boxes, position, (city) => seen.push(city));

  return { seen, system };
}

describe('CityZoneSystem', () => {
  describe('negative cases', () => {
    it('does not re-fire while the city is unchanged', () => {
      const { seen, system } = track([LA_BOX], () => [2502, -1714, 13]);
      system.update();
      system.update();
      system.update();
      expect(seen).toEqual(['LA']); // only the initial classification
    });
  });

  describe('positive cases', () => {
    it('fires the initial city on the first update', () => {
      const { seen, system } = track([LA_BOX], () => [2502, -1714, 13]);
      system.update();
      expect(seen).toEqual(['LA']);
    });

    it('fires again only when the player crosses into another city/Countryside', () => {
      let pos: Vec3 = [2502, -1714, 13]; // Los Santos
      const { seen, system } = track([LA_BOX], () => pos);
      system.update(); // LA
      pos = [0, 0, 0]; // outside the box
      system.update(); // COUNTRYSIDE
      pos = [2502, -1714, 13]; // back into LA
      system.update();
      expect(seen).toEqual(['LA', 'COUNTRYSIDE', 'LA']);
    });
  });
});
