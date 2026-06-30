import type { AssetFileSystem } from '@opensa/renderware/archive';

import { describe, expect, it } from 'vitest';

import { scanModloader } from './scan';

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

describe('scanModloader', () => {
  describe('negative cases', () => {
    it('returns an empty overlay when there is no modloader/ tree', () => {
      const scan = scanModloader(fakeFs({ 'admiral.dff': Uint8Array.of(1) }));

      expect(scan.assets.size).toBe(0);
      expect(scan.texts.size).toBe(0);
      expect(scan.dataMerges.size).toBe(0);
      expect(scan.mapRefs).toEqual({ col: [], ide: [], ipl: [] });
      expect(scan.settings).toEqual([]);
    });

    it('ignores unrelated files (images, .md) under modloader/', () => {
      const scan = scanModloader(fakeFs({ 'modloader/a/preview.png': Uint8Array.of(1), 'modloader/readme.md': 'x' }));

      expect(scan.assets.size).toBe(0);
      expect(scan.texts.size).toBe(0);
    });

    it('ignores a prose .txt (readme) that carries no IDE/IPL/COLFILE directives', () => {
      const scan = scanModloader(
        fakeFs({ 'modloader/LOD/readme.txt': 'Thanks for downloading!\nKEEP THIS FILE INSIDE MODLOADER' }),
      );

      expect(scan.mapRefs).toEqual({ col: [], ide: [], ipl: [] });
      expect(scan.settings).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('buckets dff/txd/col/ifp + binary _stream IPLs into assets by bare name (folder-agnostic, any depth)', () => {
      const scan = scanModloader(
        fakeFs({
          'modloader/Fixes/cn2_ringking.ifp': Uint8Array.of(5), // animation package → bytes
          'modloader/MyLod/hd/gta3img/cedar1_hi.dff': Uint8Array.of(1),
          'modloader/MyLod/hd/gta3img/vegetation.txd': Uint8Array.of(2),
          'modloader/MyLod/lod/gta3img/countn2_stream0.ipl': Uint8Array.of(4), // binary stream → bytes
          'modloader/MyLod/lod/gta3img/lodtrees.col': Uint8Array.of(3),
        }),
      );

      expect([...scan.assets.keys()].sort()).toEqual([
        'cedar1_hi.dff',
        'cn2_ringking.ifp',
        'countn2_stream0.ipl',
        'lodtrees.col',
        'vegetation.txd',
      ]);
      expect([...new Uint8Array(scan.assets.get('cn2_ringking.ifp')!)]).toEqual([5]);
    });

    it('buckets .ide / text .ipl / whole-file .dat (surfinfo) into texts by bare name', () => {
      const scan = scanModloader(
        fakeFs({
          'modloader/MyLod/lod/data/maps/country/countn2.ipl': 'inst\nend', // text IPL override (no _stream)
          'modloader/MyLod/lod/data/maps/lodtrees.ide': 'objs\nend',
          'modloader/MyLod/lod/data/surfinfo.dat': '...', // index-based → whole-file override, not additive
        }),
      );

      expect([...scan.texts.keys()].sort()).toEqual(['countn2.ipl', 'lodtrees.ide', 'surfinfo.dat']);
      expect(scan.texts.get('lodtrees.ide')).toBe('objs\nend');
    });

    it('buckets an additive .dat (procobj/object) into dataMerges, accumulating every mod copy', () => {
      const scan = scanModloader(
        fakeFs({
          'modloader/A/data/object.dat': 'crate, 1',
          'modloader/A/data/procobj.dat': 'P_SAND a',
          'modloader/B/data/procobj.dat': 'P_SAND b',
        }),
      );

      expect([...scan.dataMerges.keys()].sort()).toEqual(['object.dat', 'procobj.dat']);
      expect(scan.dataMerges.get('procobj.dat')?.sort()).toEqual(['P_SAND a', 'P_SAND b']);
      expect(scan.texts.has('procobj.dat')).toBe(false);
    });

    it('collects IDE/IPL/COLFILE refs from a loader file regardless of its name (Loader.txt, prose tolerated)', () => {
      const scan = scanModloader(
        fakeFs({
          'modloader/LOD Vegetation/Loader.txt':
            'LOD Vegetation by Junior_Djjr\nKEEP THIS FILE INSIDE MODLOADER\n\nCOLFILE 0 DATA\\MAPS\\LODvegetation.COL\nIDE DATA\\MAPS\\LODvegetation.IDE',
          'modloader/MyProc/lod/loader.txt': 'IDE data/maps/lod_procobj.ide\nIPL data/maps/lod_procobj.ipl',
        }),
      );

      expect(scan.mapRefs.ide.sort()).toEqual(['DATA\\MAPS\\LODvegetation.IDE', 'data/maps/lod_procobj.ide']);
      expect(scan.mapRefs.ipl).toEqual(['data/maps/lod_procobj.ipl']);
      expect(scan.mapRefs.col).toEqual(['DATA\\MAPS\\LODvegetation.COL']);
    });

    it('parses a *.settings.txt as a vehicle settings file (not a loader)', () => {
      const scan = scanModloader(fakeFs({ 'modloader/blade/blade.settings.txt': 'blade, 1,3' }));

      expect(scan.settings).toEqual([{ carcolsLine: 'blade, 1,3' }]);
      expect(scan.mapRefs).toEqual({ col: [], ide: [], ipl: [] });
    });
  });
});
