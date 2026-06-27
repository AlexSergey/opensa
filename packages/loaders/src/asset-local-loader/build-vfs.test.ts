import { describe, expect, it } from 'vitest';

import type { InstallSource } from './build-vfs';
import type { LazyImgArchive } from './img-reader';

import { readEntry, selectInstallEntries } from './build-vfs';

const IDE = ['objs', '100, cj, cjtxd, 100, 0', '200, tree, treetxd, 80, 0', 'end'].join('\n');
// Only id 100 is placed in the exterior map → tree (200) must be dropped from the selection.
const IPL = ['inst', '100, cj, 0, 0, 0, 0, 0, 0, 0, 1, 0', 'end'].join('\n');

/** A fake archive over an in-memory name→bytes map (no .ipl entries → binary-IPL path is skipped). */
function fakeArchive(files: Record<string, Uint8Array>): LazyImgArchive {
  return {
    has: (name) => name.toLowerCase() in files,
    names: Object.keys(files),
    read: (name) => Promise.resolve(files[name.toLowerCase()] ?? null),
  };
}

function source(overrides: Partial<InstallSource> = {}): InstallSource {
  const loose: Record<string, string> = { 'data/gta.dat': '', 'data/maps/test.ide': IDE, 'data/maps/test.ipl': IPL };
  const gta3 = fakeArchive({
    'cj.dff': new Uint8Array([1, 2, 3]),
    'cjtxd.txd': new Uint8Array([4, 5]),
    'la.col': new Uint8Array([6]),
    'tree.dff': new Uint8Array([7]),
  });

  return {
    gta3,
    gtaInt: null,
    looseFiles: () => Promise.resolve(Object.keys(loose)),
    readLoose: (path) => Promise.resolve(new TextEncoder().encode(loose[path])),
    readLooseText: (path) => Promise.resolve(loose[path] ?? ''),
    ...overrides,
  };
}

describe('selectInstallEntries', () => {
  describe('negative cases', () => {
    it('drops models that are referenced but not placed in the exterior map', async () => {
      const plan = await selectInstallEntries(source());

      expect(plan.models.map((e) => e.name)).not.toContain('tree.dff');
    });
  });

  describe('positive cases', () => {
    it('selects the placed model + its txd + col into models, and no other world files', async () => {
      const plan = await selectInstallEntries(source());

      expect(plan.models).toEqual([
        { name: 'cj.dff', source: 'gta3' },
        { name: 'la.col', source: 'gta3' },
      ]);
      expect(plan.textures).toEqual([{ name: 'cjtxd.txd', source: 'gta3' }]);
      expect(plan.others).toEqual([]);
      expect(plan.loose).toEqual(['data/gta.dat', 'data/maps/test.ide', 'data/maps/test.ipl']);
    });

    it('pulls in the named peds (peds.ide) + EVERY vehicle in vehicles.ide; ignores unnamed peds', async () => {
      const loose: Record<string, string> = {
        'data/peds.ide': 'peds\n66, bmypol1, bmypol1, CIVMALE\n9, cesar, cesar, CIVMALE\nend',
        'data/vehicles.ide': [
          'cars',
          '400, admiral, admtxd, car, ADMIRAL, gm, null, normal, 10, 7, 0, 100, 1.0, 1.0, 0',
          '402, buffalo, buftxd, car, BUFFALO, gm, null, normal, 10, 7, 0, 100, 1.0, 1.0, 0',
          'end',
        ].join('\n'),
      };
      const gta3 = fakeArchive({
        'admiral.dff': new Uint8Array([1]),
        'admtxd.txd': new Uint8Array([1]),
        'bmypol1.dff': new Uint8Array([1]),
        'bmypol1.txd': new Uint8Array([1]),
        'buffalo.dff': new Uint8Array([1]),
        'buftxd.txd': new Uint8Array([1]),
        'cesar.dff': new Uint8Array([1]),
      });
      const plan = await selectInstallEntries(
        source({
          gta3,
          looseFiles: () => Promise.resolve(Object.keys(loose)),
          readLooseText: (p) => Promise.resolve(loose[p] ?? ''),
        }),
        { peds: ['bmypol1', 'unknownped'] },
      );

      // Every vehicle (admiral + buffalo) + the named bmypol1 (cesar is not requested).
      expect(plan.models.map((e) => e.name).sort()).toEqual(['admiral.dff', 'bmypol1.dff', 'buffalo.dff']);
      expect(plan.textures.map((e) => e.name).sort()).toEqual(['admtxd.txd', 'bmypol1.txd', 'buftxd.txd']);
    });
  });
});

describe('readEntry', () => {
  describe('negative cases', () => {
    it('throws when the entry is missing from its archive', async () => {
      await expect(readEntry(source(), { name: 'gone.dff', source: 'gta3' })).rejects.toThrow(/missing archive entry/);
    });

    it('throws when the entry resolves to gta_int but there is none', async () => {
      await expect(readEntry(source(), { name: 'x.dff', source: 'gta_int' })).rejects.toThrow(/missing archive entry/);
    });
  });

  describe('positive cases', () => {
    it('reads an entry from gta3 by name', async () => {
      expect(Array.from(await readEntry(source(), { name: 'cj.dff', source: 'gta3' }))).toEqual([1, 2, 3]);
    });
  });
});
