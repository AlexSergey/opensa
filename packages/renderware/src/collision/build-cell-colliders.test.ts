import { describe, expect, it } from 'vitest';

import type { GridCell, WorldGrid } from '../map/world-grid';
import type { ColModel } from '../parsers/binary/col-types';
import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';
import type { CollisionIndex } from './collision-index';

import { cellKey } from '../map/world-grid';
import { buildCellColliders } from './build-cell-colliders';

type Vec3 = [number, number, number];

function colModel(name: string): ColModel {
  return {
    bounds: { center: [0, 0, 0], max: [0, 0, 0], min: [0, 0, 0], radius: 0 },
    boxes: [],
    faces: [],
    modelId: 0,
    name,
    spheres: [],
    version: 2,
    vertices: new Float32Array(),
  };
}

function def(id: number, modelName: string): IdeObjectDef {
  return { drawDistance: 300, flags: 0, id, modelName, txdName: 'txd' };
}

function gridWith(cx: number, cy: number, cell: Partial<GridCell>): WorldGrid {
  return new Map([[cellKey(cx, cy), { cx, cy, hd: [], lod: [], ...cell }]]);
}

function index(...models: ColModel[]): CollisionIndex {
  return new Map(models.map((m) => [m.name.toLowerCase(), m]));
}

function inst(id: number, position: Vec3 = [0, 0, 0]): IplInstance {
  return { id, interior: 0, lod: -1, modelName: '', position, rotation: [0, 0, 0, 1] };
}

function mapDefs(defs: IdeObjectDef[]): MapDefinitions {
  return { catalog: new Map(defs.map((d) => [d.id, d])), imgDirs: [], instances: [] };
}

describe('buildCellColliders', () => {
  describe('negative cases', () => {
    it('returns nothing for a cell not in the grid', () => {
      expect(buildCellColliders(index(), mapDefs([]), new Map(), 5, 5)).toEqual([]);
    });

    it('skips HD models that have no collision in the index', () => {
      const defs = mapDefs([def(1, 'wall')]);
      const grid = gridWith(0, 0, { hd: [inst(1)] });
      expect(buildCellColliders(index(), defs, grid, 0, 0)).toEqual([]);
    });

    it('ignores the cell LOD instances (LODs have no collision)', () => {
      const defs = mapDefs([def(2, 'lodwall')]);
      const grid = gridWith(0, 0, { lod: [inst(2)] });
      expect(buildCellColliders(index(colModel('lodwall')), defs, grid, 0, 0)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('binds the cell HD instances to their collision with one transform per placement', () => {
      const defs = mapDefs([def(1, 'wall')]);
      const grid = gridWith(0, 0, { hd: [inst(1, [10, 20, 30]), inst(1, [40, 50, 60])] });

      const colliders = buildCellColliders(index(colModel('wall')), defs, grid, 0, 0);
      expect(colliders).toHaveLength(1);
      expect(colliders[0].name).toBe('wall');
      expect(colliders[0].transforms).toHaveLength(2);
    });
  });
});
