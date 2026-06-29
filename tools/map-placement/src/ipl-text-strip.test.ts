import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { stripTextIpl } from './ipl-text-strip';

/** A text IPL `inst` block from rows `[id, name, lod]`, with CRLF endings (as the real Rockstar files use). */
function ipl(rows: readonly (readonly [number, string, number])[], eol = '\r\n'): string {
  const lines = ['inst', ...rows.map(([id, name, lod]) => `${id}, ${name}, 0, 0, 0, 0, 0, 0, 0, 1, ${lod}`), 'end'];

  return lines.join(eol) + eol;
}

const keepAll = (): boolean => true;
const dropName =
  (drop: string) =>
  (_id: number, name: string): boolean =>
    name.toLowerCase() !== drop.toLowerCase();

/** The set of `hdModel -> lodModel` pairings a parsed IPL resolves to (order-independent). */
function pairings(insts: ReturnType<typeof parseIpl>): Set<string> {
  const set = new Set<string>();
  for (const inst of insts) {
    if (inst.lod >= 0 && inst.lod < insts.length) {
      set.add(`${inst.modelName} -> ${insts[inst.lod].modelName}`);
    }
  }

  return set;
}

describe('stripTextIpl', () => {
  describe('negative cases', () => {
    it('returns the text unchanged when there is no inst section', () => {
      const text = 'cull\r\n1, 2, 3\r\nend\r\n';
      const result = stripTextIpl(text, dropName('anything'));

      expect(result.removed).toBe(0);
      expect(result.text).toBe(text);
      expect(result.map).toHaveLength(0);
    });

    it('returns the text byte-identical when keep accepts every row', () => {
      const text = ipl([
        [1, 'hd_a', 2],
        [2, 'lod_a', -1],
      ]);
      const result = stripTextIpl(text, keepAll);

      expect(result.removed).toBe(0);
      expect(result.text).toBe(text);
    });

    it('does not renumber lod links when nothing is removed', () => {
      const result = stripTextIpl(ipl([[1, 'hd_a', 0]]), keepAll);

      expect(result.map).toEqual(Int32Array.of(0));
    });
  });

  describe('positive cases', () => {
    it('drops matching rows and reports the count', () => {
      const result = stripTextIpl(
        ipl([
          [1, 'keep', -1],
          [2, 'tree', -1],
          [3, 'tree', -1],
        ]),
        dropName('tree'),
      );

      expect(result.removed).toBe(2);
      expect(parseIpl(result.text).map((i) => i.modelName)).toEqual(['keep']);
    });

    it('preserves CRLF line endings', () => {
      const result = stripTextIpl(
        ipl([
          [1, 'keep', -1],
          [2, 'tree', -1],
        ]),
        dropName('tree'),
      );

      expect(result.text).toContain('\r\n');
      expect(result.text).not.toMatch(/[^\r]\n/);
    });

    it('re-indexes surviving lod links to their new row positions', () => {
      // hd_a -> lod_a (row 2); removing the middle row shifts lod_a to row 1, so hd_a.lod must become 1.
      const result = stripTextIpl(
        ipl([
          [1, 'hd_a', 2],
          [2, 'tree', -1],
          [3, 'lod_a', -1],
        ]),
        dropName('tree'),
      );
      const out = parseIpl(result.text);

      expect(out.map((i) => i.modelName)).toEqual(['hd_a', 'lod_a']);
      expect(out[0].lod).toBe(1);
      expect(result.map).toEqual(Int32Array.of(0, -1, 1));
    });

    it('transitively removes a dropped row LOD target', () => {
      // Dropping tree_hd must also drop the lod_tree it points at, else the orphan LOD faults in-game.
      const result = stripTextIpl(
        ipl([
          [1, 'tree_hd', 1],
          [2, 'lod_tree', -1],
          [3, 'keep', -1],
        ]),
        dropName('tree_hd'),
      );

      expect(result.removed).toBe(2);
      expect(parseIpl(result.text).map((i) => i.modelName)).toEqual(['keep']);
      expect(result.map).toEqual(Int32Array.of(-1, -1, 0));
    });

    it('preserves comments and surrounding sections verbatim', () => {
      const text = ['# header', 'inst', '1, keep, 0, 0,0,0, 0,0,0,1, -1', '# note', 'end', 'cull', 'end'].join('\r\n');
      const result = stripTextIpl(text, keepAll);

      expect(result.text).toContain('# header');
      expect(result.text).toContain('# note');
      expect(result.text).toContain('cull');
    });

    it('strips the tree LOD bigbuildings from the real countrye.ipl (524 survive)', () => {
      const text = readFileSync('tests/original/ipl_text/countrye.ipl', 'utf8');
      const result = stripTextIpl(text, (_id, name) => name.toLowerCase() !== 'lod_vbg_fir_co');

      expect(result.removed).toBeGreaterThan(0);
      expect(result.map).toHaveLength(parseIpl(text).length);
      expect(parseIpl(result.text).some((i) => i.modelName.toLowerCase() === 'lod_vbg_fir_co')).toBe(false);
    });

    it('keeps every internal HD to LOD pairing intact in the real lae.ipl', () => {
      const text = readFileSync('tests/original/ipl_text/lae.ipl', 'utf8');
      const before = pairings(parseIpl(text));
      // laeroad39 is an HD with a LOD link (→ LODroad39t) and is itself never a LOD target, so dropping it
      // cascades both rows away and leaves every other pairing intact — the property a real tree strip needs.
      const result = stripTextIpl(text, dropName('laeroad39'));
      const after = pairings(parseIpl(result.text));

      expect(result.removed).toBe(2);
      expect(before.has('laeroad39 -> LODroad39t')).toBe(true);
      expect(after.has('laeroad39 -> LODroad39t')).toBe(false);
      expect([...after].every((pair) => before.has(pair))).toBe(true);
    });
  });
});
