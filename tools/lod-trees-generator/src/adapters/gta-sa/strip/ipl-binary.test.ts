import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { stripBinaryIpl } from './ipl-binary';
import { stripTextIpl } from './ipl-text';

const HEADER_SIZE = 76;
const INST_SIZE = 40;
const SECTION_FIELD = 0x3c; // a header offset field past the INST block — must shift when instances are dropped.

/** A minimal valid "bnry" IPL: header + `inst` records (only id/lod set), an optional trailing section. */
function binaryIpl(insts: readonly { id: number; lod: number }[], tail: Uint8Array = new Uint8Array(0)): Uint8Array {
  const instBytes = insts.length * INST_SIZE;
  const bytes = new Uint8Array(HEADER_SIZE + instBytes + tail.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x62, 0x6e, 0x72, 0x79]); // "bnry"
  view.setUint32(0x04, insts.length, true); // numInst
  view.setUint32(0x1c, HEADER_SIZE, true); // instOffset
  view.setUint32(SECTION_FIELD, HEADER_SIZE + instBytes, true); // trailing section starts after the INST block
  insts.forEach((inst, i) => {
    const at = HEADER_SIZE + i * INST_SIZE;
    view.setUint32(at + 28, inst.id, true);
    view.setInt32(at + 36, inst.lod, true);
  });
  bytes.set(tail, HEADER_SIZE + instBytes);

  return bytes;
}

const keepAll = (): boolean => true;
const identity = (n: number): Int32Array => Int32Array.from({ length: n }, (_v, i) => i);
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe('stripBinaryIpl', () => {
  describe('negative cases', () => {
    it('reports no change when keep accepts every instance and the text map is null', () => {
      const buffer = binaryIpl([
        { id: 1, lod: -1 },
        { id: 2, lod: -1 },
      ]);
      const result = stripBinaryIpl(buffer, keepAll, null);

      expect(result.changed).toBe(false);
      expect(result.removed).toBe(0);
      expect(result.bytes).toBe(buffer);
    });

    it('reports no change when an identity text map leaves every lod untouched', () => {
      const result = stripBinaryIpl(binaryIpl([{ id: 1, lod: 0 }]), keepAll, identity(4));

      expect(result.changed).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('drops instances failing keep and updates the numInst header', () => {
      const result = stripBinaryIpl(
        binaryIpl([
          { id: 1, lod: -1 },
          { id: 99, lod: -1 },
          { id: 2, lod: -1 },
        ]),
        (id) => id !== 99,
        null,
      );
      const out = parseBinaryIpl(ab(result.bytes));

      expect(result.removed).toBe(1);
      expect(out.map((i) => i.id)).toEqual([1, 2]);
    });

    it('remaps a surviving lod through the companion text map', () => {
      // The text IPL lost two rows before index 5, so the text target moved from 5 to 3.
      const textMap = Int32Array.of(0, 1, 2, -1, -1, 3);
      const result = stripBinaryIpl(binaryIpl([{ id: 1, lod: 5 }]), keepAll, textMap);

      expect(parseBinaryIpl(ab(result.bytes))[0].lod).toBe(3);
      expect(result.changed).toBe(true);
    });

    it('sets lod to -1 when the text map dropped the target', () => {
      const result = stripBinaryIpl(binaryIpl([{ id: 1, lod: 2 }]), keepAll, Int32Array.of(0, 1, -1));

      expect(parseBinaryIpl(ab(result.bytes))[0].lod).toBe(-1);
    });

    it('leaves lod untouched when there is no companion text map', () => {
      const result = stripBinaryIpl(
        binaryIpl([
          { id: 1, lod: 7 },
          { id: 99, lod: -1 },
        ]),
        (id) => id !== 99,
        null,
      );

      expect(parseBinaryIpl(ab(result.bytes))[0].lod).toBe(7);
    });

    it('shifts post-INST section offsets and preserves the trailing bytes', () => {
      const tail = Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd);
      const result = stripBinaryIpl(
        binaryIpl(
          [
            { id: 99, lod: -1 },
            { id: 1, lod: -1 },
            { id: 99, lod: -1 },
          ],
          tail,
        ),
        (id) => id !== 99,
        null,
      );
      const view = new DataView(ab(result.bytes));

      // one survivor remains → the trailing section starts right after that single INST record
      expect(view.getUint32(SECTION_FIELD, true)).toBe(HEADER_SIZE + INST_SIZE);
      expect(result.bytes.slice(-4)).toEqual(tail);
    });

    it('keeps the binary-to-text LOD pairing intact across a real coupled lae strip', () => {
      const textRaw = readFileSync('tests/original/ipl_text/lae.ipl', 'utf8');
      const origText = parseIpl(textRaw);
      const stripped = stripTextIpl(textRaw, (_id, name) => name.toLowerCase() !== 'laeroad39');
      const { map } = stripped;
      const newText = parseIpl(stripped.text);

      const stream = new Uint8Array(readFileSync('tests/original/ipl_binary/lae_stream0.ipl'));
      const orig = parseBinaryIpl(ab(stream));
      const out = parseBinaryIpl(ab(stripBinaryIpl(stream, keepAll, map).bytes));

      const intact = orig.every((inst, idx) => {
        if (inst.lod < 0) {
          return out[idx].lod < 0;
        }
        const wasModel = inst.lod < origText.length ? origText[inst.lod].modelName : null;
        const nowModel = out[idx].lod >= 0 && out[idx].lod < newText.length ? newText[out[idx].lod].modelName : null;

        return wasModel === nowModel;
      });
      expect(intact).toBe(true);
    });

    it('drops tree HD instances from the real countrye_stream1 by id', () => {
      const stream = new Uint8Array(readFileSync('tests/original/ipl_binary/countrye_stream1.ipl'));
      const before = parseBinaryIpl(ab(stream)).length;
      const firstId = parseBinaryIpl(ab(stream))[0].id;
      const result = stripBinaryIpl(stream, (id) => id !== firstId, null);

      expect(result.removed).toBeGreaterThan(0);
      expect(parseBinaryIpl(ab(result.bytes)).length).toBe(before - result.removed);
    });
  });
});
