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

      expect(scan.overrides.size).toBe(0);
      expect(scan.settings).toEqual([]);
    });

    it('ignores non-dff/txd/txt files under modloader/', () => {
      const scan = scanModloader(fakeFs({ 'modloader/a/preview.png': Uint8Array.of(1), 'modloader/readme.md': 'x' }));

      expect(scan.overrides.size).toBe(0);
      expect(scan.settings).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('overrides every dff/txd by bare name — at the root or nested any depth, ignoring folder names', () => {
      const scan = scanModloader(
        fakeFs({
          'modloader/a/b/c/d/alpha.txd': Uint8Array.of(3), // deeply nested
          'modloader/Admiral - 1976 Mercedes-Benz 230 - k1real24/admiral.dff': Uint8Array.of(2), // one level
          'modloader/root.dff': Uint8Array.of(1), // at the root of modloader/
        }),
      );

      expect([...scan.overrides.keys()].sort()).toEqual(['admiral.dff', 'alpha.txd', 'root.dff']);
      expect([...new Uint8Array(scan.overrides.get('admiral.dff')!)]).toEqual([2]);
      expect([...new Uint8Array(scan.overrides.get('alpha.txd')!)]).toEqual([3]);
    });

    it('keeps every txd of a multi-txd mod, each under its own bare name', () => {
      const scan = scanModloader(
        fakeFs({
          'modloader/alpha/alpha1.txd': Uint8Array.of(3),
          'modloader/alpha/alpha2.txd': Uint8Array.of(4),
          'modloader/alpha/alpha.dff': Uint8Array.of(1),
          'modloader/alpha/alpha.txd': Uint8Array.of(2),
        }),
      );

      expect([...scan.overrides.keys()].sort()).toEqual(['alpha.dff', 'alpha.txd', 'alpha1.txd', 'alpha2.txd']);
    });

    it('parses each *.settings.txt it finds', () => {
      const scan = scanModloader(fakeFs({ 'modloader/blade/blade.settings.txt': 'blade, 1,3' }));

      expect(scan.settings).toEqual([{ carcolsLine: 'blade, 1,3' }]);
    });
  });
});
