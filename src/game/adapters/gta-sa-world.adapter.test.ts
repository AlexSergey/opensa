import { Matrix4 } from 'three';
import { describe, expect, it, vi } from 'vitest';

import type * as Renderware from '../../renderware';

import { GtaSaWorldAdapter, toModelColliders } from './gta-sa-world.adapter';

// Stub the network parts of the renderware barrel; keep grid/cell builders real.
vi.mock('../../renderware', async (importActual) => {
  const actual = await importActual<typeof Renderware>();

  return {
    ...actual,
    loadArchive: (): Promise<Renderware.ImgArchive> => Promise.resolve({ get: () => null, names: [] }),
    resolveMap: (): Promise<Renderware.MapDefinitions> =>
      Promise.resolve({
        catalog: new Map([[1, { drawDistance: 300, flags: 0, id: 1, modelName: 'house', txdName: 'txd' }]]),
        imgDirs: [],
        instances: [{ id: 1, interior: 0, lod: -1, modelName: '', position: [10, 10, 0], rotation: [0, 0, 0, 1] }],
      }),
  };
});

function cfg(): ConstructorParameters<typeof GtaSaWorldAdapter>[0] {
  return { archiveUrl: 'a', base: 'b', cellSize: 250, datUrl: 'd' };
}

function colModel(partial: Partial<Renderware.ColModel>): Renderware.ColModel {
  return {
    bounds: { center: [0, 0, 0], max: [0, 0, 0], min: [0, 0, 0], radius: 0 },
    boxes: [],
    faces: [],
    modelId: 0,
    name: 'col',
    spheres: [],
    version: 2,
    vertices: new Float32Array(),
    ...partial,
  };
}

const SURFACE = { brightness: 0, flag: 0, light: 0, material: 0 };

describe('toModelColliders', () => {
  describe('negative cases', () => {
    it('produces empty shape arrays for a model with no geometry', () => {
      const result = toModelColliders({ col: colModel({}), name: 'empty', transforms: [] });

      expect(result.name).toBe('empty');
      expect(result.shape.indices).toHaveLength(0);
      expect(result.shape.boxes).toEqual([]);
      expect(result.shape.spheres).toEqual([]);
      expect(result.transforms).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('flattens faces into a triangle index array and passes vertices through', () => {
      const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
      const col = colModel({
        faces: [
          { a: 0, b: 1, c: 2, light: 0, material: 0 },
          { a: 2, b: 3, c: 0, light: 0, material: 0 },
        ],
        vertices,
      });

      const result = toModelColliders({ col, name: 'wall', transforms: [new Matrix4()] });
      expect(Array.from(result.shape.indices)).toEqual([0, 1, 2, 2, 3, 0]);
      expect(result.shape.vertices).toBe(vertices); // passthrough, not copied
      expect(result.transforms).toHaveLength(1);
    });

    it('maps box and sphere primitives (dropping surface data)', () => {
      const col = colModel({
        boxes: [{ max: [1, 1, 1], min: [-1, -1, -1], surface: SURFACE }],
        spheres: [{ center: [0, 0, 2], radius: 0.5, surface: SURFACE }],
      });

      const result = toModelColliders({ col, name: 'prop', transforms: [] });
      expect(result.shape.boxes).toEqual([{ max: [1, 1, 1], min: [-1, -1, -1] }]);
      expect(result.shape.spheres).toEqual([{ center: [0, 0, 2], radius: 0.5 }]);
    });
  });
});

describe('GtaSaWorldAdapter cell streaming', () => {
  describe('negative cases', () => {
    it('throws when loadCell is called before prepare', async () => {
      await expect(new GtaSaWorldAdapter(cfg()).loadCell({ cx: 0, cy: 0, lod: false })).rejects.toThrow();
    });

    it('throws when loadCellColliders is called before prepare', async () => {
      await expect(new GtaSaWorldAdapter(cfg()).loadCellColliders(0, 0)).rejects.toThrow();
    });
  });

  describe('positive cases', () => {
    it('exposes the configured cell size', () => {
      expect(new GtaSaWorldAdapter(cfg()).cellSize).toBe(250);
    });

    it('caches a built cell (same array on repeat loads)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      const first = await adapter.loadCell({ cx: 0, cy: 0, lod: false });
      const second = await adapter.loadCell({ cx: 0, cy: 0, lod: false });

      expect(second).toBe(first);
    });

    it('caches a cell’s colliders (same array on repeat loads)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      const first = await adapter.loadCellColliders(0, 0);
      const second = await adapter.loadCellColliders(0, 0);

      expect(second).toBe(first);
    });
  });
});
