import { describe, expect, it } from 'vitest';

import { GameClock } from './game-clock';

describe('GameClock', () => {
  describe('negative cases', () => {
    it('does not advance with a non-positive multiplier', () => {
      const clock = new GameClock(360);
      expect(clock.advance(10, 0)).toBe(false);
      expect(clock.minutes).toBe(360);
    });

    it('reports no minute change for a sub-minute step', () => {
      const clock = new GameClock(0);
      expect(clock.advance(1.5, 3)).toBe(false); // 0.5 game-minutes at 3s/min
      expect(clock.minutes).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('accrues a whole game-minute and flags the change (3s per minute)', () => {
      const clock = new GameClock(360);
      expect(clock.advance(3, 3)).toBe(true);
      expect(clock.minutes).toBe(361);
    });

    it('wraps past midnight', () => {
      const clock = new GameClock(1439);
      expect(clock.advance(3, 3)).toBe(true);
      expect(clock.minutes).toBe(0);
    });

    it('jumps to a set time, wrapping out-of-range values', () => {
      const clock = new GameClock(0);
      clock.set(1290);
      expect(clock.minutes).toBe(1290);
      clock.set(-60);
      expect(clock.minutes).toBe(1380); // wrapped to 23:00
    });

    it('formats minutes as HH:MM (24h, wrapped)', () => {
      expect(GameClock.format(360)).toBe('06:00');
      expect(GameClock.format(1290)).toBe('21:30');
      expect(GameClock.format(1440)).toBe('00:00');
    });
  });
});
