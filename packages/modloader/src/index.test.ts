import type { AssetFileSystem } from '@opensa/renderware/archive';

import { describe, expect, it } from 'vitest';

import { withModloader } from './index';

const SUB = 'modloader/admiral - 1976 Mercedes-Benz 230 - k1real24';
const IDE = '400, landstal, landstal, car\n445, admiral, admiral, car, OLDADMIRAL\n';
const HANDLING = 'LANDSTAL 1700\nADMIRAL 2000 stock\n';
const CARCOLS = 'car\nlandstal, 1,1\nadmiral, 9,9\nend\n';
const MODDED_HANDLING =
  'ADMIRAL 1600.0 5000.0 2.0 0.0 0.3 -0.2 70 0.9 0.8 0.5 5 160.0 24.0 10.0 R P 8.5 0.5 0 35.0 1.6 0.1 0.0 0.27 -0.18 0.5 0.0 0.5 0.3 35000 4000 0 1 0';
const SETTINGS = [
  '445, admiral, admiral, car, ADMIRAL, ADMIRAL, sedan, ignore, 7, 0, 0, -1, 0.7, 0.7, -1',
  MODDED_HANDLING,
  'admiral, 4,5',
].join('\n\n');

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

describe('withModloader', () => {
  describe('negative cases', () => {
    it('returns the same fs when there is no modloader/ overlay', () => {
      const fs = fakeFs({ 'data/handling.cfg': HANDLING });

      expect(withModloader(fs)).toBe(fs);
    });
  });

  describe('positive cases', () => {
    it('shadows the stock dff/txd under the bare <model>.* key (what the loader reads)', () => {
      const fs = fakeFs({
        [`${SUB}/admiral.dff`]: Uint8Array.from([1, 2, 3]),
        [`${SUB}/admiral.txd`]: Uint8Array.from([4, 5]),
        'admiral.dff': Uint8Array.from([9]), // stock gta3.img model — must be overridden
        'admiral.txd': Uint8Array.from([8]), // stock txd — must be overridden
      });
      const mod = withModloader(fs);

      expect([...new Uint8Array(mod.get('admiral.dff')!)]).toEqual([1, 2, 3]);
      expect([...new Uint8Array(mod.get('admiral.txd')!)]).toEqual([4, 5]);
      expect(mod.has('admiral.dff')).toBe(true);
      expect(mod.names).toContain('admiral.dff');
    });

    it('merges the settings into vehicles.ide / handling.cfg / carcols.dat', () => {
      const fs = fakeFs({
        [`${SUB}/admiral.dff`]: Uint8Array.from([1]),
        [`${SUB}/admiral.settings.txt`]: SETTINGS,
        'data/carcols.dat': CARCOLS,
        'data/handling.cfg': HANDLING,
        'data/vehicles.ide': `cars\n${IDE}end\n`,
      });
      const mod = withModloader(fs);

      expect(mod.getText('data/vehicles.ide')).toContain('445, admiral, admiral, car, ADMIRAL');
      expect(mod.getText('data/vehicles.ide')).not.toContain('OLDADMIRAL');
      expect(mod.getText('data/vehicles.ide')).toContain('400, landstal'); // other untouched
      expect(mod.getText('data/handling.cfg')).toContain(MODDED_HANDLING);
      expect(mod.getText('data/handling.cfg')).not.toContain('ADMIRAL 2000 stock'); // replaced
      expect(mod.getText('data/handling.cfg')).toContain('LANDSTAL 1700'); // untouched
      expect(mod.getText('data/carcols.dat')).toContain('admiral, 4,5');
      expect(mod.getText('data/carcols.dat')).not.toContain('admiral, 9,9');
    });

    it('passes through unrelated reads', () => {
      const fs = fakeFs({ [`${SUB}/admiral.dff`]: Uint8Array.from([1]), 'data/gta.dat': 'IMG x' });
      const mod = withModloader(fs);

      expect(mod.getText('data/gta.dat')).toBe('IMG x');
      expect(mod.get('missing.dff')).toBeNull();
    });

    it('merges a map mod: loader IDE/IPL → gta.dat, and serves its IDE/IPL/col/stream by bare name', () => {
      const fs = fakeFs({
        'data/gta.dat': 'IDE data/maps/stock.ide\nIPL data/maps/country/countn2.ipl\n',
        'data/maps/country/countn2.ipl': 'inst\nend\n', // stock text IPL (no LOD rows)
        'modloader/MyLod/lod/data/maps/country/countn2.ipl': 'inst\n5000, lodtree, 0, 1, 2, 3, 0, 0, 0, 1, -1\nend\n',
        'modloader/MyLod/lod/data/maps/lodtrees.ide': 'objs\n5000, lodtree, lodtrees, 1500\nend\n',
        'modloader/MyLod/lod/gta3img/countn2_stream0.ipl': Uint8Array.from([7]),
        'modloader/MyLod/lod/gta3img/lodtrees.col': Uint8Array.from([8]),
        'modloader/MyLod/lod/loader.txt': 'IDE data/maps/lodtrees.ide',
      });
      const mod = withModloader(fs);

      // The loader's IDE line is appended to gta.dat; no IPL line (the stock IPL overrides by name).
      expect(mod.getText('data/gta.dat')).toBe(
        'IDE data/maps/stock.ide\nIPL data/maps/country/countn2.ipl\nIDE data/maps/lodtrees.ide\n',
      );
      // New IDE + the modified stock text IPL resolve by their gta.dat path (basename match).
      expect(mod.getText('data/maps/lodtrees.ide')).toContain('5000, lodtree');
      expect(mod.getText('data/maps/country/countn2.ipl')).toContain('5000, lodtree'); // mod override, not stock
      // Binary stream + col served by bare name; col is in names so buildCollisionIndex finds it.
      expect([...new Uint8Array(mod.get('countn2_stream0.ipl')!)]).toEqual([7]);
      expect([...new Uint8Array(mod.get('lodtrees.col')!)]).toEqual([8]);
      expect(mod.names).toContain('lodtrees.col');
    });

    it('additively merges procobj.dat — keeps stock species, replaces/adds the mod’s, no whole-file clobber', () => {
      const row = (s: string, m: string, sp: string): string =>
        [s, m, sp, '60', '0', '360', '1', '1', '1', '1', '0', '0', '0', '0'].join('\t');
      const fs = fakeFs({
        'data/procobj.dat': `# stock\n${row('p_sand', 'cactus', '16')}\n${row('p_grass', 'fern', '10')}\n`,
        'modloader/Props/data/procobj.dat': `${row('p_sand', 'cactus', '99')}\n${row('p_dirt', 'weed', '12')}`,
      });
      const out = withModloader(fs).getText('data/procobj.dat')!;
      const rows = out.split('\n');

      expect(rows.some((l) => /^p_grass\s+fern\s+10/i.test(l))).toBe(true); // stock species kept (not clobbered)
      expect(rows.filter((l) => /^p_sand\s+cactus/i.test(l))).toHaveLength(1); // replaced in place
      expect(out).toContain('p_sand\tcactus\t99');
      expect(out).toContain('p_dirt\tweed'); // mod's new species added
    });

    it('overrides an .ifp by bare name and by path (getIfp reads `<name>.ifp`, loadAnimations reads `anim/<name>.ifp`)', () => {
      const fs = fakeFs({
        'cn2_ringking.ifp': Uint8Array.from([9]), // stock animation package (anim.img entry)
        'modloader/Fixes/cn2_ringking.ifp': Uint8Array.from([1, 2, 3]),
      });
      const mod = withModloader(fs);

      expect([...new Uint8Array(mod.get('cn2_ringking.ifp')!)]).toEqual([1, 2, 3]); // getIfp's bare-name read
      expect([...new Uint8Array(mod.get('anim/cn2_ringking.ifp')!)]).toEqual([1, 2, 3]); // loadAnimations' path read
      expect(mod.names).toContain('cn2_ringking.ifp');
    });
  });
});
