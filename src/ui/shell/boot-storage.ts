/**
 * localStorage-backed boot flags (plans 051 / 056): whether each game's disclaimer has been accepted, keyed
 * by game id so it is remembered per game. All access is guarded so SSR / blocked storage degrades to
 * "nothing remembered" rather than throwing.
 */
type ReadWriteStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DISCLAIMER_PREFIX = 'opensa.disclaimer.v2.';

/** Whether the disclaimer for `gameId` was accepted before. */
export function isDisclaimerAccepted(gameId: string, storage: null | ReadWriteStorage = defaultStorage()): boolean {
  return storage?.getItem(DISCLAIMER_PREFIX + gameId) === '1';
}

/** Persist that the disclaimer for `gameId` was accepted. */
export function rememberDisclaimerAccepted(gameId: string, storage: null | ReadWriteStorage = defaultStorage()): void {
  storage?.setItem(DISCLAIMER_PREFIX + gameId, '1');
}

/** The real localStorage when present, else null (private mode / SSR / blocked). */
function defaultStorage(): null | ReadWriteStorage {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
