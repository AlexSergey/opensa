import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseVehicleDefs } from './vehicle-defs.parser';

const idePath = join(process.cwd(), 'static', 'data', 'vehicles.ide');

const ADMIRAL = '445, admiral, admiral, car, ADMIRAL, ADMIRAL, null, richfamily, 10, 0, 0, -1, 0.68, 0.68, 0';

describe('parseVehicleDefs', () => {
  describe('negative cases', () => {
    it('returns an empty map when there is no cars section', () => {
      expect(parseVehicleDefs('objs\n1, foo, foo, 100, 0\nend').size).toBe(0);
    });

    it('skips rows without the wheel columns', () => {
      const result = parseVehicleDefs('cars\n445, admiral, admiral, car\nend');
      expect(result.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('parses a car row keyed by lowercased model name', () => {
      const result = parseVehicleDefs(`cars\n${ADMIRAL}\nend`);
      const def = result.get('admiral');
      expect(def).toMatchObject({
        handlingId: 'ADMIRAL',
        id: 445,
        model: 'admiral',
        txd: 'admiral',
        type: 'car',
        wheelModelId: -1,
        wheelScale: [0.68, 0.68],
      });
    });

    it('parses the real vehicles.ide (admiral + camper wheel scale)', () => {
      if (!existsSync(idePath)) {
        return;
      }
      const result = parseVehicleDefs(readFileSync(idePath, 'utf8'));
      expect(result.get('admiral')?.wheelScale).toEqual([0.68, 0.68]);
      expect(result.get('camper')?.wheelScale).toEqual([0.66, 0.66]);
    });
  });
});
