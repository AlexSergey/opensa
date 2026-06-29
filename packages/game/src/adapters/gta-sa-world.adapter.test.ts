import type * as Renderware from '@opensa/renderware';

import { Matrix4 } from 'three';
import { describe, expect, it, vi } from 'vitest';

import { GtaSaWorldAdapter, toModelColliders } from './gta-sa-world.adapter';

// Stub the map resolution; keep grid/cell builders real. The adapter reads everything from the VFS now.
vi.mock('@opensa/renderware', async (importActual) => {
  const actual = await importActual<typeof Renderware>();

  return {
    ...actual,
    resolveMap: (): Renderware.MapDefinitions => ({
      carGenerators: [
        {
          alarm: 0,
          angle: 1,
          doorLock: 0,
          forceSpawn: 0,
          id: 400,
          position: [10, 20, 3],
          primaryColor: -1,
          secondaryColor: -1,
        },
        {
          alarm: 0,
          angle: 2,
          doorLock: 0,
          forceSpawn: 0,
          id: -1,
          position: [-50, -50, 5],
          primaryColor: -1,
          secondaryColor: -1,
        },
      ],
      catalog: new Map([[1, { drawDistance: 300, flags: 0, id: 1, modelName: 'house', txdName: 'txd' }]]),
      imgDirs: [],
      instances: [{ id: 1, interior: 0, lod: -1, modelName: '', position: [10, 10, 0], rotation: [0, 0, 0, 1] }],
    }),
  };
});

function cfg(): ConstructorParameters<typeof GtaSaWorldAdapter>[0] {
  return { cellSize: 250, fs: fakeFs() };
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

/** Empty asset file system — the map comes from the mocked resolveMap; optional data files are absent. */
function fakeFs(): Renderware.AssetFileSystem {
  return { get: () => null, getText: () => null, has: () => false, names: [] };
}

const SURFACE = { brightness: 0, flag: 0, light: 0, material: 0 };

/** A file system serving the three vehicle-data files `ensureVehicleData` requires. */
function vehicleFs(carcols: string): Renderware.AssetFileSystem {
  const files: Record<string, string> = {
    'data/carcols.dat': carcols,
    'data/handling.cfg': '',
    'data/vehicles.ide': '',
  };

  return { get: () => null, getText: (name) => files[name] ?? null, has: (name) => name in files, names: [] };
}

describe('GtaSaWorldAdapter.vehicleColourCombos', () => {
  const CARCOLS = [
    'col',
    '0,0,0',
    '10,20,30',
    '40,50,60',
    'end',
    'car',
    'testcar, 1,2, 2,1',
    'end',
    'car4',
    'quadcar, 0,1,2,1',
    'end',
  ].join('\n');
  const adapter = (): GtaSaWorldAdapter => new GtaSaWorldAdapter({ cellSize: 250, fs: vehicleFs(CARCOLS) });

  describe('negative cases', () => {
    it('returns empty for a car with no carcols entry', async () => {
      expect(await adapter().vehicleColourCombos('nope')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('returns the car own 2-colour combos in order (case-insensitive)', async () => {
      expect(await adapter().vehicleColourCombos('TestCar')).toEqual([
        [1, 2],
        [2, 1],
      ]);
    });

    it('includes 4-colour combos', async () => {
      expect(await adapter().vehicleColourCombos('quadcar')).toEqual([[0, 1, 2, 1]]);
    });
  });
});

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

const VEHICLES_IDE = [
  'cars',
  '400, landstal, landstal, car, LANDSTAL, LANDSTAL, null, normal, 10, 0, 0, 169, 0.82, 0.82, -1',
  '489, rancher, rancher, car, RANCHER, RANCHER, null, normal, 7, 0, 0, 191, 0.85, 0.85, -1',
  'end',
].join('\n');

/** cargrp with the 18 `POPCYCLE_GROUP_*` lines; the Workers group (index 0) holds `rancher`. */
function cargrpText(): string {
  const names = [
    'WORKERS',
    'BUSINESS',
    'CLUBBERS',
    'FARMERS',
    'BEACHFOLK',
    'PARKFOLK',
    'CASUAL_RICH',
    'CASUAL_AVERAGE',
    'CASUAL_POOR',
    'PROSTITUTES',
    'CRIMINALS',
    'GOLFERS',
    'SERVANTS',
    'AIRCREW',
    'ENTERTAINERS',
    'OUT_OF_TOWN_FACTORY',
    'DESERT_FOLK',
    'AIRCREW_RUNWAY',
  ];

  return names.map((name, i) => `${i === 0 ? 'rancher' : `car${i}`}  # POPCYCLE_GROUP_${name}`).join('\n');
}

/** A file system serving vehicles.ide/carcols/handling, plus any extra data files (popcycle/cargrp). */
function dataFs(extra: Record<string, string> = {}): Renderware.AssetFileSystem {
  const files: Record<string, string> = {
    'data/carcols.dat': '',
    'data/handling.cfg': '',
    'data/vehicles.ide': VEHICLES_IDE,
    ...extra,
  };

  return { get: () => null, getText: (name) => files[name] ?? null, has: (name) => name in files, names: [] };
}

/** popcycle with a COUNTRYSIDE block whose weekday slot 0 weights only the Workers group (index 0). */
function popcycleText(): string {
  const weights = Array.from({ length: 18 }, (_, i) => (i === 0 ? 100 : 0)).join(' ');

  return ['//////', '// COUNTRYSIDE', '//////', '// Weekday', `  2 6 100 100 100 100  ${weights}  // Midnight`].join(
    '\n',
  );
}

describe('GtaSaWorldAdapter.mapCarGenerators', () => {
  describe('negative cases', () => {
    it('returns only the specific-model generators when popcycle/cargrp are absent', async () => {
      const adapter = new GtaSaWorldAdapter({ cellSize: 250, fs: dataFs() });
      await adapter.prepare();

      const out = await adapter.mapCarGenerators({ cityAt: () => 'COUNTRYSIDE', hour: 0 });

      expect(out.map((placement) => placement.model)).toEqual(['landstal']); // id 400 → landstal; id=-1 dropped
      expect(out[0].heading).toBe(1); // heading from the IPL angle
    });
  });

  describe('positive cases', () => {
    it('resolves specific + random (popcycle → cargrp) generators', async () => {
      const adapter = new GtaSaWorldAdapter({
        cellSize: 250,
        fs: dataFs({ 'data/cargrp.dat': cargrpText(), 'data/popcycle.dat': popcycleText() }),
      });
      await adapter.prepare();

      const out = await adapter.mapCarGenerators({ cityAt: () => 'COUNTRYSIDE', hour: 0 });

      // id 400 → landstal (specific); id -1 in COUNTRYSIDE → Workers group → rancher (random).
      expect(out.map((placement) => placement.model).sort()).toEqual(['landstal', 'rancher']);
    });
  });
});
