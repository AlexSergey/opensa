import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { linkBinaryLods } from './ipl-binary-link';

const HEADER_SIZE = 76;
const INST_SIZE = 40;

/** A minimal valid "bnry" IPL: header + `inst` records (only id/lod set). */
function binaryIpl(insts: readonly { id: number; lod: number }[]): Uint8Array {
  const bytes = new Uint8Array(HEADER_SIZE + insts.length * INST_SIZE);
  const view = new DataView(bytes.buffer);
  bytes.set([0x62, 0x6e, 0x72, 0x79]); // "bnry"
  view.setUint32(0x04, insts.length, true);
  view.setUint32(0x1c, HEADER_SIZE, true);
  insts.forEach((inst, i) => {
    view.setUint32(HEADER_SIZE + i * INST_SIZE + 28, inst.id, true);
    view.setInt32(HEADER_SIZE + i * INST_SIZE + 36, inst.lod, true);
  });

  return bytes;
}

const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe('linkBinaryLods', () => {
  describe('negative cases', () => {
    it('returns the input untouched when there are no links', () => {
      const buffer = binaryIpl([{ id: 1, lod: -1 }]);
      const result = linkBinaryLods(buffer, new Map());

      expect(result).toBe(buffer);
    });
  });

  describe('positive cases', () => {
    it('sets the lod of the linked instances and leaves the rest', () => {
      const out = linkBinaryLods(
        binaryIpl([
          { id: 1, lod: -1 },
          { id: 2, lod: -1 },
          { id: 3, lod: -1 },
        ]),
        new Map([
          [0, 100],
          [2, 102],
        ]),
      );
      const insts = parseBinaryIpl(ab(out));

      expect(insts.map((i) => i.lod)).toEqual([100, -1, 102]);
    });

    it('does not change the file size and copies (does not mutate input)', () => {
      const buffer = binaryIpl([{ id: 1, lod: -1 }]);
      const out = linkBinaryLods(buffer, new Map([[0, 5]]));

      expect(out.length).toBe(buffer.length);
      expect(parseBinaryIpl(ab(buffer))[0].lod).toBe(-1); // input untouched
    });

    it('links a real countrye_stream1 instance to a text index', () => {
      const stream = new Uint8Array(readFileSync('tests/original/ipl_binary/countrye_stream1.ipl'));
      const out = linkBinaryLods(stream, new Map([[0, 9999]]));

      expect(parseBinaryIpl(ab(out))[0].lod).toBe(9999);
      expect(out.length).toBe(stream.length);
    });
  });
});
