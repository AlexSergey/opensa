import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { describe, expect, it } from 'vitest';

import { type AppendInst, applyTextEdits } from './ipl-text-append';

/** A text IPL `inst` block from rows `[id, name, lod]`, CRLF endings. */
function ipl(rows: readonly (readonly [number, string, number])[]): string {
  const lines = ['inst', ...rows.map(([id, name, lod]) => `${id}, ${name}, 0, 0, 0, 0, 0, 0, 0, 1, ${lod}`), 'end'];

  return lines.join('\r\n') + '\r\n';
}

const noEdits = { appends: [], repoints: new Map() };
const impostor = (id: number, model: string): AppendInst => ({
  id,
  interior: 0,
  model,
  pos: [1, 2, 3],
  rot: [0, 0, 0, 1],
});

describe('applyTextEdits', () => {
  describe('negative cases', () => {
    it('returns the text unchanged when there is no inst section', () => {
      const text = 'cull\r\n1, 2, 3\r\nend\r\n';

      expect(applyTextEdits(text, noEdits)).toEqual({ instCount: 0, text });
    });

    it('returns the text unchanged but counts rows when there are no edits', () => {
      const text = ipl([
        [1, 'a', -1],
        [2, 'b', -1],
      ]);
      const result = applyTextEdits(text, noEdits);

      expect(result.text).toBe(text);
      expect(result.instCount).toBe(2);
    });
  });

  describe('positive cases', () => {
    it('appends impostor rows at the end of the inst section', () => {
      const result = applyTextEdits(ipl([[1, 'a', -1]]), {
        appends: [impostor(9, 'lodx')],
        repoints: new Map(),
      });
      const out = parseIpl(result.text);

      expect(out).toHaveLength(2);
      expect(out[1]).toMatchObject({ id: 9, lod: -1, modelName: 'lodx', position: [1, 2, 3] });
      expect(result.instCount).toBe(1);
    });

    it('repoints an existing row id + model, keeping its transform and lod', () => {
      const result = applyTextEdits(
        ipl([
          [1, 'stocklod', -1],
          [2, 'b', -1],
        ]),
        { appends: [], repoints: new Map([[0, { id: 9, model: 'lodx' }]]) },
      );
      const out = parseIpl(result.text);

      expect(out[0]).toMatchObject({ id: 9, modelName: 'lodx' });
      expect(out[1].modelName).toBe('b');
    });

    it('numbers appends after the existing rows (the index the caller links to)', () => {
      const result = applyTextEdits(ipl([[1, 'a', -1]]), {
        appends: [impostor(9, 'lodx'), impostor(10, 'lody')],
        repoints: new Map(),
      });

      // base instCount 1 → appends land at indices 1 and 2
      expect(parseIpl(result.text).map((i) => i.id)).toEqual([1, 9, 10]);
    });

    it('preserves CRLF endings', () => {
      const result = applyTextEdits(ipl([[1, 'a', -1]]), { appends: [impostor(9, 'lodx')], repoints: new Map() });

      expect(result.text).toContain('\r\n');
      expect(result.text).not.toMatch(/[^\r]\n/);
    });
  });
});
