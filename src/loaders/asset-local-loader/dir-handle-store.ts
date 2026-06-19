/**
 * Remembers the user's picked game-install folder (plan 053, phase 2; gesture fix phase 5). A
 * `FileSystemDirectoryHandle` is structured-cloneable, so it is persisted in IndexedDB and restored on the next
 * visit — re-prompting only when it became invalid (folder deleted, or read permission revoked/never granted).
 *
 * **User-gesture rule:** `showDirectoryPicker` / `requestPermission` require a live user activation, which is
 * lost across a task-crossing `await` (IndexedDB events resolve on the task queue). So restoring the stored
 * handle ({@link restoreDir}) is done at boot, OUTSIDE any gesture; the gesture-bound step ({@link pickDir})
 * receives that already-loaded handle and makes the picker / permission request its FIRST async call.
 *
 * Both are dependency-injected so they're unit-testable without the browser APIs; {@link browserDirHandleDeps}
 * wires the real ones.
 */

const DB_NAME = 'opensa-loader';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'gameDir';
const READ: FileSystemHandlePermissionDescriptor = { mode: 'read' };

/** The pieces {@link restoreDir} / {@link pickDir} need — real implementations in {@link browserDirHandleDeps}. */
export interface DirHandleDeps {
  /** Forget the persisted handle (called when the stored one is stale). */
  clear: () => Promise<void>;
  /** Resolve to `true` if the folder is still readable (not deleted). Assumes permission was granted. */
  isAlive: (handle: FileSystemDirectoryHandle) => Promise<boolean>;
  /** Restore the persisted handle, or `null` if none. */
  load: () => Promise<FileSystemDirectoryHandle | null>;
  /** Prompt the user to pick a folder (must be the first await in a user gesture). */
  pick: () => Promise<FileSystemDirectoryHandle>;
  /** Current read-permission state, without prompting. */
  queryPermission: (handle: FileSystemDirectoryHandle) => Promise<PermissionState>;
  /** Request read permission (must be the first await in a user gesture). */
  requestPermission: (handle: FileSystemDirectoryHandle) => Promise<PermissionState>;
  /** Persist the handle for next time. */
  store: (handle: FileSystemDirectoryHandle) => Promise<void>;
}

/** A restored handle and whether it is immediately usable (already granted + alive) without a gesture. */
export interface RestoredDir {
  /** The stored handle (for a later gesture), or `null` if none is remembered. */
  handle: FileSystemDirectoryHandle | null;
  /** `true` when `handle` is already granted + alive — no prompt needed at all. */
  ready: boolean;
}

/** Production wiring of {@link DirHandleDeps} over IndexedDB + the File System Access API (browser-only). */
export function browserDirHandleDeps(): DirHandleDeps {
  return {
    clear: clearStoredDir,
    isAlive: isDirReadable,
    load: loadStoredDir,
    pick: () => window.showDirectoryPicker({ id: 'opensa-game', mode: 'read' }),
    queryPermission: (handle) => handle.queryPermission(READ),
    requestPermission: (handle) => handle.requestPermission(READ),
    store: storeDir,
  };
}

/** Forget the persisted handle. */
export async function clearStoredDir(): Promise<void> {
  const db = await openDb();
  try {
    await requestToPromise(tx(db).delete(HANDLE_KEY));
  } finally {
    db.close();
  }
}

/** Restore the persisted directory handle, or `null` if none / unavailable. */
export async function loadStoredDir(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  try {
    const value = await requestToPromise<unknown>(tx(db, 'readonly').get(HANDLE_KEY));

    return value instanceof FileSystemDirectoryHandle ? value : null;
  } finally {
    db.close();
  }
}

/**
 * Gesture-bound: turn the (already-loaded) `stored` handle into a usable one, prompting if needed. To keep the
 * user activation, the FIRST await is the permission request (stored handle) or the folder picker (none) — no
 * IndexedDB read happens before it. A stored handle that the user re-denies is forgotten and an error is thrown
 * (the next click then prompts for a fresh folder).
 */
export async function pickDir(
  deps: DirHandleDeps,
  stored: FileSystemDirectoryHandle | null,
): Promise<FileSystemDirectoryHandle> {
  if (stored) {
    if ((await deps.requestPermission(stored)) === 'granted' && (await deps.isAlive(stored))) {
      return stored;
    }
    await deps.clear();
    throw new Error('folder access was denied — click Play again to choose a folder');
  }

  const picked = await deps.pick();
  await deps.store(picked);

  return picked;
}

/** Boot-time (no gesture): load the stored handle and report whether it is already usable without prompting. */
export async function restoreDir(deps: DirHandleDeps): Promise<RestoredDir> {
  const handle = await deps.load();
  if (!handle) {
    return { handle: null, ready: false };
  }
  const ready = (await deps.queryPermission(handle)) === 'granted' && (await deps.isAlive(handle));

  return { handle, ready };
}

/** Persist the directory handle. */
export async function storeDir(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  try {
    await requestToPromise(tx(db).put(handle, HANDLE_KEY));
  } finally {
    db.close();
  }
}

/** A directory is "alive" if it still lists its entries (a deleted folder throws). */
async function isDirReadable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // One step of the async iterator is enough — an empty folder yields nothing (still alive).
    await handle.values().next();

    return true;
  } catch {
    return false;
  }
}

/** Open (creating on first use) the loader's IndexedDB. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

/** Promisify an `IDBRequest`. */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('indexedDB request failed'));
  });
}

/** The handle object store from a fresh transaction. */
function tx(db: IDBDatabase, mode: IDBTransactionMode = 'readwrite'): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}
