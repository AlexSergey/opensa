import { describe, expect, it } from 'vitest';

import type { AssetFileSystem } from '../archive';
import type { IplInstance, MapDefinitions } from '../parsers/text';

import { resolveMap } from './resolve-map';

/** Index a resolved map's instances by object id (the LOD-flagging tests look up by id). */
function index(defs: MapDefinitions): Map<number, IplInstance> {
  return new Map(defs.instances.map((instance) => [instance.id, instance]));
}

/** Minimal map: one IDE (ids 100 + 3261) and one text IPL placing id 100, plus a standalone group. */
const FILES: Record<string, ArrayBuffer | string> = {
  'data/gta.dat': 'IDE DATA\\MAPS\\test\\test.ide\nIPL DATA\\MAPS\\test\\test.ipl',
  'data/maps/test/test.ide': [
    'objs',
    '100, house, housetxd, 100, 0',
    '3261, grasshouse, grasshouse, 299, 4',
    'end',
  ].join('\n'),
  'data/maps/test/test.ipl': ['inst', '100, house, 0, 10, 20, 5, 0, 0, 0, 1, -1', 'end'].join('\n'),
  // The binary stream matching the text IPL's basename — no INST, two CARS (one specific model, one random).
  'test_stream0.ipl': binaryIpl(
    [],
    [
      { id: 452, position: [10, 20, 3] },
      { id: -1, position: [-5, 7, 1] },
    ],
  ),
  // Standalone binary group, packed bare (from gta3.img) — keyed by name without a path.
  'truthsfarm.ipl': binaryIpl([{ id: 3261, position: [-1023.1, -1632.5, 75.5] }]),
};

/** Build a synthetic "bnry" IPL (the real header/record layout, see ipl-binary.parser) with INST + CARS. */
function binaryIpl(
  instances: { id: number; lod?: number; position: [number, number, number] }[],
  cars: { id: number; position: [number, number, number] }[] = [],
): ArrayBuffer {
  const carsOffset = 76 + instances.length * 40;
  const buffer = new ArrayBuffer(carsOffset + cars.length * 48);
  const view = new DataView(buffer);
  for (const [index, char] of [...'bnry'].entries()) {
    view.setUint8(index, char.charCodeAt(0));
  }
  view.setUint32(0x04, instances.length, true);
  view.setUint32(0x1c, 76, true);
  if (cars.length > 0) {
    view.setUint32(0x14, cars.length, true);
    view.setUint32(0x3c, carsOffset, true);
  }
  instances.forEach((instance, index) => {
    const offset = 76 + index * 40;
    view.setFloat32(offset, instance.position[0], true);
    view.setFloat32(offset + 4, instance.position[1], true);
    view.setFloat32(offset + 8, instance.position[2], true);
    view.setFloat32(offset + 24, 1, true); // unit quaternion (w)
    view.setUint32(offset + 28, instance.id, true);
    view.setInt32(offset + 36, instance.lod ?? -1, true);
  });
  cars.forEach((car, index) => {
    const offset = carsOffset + index * 48;
    view.setFloat32(offset, car.position[0], true);
    view.setFloat32(offset + 4, car.position[1], true);
    view.setFloat32(offset + 8, car.position[2], true);
    view.setInt32(offset + 16, car.id, true);
    view.setInt32(offset + 20, -1, true); // random primary colour
    view.setInt32(offset + 24, -1, true); // random secondary colour
  });

  return buffer;
}

/** A fake AssetFileSystem backed by an in-memory file map (string files → text, ArrayBuffer → binary). */
function fakeFs(files: Record<string, ArrayBuffer | string>): AssetFileSystem {
  return {
    get(name: string): ArrayBuffer | null {
      const file = files[name];
      if (file === undefined) {
        return null;
      }

      return typeof file === 'string' ? new TextEncoder().encode(file).buffer : file;
    },
    getText(name: string): null | string {
      const file = files[name];

      return typeof file === 'string' ? file : null;
    },
    has: (name: string): boolean => name in files,
    names: Object.keys(files),
  };
}

