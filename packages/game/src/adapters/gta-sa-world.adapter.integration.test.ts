import type * as Renderware from '@opensa/renderware';

import { withModloader } from '@opensa/modloader';
import { readFileSync } from 'node:fs';
import { type InstancedMesh, Matrix4, type Object3D, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';

import { GtaSaWorldAdapter } from './gta-sa-world.adapter';

/** Read a committed fixture as a fresh ArrayBuffer. */
function buffer(path: string): ArrayBuffer {
  const data = readFileSync(path);

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

// Real pipeline end-to-end: keep every builder/parser real; only the map resolution is stubbed (one
// washer placement). Everything else is read from a fixture-backed AssetFileSystem passed in config.
vi.mock('@opensa/renderware', async (importActual) => {
  const actual = await importActual<typeof Renderware>();

  return {
    ...actual,
    resolveMap: (): Renderware.MapDefinitions => ({
      catalog: new Map([[1, { drawDistance: 300, flags: 0, id: 1, modelName: 'washer', txdName: 'junk' }]]),
      imgDirs: [],
      instances: [{ id: 1, interior: 0, lod: -1, modelName: 'washer', position: [10, 10, 0], rotation: [0, 0, 0, 1] }],
    }),
  };
});

/** The fixture-backed file map: bare model/txd names + loose data paths, as the build packs them. */
function baseFiles(): Map<string, ArrayBuffer | string> {
  return new Map<string, ArrayBuffer | string>([
    // Vehicle assets keyed by their BARE names only (no loose `vehicles/` folder) — exactly how the build packs
    // them and how `loadVehicle` reads them (`requireBuffer('<model>.dff'|'<txd>.txd')`).
    ['admiral.dff', buffer('tests/original/vehicles/admiral.dff')],
    ['admiral.txd', buffer('game-src/original/vehicles/admiral.txd')],
    ['anim/ped.ifp', buffer('tests/original/dff/anim-clump/counxref.ifp')],
    ['bmypol1.dff', buffer('tests/original/character/bmypol1.dff')],
    ['bmypol1.txd', buffer('tests/original/character/bmypol1.txd')],
    ['data/carcols.dat', readFileSync('game-src/original/data/carcols.dat', 'utf8')],
    ['data/handling.cfg', readFileSync('game-src/original/data/handling.cfg', 'utf8')],
    ['data/timecyc.dat', readFileSync('tests/original/data/timecyc.dat', 'utf8')],
    ['data/vehicles.ide', readFileSync('game-src/original/data/vehicles.ide', 'utf8')],
    ['junk.txd', buffer('tests/original/txd/junk.txd')],
    ['models/generic/vehicle.txd', buffer('game-src/original/models/generic/vehicle.txd')],
    ['washer.dff', buffer('tests/original/dff/building/washer.dff')],
  ]);
}

function cfg(): ConstructorParameters<typeof GtaSaWorldAdapter>[0] {
  return { cellSize: 250, fs: fakeFs() };
}

function fakeFs(): Renderware.AssetFileSystem {
  return fsFrom(baseFiles());
}

/** Wrap a fixture file map as an AssetFileSystem (case-insensitive keys). */
function fsFrom(files: Map<string, ArrayBuffer | string>): Renderware.AssetFileSystem {
  return {
    get(name: string): ArrayBuffer | null {
      const file = files.get(name.toLowerCase());
      if (file === undefined) {
        return null;
      }

      return typeof file === 'string' ? new TextEncoder().encode(file).buffer : file;
    },
    getText(name: string): null | string {
      const file = files.get(name.toLowerCase());

      return typeof file === 'string' ? file : null;
    },
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}

/** Find every InstancedMesh in a built cell. */
function instancedMeshes(meshes: Object3D[]): InstancedMesh[] {
  const out: InstancedMesh[] = [];
  for (const mesh of meshes) {
    mesh.traverse((child) => {
      if ((child as InstancedMesh).isInstancedMesh) {
        out.push(child as InstancedMesh);
      }
    });
  }

  return out;
}

describe('GtaSaWorldAdapter integration', () => {
  describe('positive cases', () => {
    it('builds a real cell end-to-end (washer.dff → instanced mesh at the placed position)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      const meshes = await adapter.loadCell({ cx: 0, cy: 0, lod: false });
      const instances = instancedMeshes(meshes);
      expect(instances.length).toBeGreaterThan(0);

      const mesh = instances[0];
      expect(mesh.count).toBe(1);
      const region = mesh.userData.region as Renderware.RegionMeshData;
      expect(region.def.modelName).toBe('washer');
      // The single placement sits at the instance's native Z-up position.
      const position = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(mesh.instanceMatrix.array, 0));
      expect(position.x).toBeCloseTo(10, 3);
      expect(position.y).toBeCloseTo(10, 3);
    });

    it('loads the timecyc as 24h weather table from the real timecyc.dat', async () => {
      const result = await new GtaSaWorldAdapter(cfg()).loadTimecyc();
      expect(result.weathers).toHaveLength(21);
      expect(result.weathers[0].name).toBe('EXTRASUNNY_LA');
      expect(result.weathers[0].hours).toHaveLength(24);
    });

    it('loads a skinned character end-to-end (bmypol1.dff → 32-bone skeleton)', async () => {
      const character = await new GtaSaWorldAdapter(cfg()).loadCharacter('bmypol1.dff', 'bmypol1.txd');
      expect(character.skeleton?.bones).toHaveLength(32);
      expect(character.bonesByName.has('Root')).toBe(true);
      expect(character.object).toBeDefined();
    });

    it('loads animations directly from an .ifp file (no packed archive)', async () => {
      const clips = await new GtaSaWorldAdapter(cfg()).loadAnimations('anim/ped.ifp');
      expect(clips.size).toBe(4); // counxref.ifp's four animations
      expect(clips.has('derrick01')).toBe(true);
    });

    it('loads a vehicle end-to-end by its bare gta3.img name (admiral via vehicles.ide)', async () => {
      // fakeFs holds only bare keys (admiral.dff/.txd) — a pass proves loadVehicle reads them directly,
      // with no loose `vehicles/` path. Resolved through vehicles.ide (model + txd both `admiral`).
      const vehicle = await new GtaSaWorldAdapter(cfg()).loadVehicle('admiral');
      expect(vehicle.object).toBeDefined();
      expect(vehicle.colliders).not.toBeNull(); // embedded COL parsed from the same DFF
      expect(vehicle.handling).toBeDefined(); // from handling.cfg
    });

    it('loadVehicle reads a modloader override end-to-end (overridden dff + merged handling)', async () => {
      // Drop the stock admiral.dff entirely: the load can ONLY succeed if `withModloader` serves the
      // mod's `admiral.dff` under its bare name. The mod's settings.txt bumps ADMIRAL's mass (1109 → 9999),
      // proving the merged handling.cfg reaches loadVehicle through the same decorator.
      const moddedHandling =
        'ADMIRAL 9999.0 2550.7 1.41 0.0 0.1 -0.15 77 0.65 0.74 0.52 4 198.0 17.2 12.9 R P 5 0.558 0 30.0 ' +
        '0.917 0.783 0.0 0.195 -0.045 0.50 0.10 0.45 0.43 35000 242000 1000002 1 1 0';
      const files = baseFiles();
      files.delete('admiral.dff'); // no stock model — only the override can satisfy the load
      // The loader lowercases every VFS key, so the descriptive folder name is lowercased here too.
      const dir = 'modloader/admiral - 1976 mercedes-benz 230 - k1real24';
      files.set(`${dir}/admiral.dff`, buffer('tests/original/vehicles/admiral.dff'));
      files.set(`${dir}/admiral.settings.txt`, moddedHandling);

      const fs = withModloader(fsFrom(files));
      const vehicle = await new GtaSaWorldAdapter({ cellSize: 250, fs }).loadVehicle('admiral');

      expect(vehicle.object).toBeDefined(); // built from the overridden dff (stock admiral.dff is absent)
      expect(vehicle.colliders).not.toBeNull();
      expect(vehicle.handling.mass).toBe(9999); // merged ADMIRAL handling line, not the stock 1109
    });
  });
});
