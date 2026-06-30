import type { AssetFileSystem } from '@opensa/renderware/archive';

import { resolveMap } from '@opensa/renderware';
import { describe, expect, it } from 'vitest';

import { withModloader } from './index';

/**
 * End-to-end: a `modloader/` **map mod** of the shape `lod-trees`/`lod-procobj` `--modloader` emit (a `lod/` mod +
 * a `hd/` txdp mod) loads through the real engine `resolveMap` once wrapped by `withModloader` — proving the
 * decorator alone (no engine change) makes the new defs, `txdp` parents, text-IPL override and binary-stream
 * `lod` repoint take effect.
 */

/** One-INST binary ("bnry") IPL — enough for `parseBinaryIpl` (numInst@4, instOffset@0x1C; id@28, lod@36). */
function binaryIpl(id: number, lod: number): Uint8Array {
  const HEADER = 0x4c;
  const buffer = new Uint8Array(HEADER + 40);
  const view = new DataView(buffer.buffer);
  buffer.set(new TextEncoder().encode('bnry'), 0);
  view.setUint32(0x04, 1, true); // numInst
  view.setUint32(0x1c, HEADER, true); // instOffset
  view.setFloat32(HEADER + 24, 1, true); // rotation w
  view.setUint32(HEADER + 28, id, true);
  view.setInt32(HEADER + 36, lod, true);

  return buffer;
}

/** A minimal in-memory AssetFileSystem from name → (string text | Uint8Array bytes). */
function fakeFs(entries: Record<string, string | Uint8Array>): AssetFileSystem {
  return {
    get: (name): ArrayBuffer | null => {
      const value = entries[name];

      return value instanceof Uint8Array
        ? (value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer)
        : null;
    },
    getText: (name): null | string => {
      const value = entries[name];

      return typeof value === 'string' ? value : null;
    },
    has: (name): boolean => name in entries,
    names: Object.keys(entries),
  };
}

describe('withModloader + resolveMap (map mod end-to-end)', () => {
  describe('positive cases', () => {
    it('loads the mod’s defs, txdp parents, text-IPL override and stream lod-repoint via resolveMap', () => {
      const fs = fakeFs({
        'area_stream0.ipl': binaryIpl(700, -1), // stock HD, no LOD link yet
        // stock game
        'data/gta.dat': 'IDE data/maps/stock.ide\nIPL data/maps/area.ipl\n',
        'data/maps/area.ipl': 'inst\nend\n', // stock: no placements
        'data/maps/stock.ide': 'objs\n700, mytree, mytreetxd, 299, 0\nend\n',
        'modloader/M/hd/data/maps/lodtrees_hd.ide': 'txdp\nmytreetxd, vegetation\nend\n',
        // hd/ txdp mod
        'modloader/M/hd/loader.txt': 'IDE data/maps/lodtrees_hd.ide',
        'modloader/M/lod/data/maps/area.ipl': 'inst\n5000, lodmytree, 0, 1, 2, 3, 0, 0, 0, 1, -1\nend\n', // + LOD row
        'modloader/M/lod/data/maps/lodtrees.ide': 'objs\n5000, lodmytree, lodtrees, 1500, 0\nend\n',
        'modloader/M/lod/gta3img/area_stream0.ipl': binaryIpl(700, 0), // HD lod → the new text-IPL row 0
        // lod/ mod
        'modloader/M/lod/loader.txt': 'IDE data/maps/lodtrees.ide',
      });

      const defs = resolveMap(withModloader(fs));

      // New object def loaded from the mod's IDE (merged into gta.dat), stock def still present.
      expect(defs.catalog.get(5000)?.modelName).toBe('lodmytree');
      expect(defs.catalog.has(700)).toBe(true);
      // txdp parent from the hd/ mod's IDE → wired by the engine's setTxdParents.
      expect(defs.txdParents?.get('mytreetxd')).toBe('vegetation');
      // The modified stock text IPL shadowed the empty stock one (its LOD instance is present).
      expect(defs.instances.some((inst) => inst.id === 5000)).toBe(true);
      // The modified binary stream shadowed the stock one — the HD's lod is repointed (was -1).
      expect(defs.instances.find((inst) => inst.id === 700)?.lod).toBe(0);
    });
  });
});
