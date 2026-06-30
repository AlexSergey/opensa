import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { buildVer2Buffer, openArchive } from '@opensa/renderware/archive/img-archive';

/**
 * An **editable** GTA IMG (VER2) archive: open, read, add-with-replace, delete, then rebuild a fresh `.img`.
 * Wraps the engine's read (`openArchive`) + write (`buildVer2Buffer`) primitives (read-only reuse) with the
 * mutation surface the offline tools need — map-optimizer (swap optimized entries) and opensa-lod-generator (emit
 * cell-LOD DFFs/atlas TXDs, strip old LODs). Edits are tracked lazily: untouched entries are read straight from
 * the source on rebuild, so opening a large archive is cheap. Entry names are case-insensitive (GTA convention).
 */
export interface EditableImg {
  /** Rebuild a VER2 `.img` buffer from the current entries (originals minus deletes, plus adds/replaces). */
  build(): Uint8Array;
  /** Remove an entry; returns false if it wasn't present. */
  delete(name: string): boolean;
  /** Entry bytes, or null if absent / deleted. */
  get(name: string): null | Uint8Array;
  /** Whether an entry is currently present. */
  has(name: string): boolean;
  /** Current entry names, in archive order (deletes removed, adds appended). */
  names(): string[];
  /** Add a new entry or replace an existing one. */
  set(name: string, data: Uint8Array): void;
}

/** A fresh, empty {@link EditableImg} to populate with `set` and `build` (e.g. a new LOD archive). */
export function createImg(): EditableImg {
  return openImg(buildVer2Buffer([]));
}

/** Wrap an already-opened engine archive as an {@link EditableImg} (no re-read of the source bytes). */
export function editArchive(archive: ImgArchive): EditableImg {
  const order = [...archive.names];
  const overrides = new Map<string, Uint8Array>();
  const deleted = new Set<string>();
  const key = (name: string): string => name.toLowerCase();
  const readOriginal = (name: string): null | Uint8Array => {
    const buffer = archive.get(name);

    return buffer ? new Uint8Array(buffer) : null;
  };

  const img: EditableImg = {
    build(): Uint8Array {
      return buildVer2Buffer(img.names().map((name) => ({ data: img.get(name) ?? new Uint8Array(0), name })));
    },
    delete(name: string): boolean {
      if (!img.has(name)) {
        return false;
      }
      deleted.add(key(name));
      overrides.delete(key(name));

      return true;
    },
    get(name: string): null | Uint8Array {
      if (deleted.has(key(name))) {
        return null;
      }

      return overrides.get(key(name)) ?? readOriginal(name);
    },
    has(name: string): boolean {
      return img.get(name) !== null;
    },
    names(): string[] {
      return order.filter((name) => !deleted.has(key(name)));
    },
    set(name: string, data: Uint8Array): void {
      deleted.delete(key(name));
      if (!order.some((existing) => key(existing) === key(name))) {
        order.push(name);
      }
      overrides.set(key(name), data);
    },
  };

  return img;
}

/** Open IMG bytes as an {@link EditableImg}. */
export function openImg(bytes: Uint8Array): EditableImg {
  return editArchive(openArchive(bytes));
}
