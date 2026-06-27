import type { AssetFileSystem } from '@opensa/renderware/archive';

import { describe, expect, it } from 'vitest';

import { scanVehicles } from './scan';

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

describe('scanVehicles', () => {
  describe('negative cases', () => {
    it('returns nothing when there is no modloader/vehicles tree', () => {
      expect(scanVehicles(fakeFs({ 'admiral.dff': Uint8Array.of(1) }))).toEqual([]);
    });

    it('skips a subfolder with neither dff nor txd', () => {
      expect(scanVehicles(fakeFs({ 'modloader/vehicles/empty/readme.md': 'x' }))).toEqual([]);
    });

    it('skips a stray file directly under modloader/vehicles/ (no subfolder)', () => {
      expect(scanVehicles(fakeFs({ 'modloader/vehicles/loose.dff': Uint8Array.of(1) }))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('takes the model from the file base name, ignoring the descriptive folder name', () => {
      const mods = scanVehicles(
        fakeFs({
          'modloader/vehicles/Admiral - 1976 Mercedes-Benz 230 - k1real24/admiral.dff': Uint8Array.of(1, 2),
          'modloader/vehicles/Admiral - 1976 Mercedes-Benz 230 - k1real24/admiral.txd': Uint8Array.of(3),
        }),
      );

      expect(mods).toHaveLength(1);
      expect(mods[0].model).toBe('admiral');
      expect([...new Uint8Array(mods[0].dff!)]).toEqual([1, 2]);
      expect([...new Uint8Array(mods[0].txd!)]).toEqual([3]);
      expect(mods[0].settings).toBeUndefined();
    });

    it('handles a txd-only subfolder (model from the txd) and parses settings when present', () => {
      const mods = scanVehicles(
        fakeFs({
          'modloader/vehicles/blade/blade.settings.txt': 'blade, 1,3',
          'modloader/vehicles/blade/blade.txd': Uint8Array.of(7),
        }),
      );

      expect(mods).toHaveLength(1);
      expect(mods[0].model).toBe('blade');
      expect(mods[0].dff).toBeUndefined();
      expect(mods[0].settings).toEqual({ carcolsLine: 'blade, 1,3' });
    });
  });
});
