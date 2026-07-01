import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Archives } from './io';

import { applyTextEdits, fillMissingLods, linkBinaryLods } from './fill-holes';

const IPL = ['inst', '100, hd, 0, 1, 2, 3, 0, 0, 0, 1, -1', '# c', '200, other, 0, 5, 5, 5, 0, 0, 0, 1, -1', 'end'];

/** A minimal "bnry" IPL: `count` INST records of 40 bytes at offset 76, each with a `lod` at +36. */
function binaryIpl(lods: number[]): Uint8Array {
  const bytes = new Uint8Array(76 + lods.length * 40);
  const view = new DataView(bytes.buffer);
  for (const [i, ch] of [...'bnry'].entries()) {
    view.setUint8(i, ch.charCodeAt(0));
  }
  view.setUint32(0x04, lods.length, true);
  view.setUint32(0x1c, 76, true);
  lods.forEach((lod, i) => view.setInt32(76 + i * 40 + 36, lod, true));

  return bytes;
}

function lodAt(bytes: Uint8Array, record: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(76 + record * 40 + 36, true);
}

describe('applyTextEdits', () => {
  describe('negative cases', () => {
    it('leaves the text unchanged with no edits', () => {
      expect(applyTextEdits(IPL.join('\n'), [], new Map())).toBe(IPL.join('\n'));
    });
  });

  describe('positive cases', () => {
    it('appends rows before end and sets a data row lod (skipping the comment row)', () => {
      const out = applyTextEdits(IPL.join('\n'), ['18631, salodh0000, 0, 1, 2, 3, 0, 0, 0, 1, -1'], new Map([[0, 2]]));
      const lines = out.split('\n');

      expect(lines).toContain('18631, salodh0000, 0, 1, 2, 3, 0, 0, 0, 1, -1');
      expect(lines.indexOf('18631, salodh0000, 0, 1, 2, 3, 0, 0, 0, 1, -1')).toBe(lines.indexOf('end') - 1);
      expect(lines[1]).toBe('100, hd, 0, 1, 2, 3, 0, 0, 0, 1, 2'); // HD row 0 lod -1 → 2
      expect(lines).toContain('# c'); // comment preserved, not counted as a data row
      expect(lines[3]).toBe('200, other, 0, 5, 5, 5, 0, 0, 0, 1, -1'); // row 1 untouched
    });
  });
});

describe('linkBinaryLods', () => {
  describe('negative cases', () => {
    it('returns a copy with unlinked records untouched', () => {
      const out = linkBinaryLods(binaryIpl([-1, -1]), new Map([[0, 5]]));
      expect(lodAt(out, 1)).toBe(-1);
    });
  });

  describe('positive cases', () => {
    it('sets each linked record lod to its companion-text index', () => {
      const out = linkBinaryLods(
        binaryIpl([-1, -1, -1]),
        new Map([
          [0, 5],
          [2, 9],
        ]),
      );
      expect([lodAt(out, 0), lodAt(out, 1), lodAt(out, 2)]).toEqual([5, -1, 9]);
    });
  });
});

/** Write a synthetic drop-in `data/` dir (one IDE + text IPL + gta.dat + maps/) and run the fill against it. */
function runFill(models: string[]): {
  dir: string;
  img: Map<string, Uint8Array>;
  result: ReturnType<typeof fillMissingLods>;
} {
  const dir = mkdtempSync(join(tmpdir(), 'salod-fill-'));
  mkdirSync(join(dir, 'maps'));
  writeFileSync(join(dir, 'x.ide'), ['objs', '1, hd_a, txda, 300, 0', 'end'].join('\n'));
  writeFileSync(join(dir, 'x.ipl'), ['inst', '1, hd_a, 0, 5, 6, 7, 0, 0, 0, 1, -1', 'end'].join('\n'));
  writeFileSync(join(dir, 'gta.dat'), 'IDE DATA\\MAPS\\x.ide\nIPL DATA\\MAPS\\x.ipl\n');

  const img = new Map<string, Uint8Array>();
  const archives = {
    get: (name: string) => (name === 'hd_a.dff' ? new ArrayBuffer(4) : null),
    gta3: { get: () => null, names: [] },
  } as unknown as Archives;
  const result = fillMissingLods({
    archives,
    ensureTxd: () => 'salod0000',
    holeLodDraw: 1500,
    models: new Set(models),
    outDataDir: dir,
    setImg: (name, bytes) => img.set(name, bytes),
  });

  return { dir, img, result };
}

describe('fillMissingLods', () => {
  describe('negative cases', () => {
    it('skips a model with no IDE def / DFF (no LOD generated)', () => {
      const { result } = runFill(['absent']);
      expect(result).toEqual({ appended: 0, filled: 0, skipped: 1 });
    });
  });

  describe('positive cases', () => {
    it('generates a LOD id/IDE/instance + links the HD for a text-placed hole', () => {
      const { dir, img, result } = runFill(['hd_a']);

      expect(result).toEqual({ appended: 1, filled: 1, skipped: 0 });
      expect(img.has('salodh0000.dff')).toBe(true); // HD clone packed under the new LOD name

      const ide = readFileSync(join(dir, 'maps', 'salod-holes.ide'), 'utf8');
      expect(ide).toContain('2, salodh0000, salod0000, 1500, 0'); // new id (maxId 1 + 1), clone txd, high draw
      expect(readFileSync(join(dir, 'gta.dat'), 'utf8')).toContain('salod-holes.ide'); // registered

      const ipl = readFileSync(join(dir, 'x.ipl'), 'utf8').split('\n');
      expect(ipl).toContain('1, hd_a, 0, 5, 6, 7, 0, 0, 0, 1, 1'); // HD lod -1 → 1 (the appended index)
      expect(ipl).toContain('2, salodh0000, 0, 5, 6, 7, 0, 0, 0, 1, -1'); // leaf LOD at the HD's transform
    });
  });
});
