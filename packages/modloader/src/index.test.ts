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
  });
});
