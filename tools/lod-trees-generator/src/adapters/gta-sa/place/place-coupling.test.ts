import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { linkBinaryLods } from './ipl-binary-link';
import { applyTextEdits } from './ipl-text-append';

const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/**
 * The end-to-end Stage-2 attach on real coupled files: append an impostor LOD at a stream HD's transform, link
 * the HD's binary `lod` to it, and confirm the binary `lod` resolves to that impostor in the edited text IPL.
 */
describe('place attach (lae text + lae_stream0 binary)', () => {
  describe('positive cases', () => {
    it('links a stream HD to a freshly appended impostor at its own position', () => {
      const textRaw = readFileSync('tests/original/ipl_text/lae.ipl', 'utf8');
      const stream = new Uint8Array(readFileSync('tests/original/ipl_binary/lae_stream0.ipl'));
      const hd = parseBinaryIpl(ab(stream))[0];
      const newIndex = parseIpl(textRaw).length;
      const impostorId = 18631;

      const text = applyTextEdits(textRaw, {
        appends: [{ id: impostorId, interior: hd.interior, model: 'lodtest', pos: hd.position, rot: hd.rotation }],
        repoints: new Map(),
        setLods: new Map(),
      }).text;
      const linked = parseBinaryIpl(ab(linkBinaryLods(stream, new Map([[0, newIndex]]))));
      const out = parseIpl(text);

      expect(linked[0].lod).toBe(newIndex);
      expect(out[newIndex]).toMatchObject({ id: impostorId, lod: -1, modelName: 'lodtest' });
      expect(out[newIndex].position[0]).toBeCloseTo(hd.position[0], 2);
      expect(out[newIndex].position[1]).toBeCloseTo(hd.position[1], 2);
      // appending must not disturb the existing instances the other binary lods point into
      expect(out.length).toBe(newIndex + 1);
    });
  });
});
