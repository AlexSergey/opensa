import { readFileSync } from 'node:fs';
import { type InstancedMesh, Matrix4, type Object3D, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Renderware from '../../renderware';

import { GtaSaWorldAdapter } from './gta-sa-world.adapter';

/** Read a committed fixture as a fresh ArrayBuffer. */
function buffer(path: string): ArrayBuffer {
  const data = readFileSync(path);

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

// Real pipeline end-to-end: keep every builder/parser real; only the network entry points
// (loadArchive / resolveMap) are replaced with a fixture-backed archive holding washer.dff.
vi.mock('../../renderware', async (importActual) => {
  const actual = await importActual<typeof Renderware>();
  const { readFileSync: read } = await import('node:fs');
  const toAB = (path: string): ArrayBuffer => {
    const data = read(path);

    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  };
  const files = new Map<string, ArrayBuffer>([
    ['junk.txd', toAB('tests/txd/junk.txd')],
    ['washer.dff', toAB('tests/dff/building/washer.dff')],
  ]);
  const archive: Renderware.ImgArchive = {
    get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
    names: [...files.keys()],
  };

  return {
    ...actual,
    loadArchive: (): Promise<Renderware.ImgArchive> => Promise.resolve(archive),
    resolveMap: (): Promise<Renderware.MapDefinitions> =>
      Promise.resolve({
        catalog: new Map([[1, { drawDistance: 300, flags: 0, id: 1, modelName: 'washer', txdName: 'junk' }]]),
        imgDirs: [],
        instances: [
          { id: 1, interior: 0, lod: -1, modelName: 'washer', position: [10, 10, 0], rotation: [0, 0, 0, 1] },
        ],
      }),
  };
});

function cfg(): ConstructorParameters<typeof GtaSaWorldAdapter>[0] {
  return { archiveUrl: 'a', base: 'base', cellSize: 250, datUrl: 'd' };
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

/** Stub global fetch from a (url → response body) resolver; unknown urls 404. */
function stubFetch(resolve: (url: string) => ArrayBuffer | null | string): void {
  vi.stubGlobal('fetch', (url: string) => {
    const body = resolve(String(url));
    if (body === null) {
      return Promise.resolve({ ok: false, status: 404 });
    }

    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(body),
      ok: true,
      status: 200,
      text: () => Promise.resolve(body),
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('GtaSaWorldAdapter integration', () => {
  describe('positive cases', () => {
    it('builds a real cell end-to-end (washer.dff → instanced mesh at the placed position)', async () => {
      stubFetch(() => null); // prepare()'s optional data files (procobj/surfinfo/object.dat) → absent
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
      const timecyc = readFileSync('tests/data/timecyc.dat', 'utf8');
      stubFetch((url) => (url.endsWith('timecyc.dat') && !url.endsWith('timecyc_24h.dat') ? timecyc : null));
      const result = await new GtaSaWorldAdapter(cfg()).loadTimecyc();
      expect(result.weathers).toHaveLength(21);
      expect(result.weathers[0].name).toBe('EXTRASUNNY_LA');
      expect(result.weathers[0].hours).toHaveLength(24);
    });

    it('loads a skinned character end-to-end (tommy.dff → 32-bone skeleton)', async () => {
      stubFetch((url) => {
        if (url.endsWith('.dff')) {
          return buffer('tests/dff/skinned/tommy.dff');
        }

        return url.endsWith('.txd') ? buffer('tests/txd/junk.txd') : null;
      });
      const character = await new GtaSaWorldAdapter(cfg()).loadCharacter('tommy.dff', 'tommy.txd');
      expect(character.skeleton?.bones).toHaveLength(32);
      expect(character.bonesByName.has('Root')).toBe(true);
      expect(character.object).toBeDefined();
    });

    it('loads animations directly from an .ifp file (no packed archive)', async () => {
      stubFetch((url) => (url.endsWith('.ifp') ? buffer('tests/dff/anim-clump/counxref.ifp') : null));
      const clips = await new GtaSaWorldAdapter(cfg()).loadAnimations('anim/ped.ifp');
      expect(clips.size).toBe(4); // counxref.ifp's four animations
      expect(clips.has('derrick01')).toBe(true);
    });
  });
});
