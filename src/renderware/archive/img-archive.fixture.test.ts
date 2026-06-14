import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDff } from '../parsers/binary/dff';
import { openArchive } from './img-archive';

// A real stock-format (VER2) archive holding one vehicle, built from tests/vehicles/admiral.dff by
// buildVer2Buffer (this module). Exercises the on-disk bytes end-to-end: open → find → parse.
const fixturePath = join(process.cwd(), 'tests', 'img', 'admiral.img');
const dffPath = join(process.cwd(), 'tests', 'vehicles', 'admiral.dff');
const fixtureExists = existsSync(fixturePath) && existsSync(dffPath);
const archive = fixtureExists ? openArchive(new Uint8Array(readFileSync(fixturePath))) : null;

describe.skipIf(!fixtureExists)('img-archive admiral.img fixture (VER2)', () => {
  describe('negative cases', () => {
    it('returns null for a file not in the archive', () => {
      expect(archive!.get('missing.dff')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('lists the packed model (lowercased)', () => {
      expect(archive!.names).toContain('admiral.dff');
    });

    it('returns the model bytes (the source dff is the sector-padded slice prefix)', () => {
      const source = new Uint8Array(readFileSync(dffPath));
      const bytes = new Uint8Array(archive!.get('ADMIRAL.dff')!); // case-insensitive lookup
      expect(bytes.subarray(0, source.length)).toEqual(source);
    });

    it('parses the looked-up model into a clump', () => {
      const clump = parseDff(archive!.get('admiral.dff')!);
      expect(clump.geometries.length).toBeGreaterThan(0);
      expect(clump.atomics.length).toBeGreaterThan(0);
      expect(clump.geometries[0].positions.length).toBeGreaterThan(0);
    });
  });
});
