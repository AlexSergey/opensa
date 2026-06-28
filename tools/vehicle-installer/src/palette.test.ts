import { describe, expect, it } from 'vitest';

import { addPaletteColors, resolveColorRefs } from './palette';

const CARCOLS = ['col', '0,0,0    # 0 black', '255,255,255  # 1 white', 'end', 'car', 'admiral, 1,1', 'end'].join('\n');
const PALETTE = [
  { line: '233,199,40  # new1 yellow', name: 'new1' },
  { line: '186,208,125 # new2 green', name: 'new2' },
];

/** The colour (RGB) lines inside the `col … end` section. */
function colLines(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf('col');
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i].trim() !== 'end'; i += 1) {
    out.push(lines[i]);
  }

  return out;
}

describe('addPaletteColors', () => {
  describe('negative cases', () => {
    it('is a no-op for an empty palette', () => {
      const result = addPaletteColors(CARCOLS, []);
      expect(result.text).toBe(CARCOLS);
      expect(result.idByName.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('appends colours with ids continuing the palette length, rewriting the # comment', () => {
      const { idByName, text } = addPaletteColors(CARCOLS, PALETTE);
      expect(idByName.get('new1')).toBe(2); // 2 existing colours (0, 1) → next is 2
      expect(idByName.get('new2')).toBe(3);
      expect(colLines(text)).toEqual([
        '0,0,0    # 0 black',
        '255,255,255  # 1 white',
        '233,199,40  # 2 yellow', // newN replaced with the assigned id
        '186,208,125 # 3 green',
      ]);
    });

    it('accumulates ids across successive vehicles', () => {
      const first = addPaletteColors(CARCOLS, [PALETTE[0]]).text; // new1 → 2
      const { idByName } = addPaletteColors(first, [{ line: '1,2,3 # new1 next', name: 'new1' }]);
      expect(idByName.get('new1')).toBe(3); // palette now has 3 colours (0,1,2) → next is 3
    });
  });
});

describe('resolveColorRefs', () => {
  describe('positive cases', () => {
    it('replaces each newN ref with its id (whole-word, not inside new10)', () => {
      const map = new Map([
        ['new1', 127],
        ['new2', 128],
      ]);
      expect(resolveColorRefs('cabbie, 6,0,6,0, new2,0,new2,0, new1,0,new1,0', map)).toBe(
        'cabbie, 6,0,6,0, 128,0,128,0, 127,0,127,0',
      );
    });
  });
});
