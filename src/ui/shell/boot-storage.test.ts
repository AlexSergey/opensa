import { describe, expect, it } from 'vitest';

import { readBootFlags, rememberDisclaimerAccepted, rememberIntroSeen } from './boot-storage';

/** Minimal in-memory Storage stand-in. */
function fakeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();

  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}

describe('boot-storage', () => {
  describe('negative cases', () => {
    it('reads all-false from empty storage', () => {
      expect(readBootFlags(fakeStorage())).toEqual({ disclaimerAccepted: false, introSeen: false });
    });

    it('degrades to all-false when storage is unavailable', () => {
      expect(readBootFlags(null)).toEqual({ disclaimerAccepted: false, introSeen: false });
      expect(() => rememberIntroSeen(null)).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('persists and reads the intro + disclaimer flags', () => {
      const storage = fakeStorage();
      rememberIntroSeen(storage);
      rememberDisclaimerAccepted(storage);
      expect(readBootFlags(storage)).toEqual({ disclaimerAccepted: true, introSeen: true });
    });
  });
});
