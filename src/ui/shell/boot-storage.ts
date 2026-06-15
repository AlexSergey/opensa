export interface BootFlags {
  disclaimerAccepted: boolean;
  introSeen: boolean;
}

/**
 * localStorage-backed boot flags (plan 051): whether the intro animation has played (skip it on repeat
 * visits) and whether the disclaimer was accepted. All access is guarded so SSR/blocked-storage degrades
 * to "nothing remembered" rather than throwing.
 */
type ReadWriteStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DISCLAIMER_KEY = 'opensa.disclaimer.v1';
const INTRO_KEY = 'opensa.intro.v1';

/** Read the persisted boot flags (defaults to all-false when storage is unavailable). */
export function readBootFlags(storage: null | ReadWriteStorage = defaultStorage()): BootFlags {
  return {
    disclaimerAccepted: storage?.getItem(DISCLAIMER_KEY) === '1',
    introSeen: storage?.getItem(INTRO_KEY) === '1',
  };
}

/** Persist that the disclaimer was accepted. */
export function rememberDisclaimerAccepted(storage: null | ReadWriteStorage = defaultStorage()): void {
  storage?.setItem(DISCLAIMER_KEY, '1');
}

/** Persist that the intro animation has played. */
export function rememberIntroSeen(storage: null | ReadWriteStorage = defaultStorage()): void {
  storage?.setItem(INTRO_KEY, '1');
}

/** The real localStorage when present, else null (private mode / SSR / blocked). */
function defaultStorage(): null | ReadWriteStorage {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
