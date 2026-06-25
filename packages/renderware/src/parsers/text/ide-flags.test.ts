import { describe, expect, it } from 'vitest';

import { hasIdeFlag, IdeFlag } from './ide-flags';

// Real dynamic.ide row: `1315, trafficlight1, dyntraffic, 80, 2130048` (the plan 004 case).
const TRAFFICLIGHT_FLAGS = 2130048;

describe('hasIdeFlag', () => {
  describe('negative cases', () => {
    it('reports nothing set for flags 0', () => {
      for (const flag of Object.values(IdeFlag)) {
        expect(hasIdeFlag({ flags: 0 }, flag)).toBe(false);
      }
    });

    it('does not report bits the real trafficlight def lacks', () => {
      expect(hasIdeFlag({ flags: TRAFFICLIGHT_FLAGS }, IdeFlag.DRAW_LAST)).toBe(false);
      expect(hasIdeFlag({ flags: TRAFFICLIGHT_FLAGS }, IdeFlag.ADDITIVE)).toBe(false);
      expect(hasIdeFlag({ flags: TRAFFICLIGHT_FLAGS }, IdeFlag.IS_TREE)).toBe(false);
      expect(hasIdeFlag({ flags: TRAFFICLIGHT_FLAGS }, IdeFlag.IS_PALM)).toBe(false);
      expect(hasIdeFlag({ flags: TRAFFICLIGHT_FLAGS }, IdeFlag.NO_ZBUFFER_WRITE)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('reports the backface-culling opt-out on the real trafficlight flags', () => {
      expect(hasIdeFlag({ flags: TRAFFICLIGHT_FLAGS }, IdeFlag.DISABLE_BACKFACE_CULLING)).toBe(true);
    });

    it('matches each named bit exactly', () => {
      for (const flag of Object.values(IdeFlag)) {
        expect(hasIdeFlag({ flags: flag }, flag)).toBe(true);
        expect(hasIdeFlag({ flags: ~flag >>> 0 }, flag)).toBe(false);
      }
    });
  });
});
