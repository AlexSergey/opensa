import { describe, expect, it } from 'vitest';

import { interiorId, isInterior } from './interior';

describe('interiorId', () => {
  it('returns the low byte of the area code (value & 0xFF)', () => {
    expect(interiorId(0)).toBe(0);
    expect(interiorId(1024)).toBe(0);
    expect(interiorId(1030)).toBe(6);
    expect(interiorId(269)).toBe(13);
    expect(interiorId(13)).toBe(13);
  });
});

describe('isInterior', () => {
  describe('negative cases', () => {
    it('treats exterior area codes (low byte 0) as not interior', () => {
      expect(isInterior(0)).toBe(false);
      expect(isInterior(256)).toBe(false);
      expect(isInterior(1024)).toBe(false);
      expect(isInterior(2048)).toBe(false);
    });

    it('treats the world render-level id 13 (and its high-bit variants) as not interior', () => {
      expect(isInterior(13)).toBe(false);
      expect(isInterior(269)).toBe(false); // 269 & 0xFF === 13
    });
  });

  describe('positive cases', () => {
    it('treats a genuine hidden-interior render level as interior', () => {
      expect(isInterior(1)).toBe(true);
      expect(isInterior(10)).toBe(true);
      expect(isInterior(18)).toBe(true);
    });
  });
});
