import { describe, expect, it } from 'vitest';

import type { CustomTxd } from './retxd';

import { editIdeTxd, selectTxd, txdpIde, txdpPairs } from './retxd';

const ide = (rows: readonly string[]): string => ['objs', ...rows, 'end', ''].join('\r\n');
const txd = (name: string, textures: readonly string[]): CustomTxd => ({
  bytes: new Uint8Array(0),
  name,
  textures: new Set(textures),
});

describe('editIdeTxd', () => {
  describe('negative cases', () => {
    it('leaves the text unchanged when no row matches', () => {
      const text = ide(['615, veg_tree3, gta_tree_boak, 150, 2130052']);
      const result = editIdeTxd(text, new Map([['other', 'custom']]));

      expect(result.changed).toBe(false);
      expect(result.text).toBe(text);
    });

    it('does not touch matching names outside an objs/tobj/anim section', () => {
      const text = ['path', '615, veg_tree3, gta_tree_boak, 1', 'end', ''].join('\r\n');
      const result = editIdeTxd(text, new Map([['veg_tree3', 'custom']]));

      expect(result.changed).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('rewrites only the txd column of matching rows, keeping the other cells', () => {
      const text = ide(['615, veg_tree3, gta_tree_boak, 150, 2130052', '616, other, gta_tree_boak, 150, 2130052']);
      const result = editIdeTxd(text, new Map([['veg_tree3', 'bsor5s_txdp']]));
      const rows = result.text.split('\r\n');

      expect(result.changed).toBe(true);
      expect(rows[1]).toBe('615, veg_tree3, bsor5s_txdp, 150, 2130052');
      expect(rows[2]).toBe('616, other, gta_tree_boak, 150, 2130052');
    });

    it('matches model names case-insensitively and preserves CRLF', () => {
      const result = editIdeTxd(
        ide(['3505, VgsN_nitree_y01, vgsn_nitree, 120, 2097156']),
        new Map([['vgsn_nitree_y01', 'custom']]),
      );

      expect(result.text).toContain('3505, VgsN_nitree_y01, custom, 120, 2097156');
      expect(result.text).toContain('\r\n');
    });
  });
});

describe('selectTxd', () => {
  const trees = txd('bsor5s_txdp', ['bark1', 'leaf1']);
  const rocks = txd('rocks', ['stone1']);

  describe('negative cases', () => {
    it('returns undefined when no custom TXD contains any of the textures (keep the stock txd)', () => {
      expect(selectTxd(new Set(['gta_procdesert_a', 'gta_procdesert_b']), [trees, rocks])).toBeUndefined();
    });

    it('returns undefined for an empty custom-TXD list', () => {
      expect(selectTxd(new Set(['bark1']), [])).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('picks the custom TXD that covers the referenced textures', () => {
      expect(selectTxd(new Set(['bark1', 'leaf1']), [trees, rocks])).toBe(trees);
    });

    it('picks the TXD with the most hits when textures span several', () => {
      expect(selectTxd(new Set(['bark1', 'leaf1', 'stone1']), [rocks, trees])).toBe(trees);
    });
  });
});

describe('txdpPairs', () => {
  describe('negative cases', () => {
    it('skips a model whose stock TXD is unknown (no IDE row found)', () => {
      const pairs = txdpPairs(new Map([['veg_tree3', 'vegetation']]), new Map());

      expect(pairs.size).toBe(0);
    });

    it('skips a self-parent (model already uses the custom TXD as its stock TXD)', () => {
      const pairs = txdpPairs(new Map([['veg_tree3', 'vegetation']]), new Map([['veg_tree3', 'vegetation']]));

      expect(pairs.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('parents each model’s stock TXD (child) to its custom TXD (parent)', () => {
      const pairs = txdpPairs(new Map([['veg_tree3', 'vegetation']]), new Map([['veg_tree3', 'gta_tree_boak']]));

      expect([...pairs]).toEqual([['gta_tree_boak', 'vegetation']]);
    });

    it('collapses models sharing one stock TXD to a single parent link', () => {
      const pairs = txdpPairs(
        new Map([
          ['veg_tree3', 'vegetation'],
          ['veg_tree4', 'vegetation'],
        ]),
        new Map([
          ['veg_tree3', 'gta_tree_boak'],
          ['veg_tree4', 'gta_tree_boak'],
        ]),
      );

      expect([...pairs]).toEqual([['gta_tree_boak', 'vegetation']]);
    });
  });
});

describe('txdpIde', () => {
  describe('negative cases', () => {
    it('emits an empty (header/footer only) section for no pairs', () => {
      expect(txdpIde(new Map())).toBe('txdp\n\nend\n');
    });
  });

  describe('positive cases', () => {
    it('emits a `txdp` section of `child, parent` rows ending in `end`', () => {
      const ide = txdpIde(
        new Map([
          ['gta_tree_boak', 'vegetation'],
          ['vgsn_nitree', 'vegetation'],
        ]),
      );

      expect(ide).toBe('txdp\ngta_tree_boak, vegetation\nvgsn_nitree, vegetation\nend\n');
    });
  });
});
