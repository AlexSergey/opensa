import { describe, expect, it } from 'vitest';

import type { AssetFileSystem } from '../archive';

import { resolveMap } from './resolve-map';

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
  // Standalone binary group, packed bare (from gta3.img) — keyed by name without a path.
  'truthsfarm.ipl': binaryIpl([{ id: 3261, position: [-1023.1, -1632.5, 75.5] }]),
};

/** Build a synthetic "bnry" IPL (the real header/record layout, see ipl-binary.parser). */
function binaryIpl(instances: { id: number; position: [number, number, number] }[]): ArrayBuffer {
  const buffer = new ArrayBuffer(76 + instances.length * 40);
  const view = new DataView(buffer);
  for (const [index, char] of [...'bnry'].entries()) {
    view.setUint8(index, char.charCodeAt(0));
  }
  view.setUint32(0x04, instances.length, true);
  view.setUint32(0x1c, 76, true);
  instances.forEach((instance, index) => {
    const offset = 76 + index * 40;
    view.setFloat32(offset, instance.position[0], true);
    view.setFloat32(offset + 4, instance.position[1], true);
    view.setFloat32(offset + 8, instance.position[2], true);
    view.setFloat32(offset + 24, 1, true); // unit quaternion (w)
    view.setUint32(offset + 28, instance.id, true);
    view.setInt32(offset + 36, -1, true); // no LOD
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
