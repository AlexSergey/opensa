import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { trimTxd } from './txd-trim';

const TXD = join(process.cwd(), 'tests', 'original', 'models', 'effectsPC.txd');
const hasFixture = existsSync(TXD);

function ab(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function bytes(): Uint8Array {
  const buffer = readFileSync(TXD);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe.skipIf(!hasFixture)('trimTxd (real effectsPC.txd fixture)', () => {
  describe('negative cases', () => {
    it('returns the input unchanged when every texture is kept', () => {
      const original = bytes();
      const all = new Set(parseTxd(ab(original)).textures.map((t) => t.name.toLowerCase()));
      expect(trimTxd(original, all)).toBe(original); // same reference — no work done
    });

    it('returns the input unchanged for non-TXD bytes', () => {
      const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(trimTxd(junk, new Set(['x']))).toBe(junk);
    });
  });

  describe('positive cases', () => {
    it('keeps only the requested textures and fixes the count (kept ones byte-identical)', () => {
      const original = bytes();
      const before = parseTxd(ab(original)).textures;
      expect(before.length).toBeGreaterThan(2);
      const keep = new Set([before[0].name.toLowerCase(), before[1].name.toLowerCase()]);

      const trimmed = trimTxd(original, keep);
      const after = parseTxd(ab(trimmed));

      expect(after.textures.map((t) => t.name.toLowerCase()).sort()).toEqual([...keep].sort());
      expect(trimmed.byteLength).toBeLessThan(original.byteLength);
      // kept texture survives intact (same top-mip bytes) — verbatim copy, no re-encode
      const a = before.find((t) => t.name.toLowerCase() === before[0].name.toLowerCase())!;
      const b = after.textures.find((t) => t.name.toLowerCase() === before[0].name.toLowerCase())!;
      expect(b.mipmaps[0].data).toEqual(a.mipmaps[0].data);
    });
  });
});
