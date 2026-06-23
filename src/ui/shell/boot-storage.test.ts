import { describe, expect, it } from 'vitest';

import { isDisclaimerAccepted, rememberDisclaimerAccepted } from './boot-storage';

/** Minimal in-memory Storage stand-in. */
function fakeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();

  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}

describe('boot-storage', () => {
  describe('negative cases', () => {
    it('reports not-accepted from empty storage', () => {
      expect(isDisclaimerAccepted('gostown', fakeStorage())).toBe(false);
    });

    it('degrades to not-accepted / no-op when storage is unavailable', () => {
      expect(isDisclaimerAccepted('gostown', null)).toBe(false);
      expect(() => rememberDisclaimerAccepted('gostown', null)).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('remembers acceptance independently per game', () => {
      const storage = fakeStorage();
      rememberDisclaimerAccepted('gostown', storage);
      expect(isDisclaimerAccepted('gostown', storage)).toBe(true);
      expect(isDisclaimerAccepted('original', storage)).toBe(false);
    });
  });
});