describe('resolveMap extraIpl (standalone binary IPL groups, plan 042)', () => {
  describe('negative cases', () => {
    it('loads no standalone groups when the option is absent', () => {
      const defs = resolveMap(fakeFs(FILES));
      expect(defs.instances).toHaveLength(1); // only the text IPL placement
      expect(defs.instances[0].id).toBe(100);
    });

    it('skips missing standalone files without failing the map', () => {
      const defs = resolveMap(fakeFs(FILES), { extraIpl: ['truthsfarm', 'nosuchgroup'] });
      expect(defs.instances.map((instance) => instance.id).sort((a, b) => a - b)).toEqual([100, 3261]);
    });
  });

  describe('positive cases', () => {
    it('merges configured standalone group instances into the map', () => {
      const defs = resolveMap(fakeFs(FILES), { extraIpl: ['truthsfarm'] });
      expect(defs.instances).toHaveLength(2);
      const farm = defs.instances.find((instance) => instance.id === 3261);
      expect(farm).toBeDefined();
      expect(farm?.position[0]).toBeCloseTo(-1023.1, 3);
      expect(farm?.lod).toBe(-1);
      expect(defs.catalog.get(3261)?.modelName).toBe('grasshouse'); // resolvable via the IDE catalog
    });
  });
});

describe('resolveMap LOD flagging (isLod from the IPL lod index)', () => {
  // A text IPL where instance 0 (an HD) points its `lod` at instance 1 (its LOD stand-in), plus a binary stream
  // whose HD (id 200) points at the companion text instance 2 — index-based, regardless of model names.
  const LOD_FILES: Record<string, ArrayBuffer | string> = {
    'data/gta.dat': 'IDE DATA\\MAPS\\l\\l.ide\nIPL DATA\\MAPS\\l\\l.ipl',
    'data/maps/l/l.ide': ['objs', '1, hd, t, 300, 0', '2, hdlod, t, 1500, 0', '3, farbit, t, 1500, 0', 'end'].join(
      '\n',
    ),
    'data/maps/l/l.ipl': [
      'inst',
      '1, hd, 0, 0, 0, 0, 0, 0, 0, 1, 1', // HD → lod index 1
      '2, hdlod, 0, 0, 0, 0, 0, 0, 0, 1, -1', // its LOD (name lacks the `lod` prefix)
      '3, farbit, 0, 5, 5, 5, 0, 0, 0, 1, -1', // LOD target of the binary HD below
      'end',
    ].join('\n'),
    'l_stream0.ipl': binaryIpl([{ id: 200, lod: 2, position: [5, 5, 5] }]), // binary HD → companion text index 2
  };

  describe('negative cases', () => {
    it('leaves a non-targeted HD instance unflagged', () => {
      const byId = index(resolveMap(fakeFs(LOD_FILES)));
      expect(byId.get(1)?.isLod).toBeFalsy();
      expect(byId.get(200)?.isLod).toBeFalsy();
    });
  });

  describe('positive cases', () => {
    it('flags a text-internal LOD target (by index, name-agnostic)', () => {
      expect(index(resolveMap(fakeFs(LOD_FILES))).get(2)?.isLod).toBe(true);
    });

    it('flags a binary stream HD′s companion-text LOD target', () => {
      expect(index(resolveMap(fakeFs(LOD_FILES))).get(3)?.isLod).toBe(true);
    });
  });
});

describe('resolveMap car generators (binary IPL CARS sections)', () => {
  describe('positive cases', () => {
    it('collects the stream CARS records into carGenerators (specific + random)', () => {
      const defs = resolveMap(fakeFs(FILES));

      expect(defs.carGenerators).toHaveLength(2);
      expect(defs.carGenerators?.map((car) => car.id)).toEqual([452, -1]);
      expect(defs.carGenerators?.[0].position[0]).toBeCloseTo(10, 3);
      expect(defs.carGenerators?.[1].primaryColor).toBe(-1); // random colour
    });
  });
});
