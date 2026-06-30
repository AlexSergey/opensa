import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { disableProcObj, stripProcObj } from './procobj-strip';

const keepNone = (): boolean => false;

const keepAll = (): boolean => true;
const modelsOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => line.trim().split(/\s+/)[1]);

describe('stripProcObj', () => {
  describe('negative cases', () => {
    it('returns the text unchanged when keep accepts every model', () => {
      const text = 'P_SAND\tcacti\t16.0\r\nP_GRASS\tbush\t10.0\r\n';
      const result = stripProcObj(text, keepAll);

      expect(result.removed).toBe(0);
      expect(result.text).toBe(text);
    });

    it('never drops comment or blank lines', () => {
      const text = '# header\r\n\r\nP_SAND\ttree\t16.0\r\n';
      const result = stripProcObj(text, () => false);

      expect(result.text).toContain('# header');
      expect(result.text.split('\r\n').filter((l) => l === '')).not.toHaveLength(0);
    });

    it('never strips underwater species (seaweed/starfish/searock), even when keep rejects everything', () => {
      const text = 'P_UNDERWATERBARREN\tseaweed\t21.0\r\nP_UNDERWATERBARREN\tsearock03\t81.0\r\nP_SAND\ttree\t16.0\r\n';
      const result = stripProcObj(text, keepNone);

      expect(result.removed).toBe(1); // only `tree`
      expect(modelsOf(result.text)).toEqual(['seaweed', 'searock03']);
    });
  });

  describe('positive cases', () => {
    it('removes only the scatter rules whose model fails keep', () => {
      const text = 'P_SAND\ttree\t16.0\r\nP_GRASS\tbush\t10.0\r\nP_SAND\ttree\t12.0\r\n';
      const result = stripProcObj(text, (model) => model !== 'tree');

      expect(result.removed).toBe(2);
      expect(modelsOf(result.text)).toEqual(['bush']);
    });

    it('preserves CRLF line endings', () => {
      const result = stripProcObj('P_SAND\ttree\t16.0\r\nP_GRASS\tbush\t10.0\r\n', (model) => model !== 'tree');

      expect(result.text).toContain('\r\n');
      expect(result.text).not.toMatch(/[^\r]\n/);
    });

    it('drops a known plant from the real procobj.dat and leaves the rest intact', () => {
      const text = readFileSync('tests/original/data/procobj.dat', 'utf8');
      const result = stripProcObj(text, (model) => model.toLowerCase() !== 'sjmcacti2');

      expect(result.removed).toBeGreaterThan(0);
      expect(modelsOf(result.text)).not.toContain('sjmcacti2');
      expect(modelsOf(result.text)).toContain('sand_combush03');
    });
  });
});

/** A full 14-column procobj.dat data row (`surface model spacing …`). */
const row = (surface: string, model: string, spacing: string): string =>
  [surface, model, spacing, '60', '0', '360', '1', '1', '1', '1', '0', '0', '0', '0'].join('\t');

describe('disableProcObj', () => {
  describe('negative cases', () => {
    it('returns an empty fragment when no model is converted', () => {
      expect(disableProcObj(`# header\n${row('p_sand', 'cactus', '16')}\n`, () => false)).toBe('');
    });

    it('skips comments, underwater species and non-converted rows', () => {
      const text = ['# header', row('p_underwaterbarren', 'seaweed', '21'), row('p_grass', 'fern', '10')].join('\n');

      expect(disableProcObj(text, (m) => m === 'seaweed' || m === 'fern')).not.toContain('seaweed');
    });
  });

  describe('positive cases', () => {
    it('emits only the converted (surface,model) rows with spacing overflowed to disable scatter', () => {
      const text = [row('p_sand', 'cactus', '16'), row('p_dirt', 'cactus', '20'), row('p_grass', 'fern', '10')].join(
        '\n',
      );
      const out = disableProcObj(text, (m) => m === 'cactus');
      const rows = out.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));

      expect(rows).toHaveLength(2); // both cactus surfaces, not fern
      expect(rows.every((r) => Number(r.split(/\s+/)[2]) === Infinity)).toBe(true); // spacing → ∞ ⇒ 0 scatter
      expect(rows.map((r) => r.split(/\s+/).slice(0, 2).join(' ')).sort()).toEqual(['p_dirt cactus', 'p_sand cactus']);
    });
  });
});
