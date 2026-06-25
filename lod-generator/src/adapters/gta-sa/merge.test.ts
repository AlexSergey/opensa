import { describe, expect, it } from 'vitest';

import type { RWClump, RWGeometry } from '../../../../src/renderware/parsers/binary/types';
import type { Cell } from '../../core/types';
import type { ModelSource } from './model-source';

import { mergeCell } from './merge';

/** A clump of one atomic → one geometry. */
function clump(geom: RWGeometry): RWClump {
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ name: 'root', parentIndex: -1, position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: [geom],
  };
}

/** A one-triangle geometry with the given texture, at the given local positions. */
function geometry(texture: string, positions: number[]): RWGeometry {
  return {
    flags: 0,
    lights: [],
    materials: [{ color: [255, 255, 255, 255], texture: { maskName: '', name: texture }, textured: true }],
    nightColors: null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array(positions),
    prelitColors: null,
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  };
}

function source(models: Record<string, RWClump>): ModelSource {
  return { load: (model) => models[model.toLowerCase()] ?? null };
}

const IDENTITY = [0, 0, 0, 1] as const; // no rotation

describe('mergeCell', () => {
  describe('negative cases', () => {
    it('skips instances whose model is missing', () => {
      const cell: Cell = { cx: 0, cy: 0, instances: [{ model: 'absent', position: [0, 0, 0], rotation: IDENTITY }] };
      const mesh = mergeCell(cell, 256, source({}));
      expect(mesh.positions).toHaveLength(0);
      expect(mesh.groups).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('offsets vertices to the cell centre and applies the instance position', () => {
      const models = { box: clump(geometry('wall', [0, 0, 0, 1, 0, 0, 0, 1, 0])) };
      // cell (0,0) @256 → centre (128,128,0); instance at (130,128,5) → first vertex relative = (2,0,5).
      const cell: Cell = { cx: 0, cy: 0, instances: [{ model: 'box', position: [130, 128, 5], rotation: IDENTITY }] };
      const mesh = mergeCell(cell, 256, source(models));
      expect([...mesh.positions.slice(0, 3)]).toEqual([2, 0, 5]);
      expect(mesh.groups).toEqual([{ indices: Uint32Array.of(0, 1, 2), texture: 'wall' }]);
    });

    it('merges two instances of one model and re-bases triangle indices', () => {
      const models = { box: clump(geometry('wall', [0, 0, 0, 1, 0, 0, 0, 1, 0])) };
      const at = (x: number): Cell['instances'][number] => ({
        model: 'box',
        position: [x, 128, 0],
        rotation: IDENTITY,
      });
      const cell: Cell = { cx: 0, cy: 0, instances: [at(128), at(138)] };
      const mesh = mergeCell(cell, 256, source(models));
      expect(mesh.positions).toHaveLength(18); // 2 × 3 verts × 3
      expect([...mesh.groups[0].indices]).toEqual([0, 1, 2, 3, 4, 5]); // second instance re-based
    });

    it('groups triangles by texture across materials', () => {
      const models = {
        a: clump(geometry('road', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
        b: clump(geometry('grass', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
      };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [
          { model: 'a', position: [128, 128, 0], rotation: IDENTITY },
          { model: 'b', position: [128, 128, 0], rotation: IDENTITY },
        ],
      };
      const mesh = mergeCell(cell, 256, source(models));
      expect(mesh.groups.map((g) => g.texture).sort()).toEqual(['grass', 'road']);
    });
  });
});
