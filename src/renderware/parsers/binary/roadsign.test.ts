import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { toArrayBuffer } from '../../test-utils';
import { parseDff } from './dff';

// Real 2dfx ROADSIGN case (plan 042 item 5): a Vegas junction road model carrying 4 sign plates
// with baked text — survey values from scripts/find-2dfx.ts on this exact file.
const SIGN_DFF = 'tests/custom/proper-fixes-models/vegasnroad19.dff';
// Survey reference: flags 0x0002 → 2 lines × 16 chars, white; plate 5.6×2.7.
const LIGHTS_ONLY_DFF = 'tests/custom/proper-fixes-models/trafficlight1.dff';

function load(path: string): ReturnType<typeof parseDff> {
  return parseDff(toArrayBuffer(new Uint8Array(readFileSync(path))));
}

describe('2dfx ROADSIGN parsing', () => {
  describe('negative cases', () => {
    it('leaves light-only models without a roadsigns field', () => {
      const clump = load(LIGHTS_ONLY_DFF);
      expect(clump.geometries.length).toBeGreaterThan(0);
      expect(clump.geometries.every((geometry) => geometry.roadsigns === undefined)).toBe(true);
      // The same 2dfx walk still yields the lights (regression for the corona path).
      expect(clump.geometries.some((geometry) => geometry.lights.length > 0)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('parses the four Vegas junction plates with the survey-verified fields', () => {
      const clump = load(SIGN_DFF);
      const roadsigns = clump.geometries.flatMap((geometry) => geometry.roadsigns ?? []);
      expect(roadsigns).toHaveLength(4);
      for (const sign of roadsigns) {
        expect(sign.plateSize[0]).toBeCloseTo(5.6, 1);
        expect(sign.plateSize[1]).toBeCloseTo(2.7, 1);
        expect(sign.charsPerLine).toBe(16);
        expect(sign.colour).toBe(0); // white
        expect(Math.abs(sign.rotation[1])).toBeCloseTo(90, 0);
      }
      const strip = roadsigns.find((sign) => sign.lines[0].startsWith('#_THE_STRIP'));
      expect(strip).toBeDefined();
      expect(strip?.lines).toHaveLength(2); // flags 0x0002 → 2 lines
      expect(strip?.lines[1].startsWith('#_AIRPORT_}')).toBe(true); // '}' = airport glyph
    });

    it('parses the desert freeway signs from se_bit_17 (regression: signs missing in-game)', () => {
      // 4 roadsign entries verified by the byte scan: Fort Carson, FREEWAY ENTRANCE,
      // LAS VENTURAS, WELCOME TO BONE COUNTY — at (390–427, 620–766).
      const clump = load('tests/custom/proper-fixes-models/se_bit_17.dff');
      const roadsigns = clump.geometries.flatMap((geometry) => geometry.roadsigns ?? []);
      expect(roadsigns).toHaveLength(4);
      const bone = roadsigns.find((sign) => sign.lines[0].startsWith('WELCOME'));
      expect(bone).toBeDefined();
      expect(bone?.lines[1].startsWith('BONE_COUNTY')).toBe(true);
      expect(bone?.position[0]).toBeCloseTo(426.9, 1);
      expect(bone?.position[1]).toBeCloseTo(621.1, 1);
    });

    it('decodes 3-line plates from the flags (0x0003 → 3 lines)', () => {
      const clump = load(SIGN_DFF);
      const roadsigns = clump.geometries.flatMap((geometry) => geometry.roadsigns ?? []);
      const threeLiner = roadsigns.find((sign) => sign.lines[0].startsWith('^_Rockshore'));
      expect(threeLiner).toBeDefined();
      expect(threeLiner?.lines).toHaveLength(3);
      expect(threeLiner?.lines[1].startsWith('^_Blackfield')).toBe(true);
      expect(threeLiner?.lines[2].startsWith('^_Randolph')).toBe(true);
    });
  });
});
