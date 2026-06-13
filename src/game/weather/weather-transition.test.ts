import { describe, expect, it } from 'vitest';

import { WeatherTransition } from './weather-transition';

describe('WeatherTransition', () => {
  describe('negative cases', () => {
    it('is settled on the initial weather (t=1, from=to)', () => {
      const transition = new WeatherTransition(4);
      expect(transition.target).toBe(4);
      expect(transition.blend()).toEqual({ from: 4, t: 1, to: 4 });
    });

    it('ignores beginning a transition to the weather it is already heading to', () => {
      const transition = new WeatherTransition(0);
      transition.begin(2, 10);
      transition.begin(2, 10); // no-op
      transition.tick(5); // halfway
      expect(transition.blend().t).toBeCloseTo(0.5, 5); // smoothstep(0.5) = 0.5
    });

    it('does nothing when ticking a settled transition', () => {
      const transition = new WeatherTransition(1);
      transition.tick(100);
      expect(transition.blend()).toEqual({ from: 1, t: 1, to: 1 });
    });
  });

  describe('positive cases', () => {
    it('eases from→to with a smoothstep factor over the duration', () => {
      const transition = new WeatherTransition(0);
      transition.begin(5, 10);
      expect(transition.target).toBe(5);
      transition.tick(2.5); // x = 0.25 → smoothstep = 0.15625
      const blend = transition.blend();
      expect(blend.from).toBe(0);
      expect(blend.to).toBe(5);
      expect(blend.t).toBeCloseTo(0.15625, 5);
    });

    it('settles exactly onto the target once the duration elapses', () => {
      const transition = new WeatherTransition(0);
      transition.begin(7, 4);
      transition.tick(4);
      expect(transition.blend()).toEqual({ from: 7, t: 1, to: 7 });
    });

    it('jumps instantly when the duration is zero or negative', () => {
      const transition = new WeatherTransition(0);
      transition.begin(3, 0);
      expect(transition.blend()).toEqual({ from: 3, t: 1, to: 3 });
    });

    it('retargets mid-blend from the nearest endpoint (past halfway snaps from the old target)', () => {
      const transition = new WeatherTransition(0); // 0 → 5
      transition.begin(5, 10);
      transition.tick(6); // past halfway (0.6) — closer to 5
      transition.begin(8, 10); // retarget: from should snap to the old target (5)
      const blend = transition.blend();
      expect(blend.from).toBe(5);
      expect(blend.to).toBe(8);
      expect(blend.t).toBe(0); // restarted
    });
  });
});
