import { describe, expect, it } from 'vitest';

import { initRapier } from './rapier';

describe('initRapier', () => {
  describe('positive cases', () => {
    it('resolves the Rapier module with a World constructor', async () => {
      const rapier = await initRapier();
      expect(typeof rapier.World).toBe('function');
    });

    it('returns the same cached init promise on repeat calls', () => {
      expect(initRapier()).toBe(initRapier());
    });
  });
});
