import { describe, expect, it, vi } from 'vitest';

import type { DirHandleDeps } from './dir-handle-store';

import { pickDir, restoreDir } from './dir-handle-store';

const STORED = { name: 'stored' } as unknown as FileSystemDirectoryHandle;
const PICKED = { name: 'picked' } as unknown as FileSystemDirectoryHandle;

/** Deps with sensible defaults (no stored handle; pick→PICKED; permission granted; alive); override per test. */
function deps(overrides: Partial<DirHandleDeps> = {}): DirHandleDeps {
  return {
    clear: vi.fn(() => Promise.resolve()),
    isAlive: vi.fn(() => Promise.resolve(true)),
    load: vi.fn(() => Promise.resolve(null)),
    pick: vi.fn(() => Promise.resolve(PICKED)),
    queryPermission: vi.fn(() => Promise.resolve<PermissionState>('granted')),
    requestPermission: vi.fn(() => Promise.resolve<PermissionState>('granted')),
    store: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('restoreDir', () => {
  describe('negative cases', () => {
    it('reports not-ready (and no handle) when nothing is remembered', async () => {
      await expect(restoreDir(deps())).resolves.toEqual({ handle: null, ready: false });
    });

    it('returns the stored handle but not ready when permission is no longer granted', async () => {
      const d = deps({
        load: vi.fn(() => Promise.resolve(STORED)),
        queryPermission: vi.fn(() => Promise.resolve<PermissionState>('prompt')),
      });

      await expect(restoreDir(d)).resolves.toEqual({ handle: STORED, ready: false });
    });

    it('returns the stored handle but not ready when the folder is gone', async () => {
      const d = deps({ isAlive: vi.fn(() => Promise.resolve(false)), load: vi.fn(() => Promise.resolve(STORED)) });

      await expect(restoreDir(d)).resolves.toEqual({ handle: STORED, ready: false });
    });
  });

  describe('positive cases', () => {
    it('is ready when the stored handle is granted and alive', async () => {
      const d = deps({ load: vi.fn(() => Promise.resolve(STORED)) });

      await expect(restoreDir(d)).resolves.toEqual({ handle: STORED, ready: true });
    });
  });
});

describe('pickDir', () => {
  describe('negative cases', () => {
    it('forgets the stored handle and throws when its permission is denied (no picker)', async () => {
      const d = deps({ requestPermission: vi.fn(() => Promise.resolve<PermissionState>('denied')) });

      await expect(pickDir(d, STORED)).rejects.toThrow(/denied/i);
      expect(d.clear).toHaveBeenCalledOnce();
      expect(d.pick).not.toHaveBeenCalled();
    });

    it('forgets the stored handle and throws when its folder is gone (no picker)', async () => {
      const d = deps({ isAlive: vi.fn(() => Promise.resolve(false)) });

      await expect(pickDir(d, STORED)).rejects.toThrow(/click play again/i);
      expect(d.clear).toHaveBeenCalledOnce();
    });
  });

  describe('positive cases', () => {
    it('reuses the stored handle (request-permission first) without prompting or re-storing', async () => {
      const d = deps();

      await expect(pickDir(d, STORED)).resolves.toBe(STORED);
      expect(d.requestPermission).toHaveBeenCalledWith(STORED);
      expect(d.pick).not.toHaveBeenCalled();
      expect(d.store).not.toHaveBeenCalled();
    });

    it('prompts for and stores a fresh folder when nothing is remembered', async () => {
      const d = deps();

      await expect(pickDir(d, null)).resolves.toBe(PICKED);
      expect(d.store).toHaveBeenCalledWith(PICKED);
    });
  });
});
