import { describe, expect, it } from 'vitest';

import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';

import { buildWorldGrid, cellKey, instanceCell } from './world-grid';

type Vec3 = [number, number, number];

function def(id: number, modelName: string): IdeObjectDef {
  return { drawDistance: 300, flags: 0, id, modelName, txdName: 'txd' };
}

function inst(id: number, position: Vec3, interior = 0): IplInstance {
  return { id, interior, lod: -1, modelName: '', position, rotation: [0, 0, 0, 1] };
}

function mapDefs(defs: IdeObjectDef[], instances: IplInstance[]): MapDefinitions {
  return { catalog: new Map(defs.map((d) => [d.id, d])), imgDirs: [], instances };
}

describe('instanceCell / cellKey', () => {
  describe('positive cases', () => {
    it('floors a position to a cell (X/Y only) and keys it', () => {
      expect(instanceCell([260, -10, 99], 250)).toEqual([1, -1]);
      expect(cellKey(1, -1)).toBe('1,-1');
    });
  });
});

describe('buildWorldGrid', () => {
  describe('negative cases', () => {
    it('skips instances with no catalog def', () => {
      const grid = buildWorldGrid(mapDefs([], [inst(99, [0, 0, 0])]), 250);
      expect(grid.size).toBe(0);
    });

    it('skips interior instances', () => {
      const grid = buildWorldGrid(mapDefs([def(1, 'house')], [inst(1, [0, 0, 0], 13)]), 250);
      expect(grid.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('buckets instances into cells by position', () => {
      const defs = mapDefs([def(1, 'house')], [inst(1, [10, 10, 0]), inst(1, [260, 10, 0]), inst(1, [20, 20, 0])]);
      const grid = buildWorldGrid(defs, 250);

      expect(grid.size).toBe(2);
      expect(grid.get(cellKey(0, 0))?.hd).toHaveLength(2);
      expect(grid.get(cellKey(1, 0))?.hd).toHaveLength(1);
    });

    it('splits HD and LOD by model name within a cell', () => {
      const defs = mapDefs([def(1, 'house'), def(2, 'LODhouse')], [inst(1, [10, 10, 0]), inst(2, [20, 20, 0])]);
      const cell = buildWorldGrid(defs, 250).get(cellKey(0, 0));

      expect(cell?.hd).toHaveLength(1);
      expect(cell?.lod).toHaveLength(1);
      expect(cell?.hd[0].id).toBe(1);
      expect(cell?.lod[0].id).toBe(2);
    });
  });
});
