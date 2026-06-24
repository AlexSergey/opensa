import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseDff } from '../../../../src/renderware/parsers/binary/dff';
import { toArrayBuffer } from '../../../../src/renderware/test-utils';
import { copyMaterialEffects } from './copy-effects';

// Real vehicle fixtures: infernus (env-map coefficient 1 everywhere — overdone), admiral, and the anti-rip
// locked walton (well-tuned coefficient 0.5) read via the engine parser (regenerate with `npm run test:fixtures`).
const INFERNUS = 'tests/original/dff/vehicle/infernus.dff';
const ADMIRAL = 'tests/original/dff/vehicle/admiral.dff';
const WALTON = 'tests/custom/locked-models/walton.dff';

function load(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

/** Distinct env-map coefficients + count of reflective / total materials. */
function reflection(dff: Uint8Array): { coefficients: number[]; reflective: number; total: number } {
  const clump = parseDff(toArrayBuffer(dff));
  const coefficients = new Set<number>();
  let reflective = 0;
  let total = 0;
  for (const geometry of clump.geometries) {
    for (const material of geometry.materials) {
      total += 1;
      if (material.effects?.envMap) {
        reflective += 1;
        coefficients.add(Number(material.effects.envMap.coefficient.toFixed(3)));
      }
    }
  }

  return { coefficients: [...coefficients], reflective, total };
}

describe('copyMaterialEffects', () => {
  describe('negative cases', () => {
    it('throws when the prototype is not a readable vehicle DFF', () => {
      expect(() => copyMaterialEffects(load(INFERNUS), new Uint8Array(64))).toThrow();
    });
  });

  describe('positive cases', () => {
    it('retunes the target env-map coefficient to a locked, different-count reference (walton → infernus)', () => {
      const before = reflection(load(INFERNUS));
      expect(before.coefficients).toEqual([1]); // infernus is overdone (mirror-like)

      const after = reflection(copyMaterialEffects(load(INFERNUS), load(WALTON)));
      expect(after.coefficients).toEqual([0.5]); // retuned to walton's tasteful level
      expect(after.reflective).toBe(before.reflective); // no reflection added/removed
      expect(after.total).toBe(before.total);
    });

    it('matches across vehicles with different material counts without throwing (admiral → infernus)', () => {
      const after = reflection(copyMaterialEffects(load(INFERNUS), load(ADMIRAL)));
      expect(after.reflective).toBe(reflection(load(INFERNUS)).reflective);
    });
  });
});
