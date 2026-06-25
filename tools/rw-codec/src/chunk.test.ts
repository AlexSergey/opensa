import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readRw, writeRw } from './chunk';

// Committed mod fixtures (tests/custom is tracked); both are full skinned RenderWare clumps.
const FIXTURES = ['tests/custom/character/gostown-bmypol1.dff', 'tests/custom/character/Shrek.dff'];

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

describe('readRw / writeRw (chunk container)', () => {
  describe('positive cases', () => {
    for (const path of FIXTURES) {
      it(`round-trips ${path.split('/').pop()} byte-for-byte`, () => {
        const bytes = new Uint8Array(readFileSync(path));
        expect(equal(writeRw(readRw(bytes)), bytes)).toBe(true);
      });
    }
  });
});
