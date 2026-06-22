import { readFileSync } from 'node:fs';
import { type InstancedMesh, Matrix4, type Object3D, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';

import type * as Renderware from '../../renderware';

import { GtaSaWorldAdapter } from './gta-sa-world.adapter';

/** Read a committed fixture as a fresh ArrayBuffer. */
function buffer(path: string): ArrayBuffer {
  const data = readFileSync(path);

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

// Real pipeline end-to-end: keep every builder/parser real; only the map resolution is stubbed (one
// washer placement). Everything else is read from a fixture-backed AssetFileSystem passed in config.
vi.mock('../../renderware', async (importActual) => {
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

function cfg(): ConstructorParameters<typeof GtaSaWorldAdapter>[0] {
  return { cellSize: 250, fs: fakeFs() };
}

/** Fixture file system: bare model/txd names + loose data paths, as the build packs them. */
function fakeFs(): Renderware.AssetFileSystem {
  const files = new Map<string, ArrayBuffer | string>([
    ['anim/ped.ifp', buffer('tests/original/dff/anim-clump/counxref.ifp')],
    ['bmypol1.dff', buffer('tests/original/character/bmypol1.dff')],
    ['bmypol1.txd', buffer('tests/original/character/bmypol1.txd')],
    ['data/timecyc.dat', readFileSync('tests/original/data/timecyc.dat', 'utf8')],
    ['junk.txd', buffer('tests/original/txd/junk.txd')],
    ['washer.dff', buffer('tests/original/dff/building/washer.dff')],
  ]);

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
  });
});
