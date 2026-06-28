import { parsePedDefs } from '@opensa/renderware/parsers/text/ped-defs.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stripGta3Img, stripPeds } from './strip';

const PEDS = [
  '# stock peds',
  'peds',
  '7, male01, male01, CIVMALE',
  '9, bfori, bfori, CIVFEMALE',
  '14, bmori, bmori, CIVMALE',
  'end',
  'objs',
  '1, prop, proptxd, 100, 0',
  'end',
].join('\n');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ped-strip-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('stripPeds', () => {
  describe('positive cases', () => {
    it('keeps only the kept models in the peds section', () => {
      const out = stripPeds(PEDS, new Set(['bfori']));
      const defs = parsePedDefs(out);

      expect([...defs.keys()]).toEqual(['bfori']);
    });

    it('preserves comments, section markers, and unrelated sections', () => {
      const out = stripPeds(PEDS, new Set(['bfori'])).split('\n');

      expect(out).toContain('# stock peds');
      expect(out).toContain('peds');
      expect(out).toContain('end');
      expect(out).toContain('objs');
      expect(out).toContain('1, prop, proptxd, 100, 0'); // a comma line outside `peds` is untouched
    });

    it('preserves CRLF line endings', () => {
      const out = stripPeds(PEDS.replace(/\n/g, '\r\n'), new Set(['bfori']));

      expect(out.includes('\r\n')).toBe(true);
      expect(out.includes('\n\n')).toBe(false);
    });
  });
});

describe('stripGta3Img', () => {
  describe('negative cases', () => {
    it('does nothing when the img file does not exist', () => {
      expect(() => stripGta3Img(join(dir, 'missing.img'), new Set(['x.dff']))).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('deletes every entry that is not in the keep-set', () => {
      const imgPath = join(dir, 'gta3.img');
      const img = createImg();
      img.set('bfori.dff', Uint8Array.of(1));
      img.set('bfori.txd', Uint8Array.of(2));
      img.set('other.dff', Uint8Array.of(3));
      writeFileSync(imgPath, img.build());

      stripGta3Img(imgPath, new Set(['bfori.dff', 'bfori.txd']));

      const result = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(
        result
          .names()
          .map((n) => n.toLowerCase())
          .sort(),
      ).toEqual(['bfori.dff', 'bfori.txd']);
    });
  });
});
