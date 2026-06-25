import type { Texture } from 'three';

import { describe, expect, it } from 'vitest';

import { resolveTxdChain } from './asset-cache';

/** A stand-in Texture (the resolver only moves references around, never touches the texture). */
const tex = (id: string): Texture => ({ id }) as unknown as Texture;

/** Fake per-TXD texture maps as `[txdName, { textureName: id }]` tuples; `ownOf` reads from this. */
function provider(maps: [string, Record<string, string>][]): (name: string) => Map<string, Texture> {
  const lookup = new Map(maps.map(([name, textures]) => [name, textures]));

  return (name) => new Map(Object.entries(lookup.get(name) ?? {}).map(([k, v]) => [k, tex(v)]));
}

const id = (texture: Texture | undefined): string => (texture as unknown as { id: string }).id;

describe('resolveTxdChain', () => {
  describe('negative cases', () => {
    it('returns only the own map when the TXD has no parent', () => {
      const ownOf = provider([['a51', { road: 'a51-road' }]]);
      const resolved = resolveTxdChain('a51', ownOf, new Map());
      expect([...resolved.keys()]).toEqual(['road']);
    });

    it('ignores a self-referential parent', () => {
      const ownOf = provider([['loop', { t: 'loop-t' }]]);
      const resolved = resolveTxdChain('loop', ownOf, new Map([['loop', 'loop']]));
      expect([...resolved.keys()]).toEqual(['t']);
    });

    it('does not loop on a cyclic parent chain', () => {
      const ownOf = provider([
        ['a', { ta: 'a' }],
        ['b', { tb: 'b' }],
      ]);
      const resolved = resolveTxdChain(
        'a',
        ownOf,
        new Map([
          ['a', 'b'],
          ['b', 'a'],
        ]),
      );
      expect([...resolved.keys()].sort()).toEqual(['ta', 'tb']);
    });
  });

  describe('positive cases', () => {
    it('inherits missing textures from the parent', () => {
      const ownOf = provider([
        ['a51', { local: 'a51-local' }],
        ['countn2_gene', { shared: 'gene-shared' }],
      ]);
      const resolved = resolveTxdChain('a51', ownOf, new Map([['a51', 'countn2_gene']]));
      expect([...resolved.keys()].sort()).toEqual(['local', 'shared']);
      expect(id(resolved.get('shared'))).toBe('gene-shared');
    });

    it('lets the child override a texture of the same name', () => {
      const ownOf = provider([
        ['child', { road: 'child-road' }],
        ['parent', { road: 'parent-road' }],
      ]);
      const resolved = resolveTxdChain('child', ownOf, new Map([['child', 'parent']]));
      expect(id(resolved.get('road'))).toBe('child-road');
    });

    it('walks a multi-level chain (grandparent → parent → child)', () => {
      const ownOf = provider([
        ['child', { c: 'c' }],
        ['parent', { p: 'p' }],
        ['gp', { g: 'g' }],
      ]);
      const resolved = resolveTxdChain(
        'child',
        ownOf,
        new Map([
          ['child', 'parent'],
          ['parent', 'gp'],
        ]),
      );
      expect([...resolved.keys()].sort()).toEqual(['c', 'g', 'p']);
    });

    it('collapses to the child when the parent TXD is absent (empty own map)', () => {
      const ownOf = provider([['a51', { road: 'a51-road' }]]); // no 'missing_gene' supplied
      const resolved = resolveTxdChain('a51', ownOf, new Map([['a51', 'missing_gene']]));
      expect([...resolved.keys()]).toEqual(['road']);
    });
  });
});
