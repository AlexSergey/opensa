/**
 * Lazy VER2 `.img` reader (plan 053, phase 3). A stock GTA `gta3.img` is ~1 GB, far too big to buffer in the
 * browser — so this reads only the **directory** (header + 32 bytes/entry) up front, then slices each needed
 * entry's byte range straight from disk on demand. The VER2 directory parsing is shared with
 * `renderware/archive` (no duplicate format knowledge). Byte access goes through {@link ByteRangeSource} so the
 * reader is unit-testable over an in-memory buffer, with {@link fileHandleSource} wiring a real File handle.
 */
import { parseVer2Directory, ver2DirectoryLength, ver2EntryCount } from '../../renderware/archive';

/** A random-access byte source (a file on disk, or a buffer in tests). Ranges are `[start, end)`. */
export interface ByteRangeSource {
  /** Total byte length — clamps the last entry's whole-sector padding. */
  readonly size: number;
  slice(start: number, end: number): Promise<Uint8Array>;
}

/** A VER2 archive whose entries are read from disk on demand (directory held in memory). */
export interface LazyImgArchive {
  has(name: string): boolean;
  /** Lowercased entry names. */
  readonly names: string[];
  /** Read one entry's bytes (case-insensitive), or `null` if absent. */
  read(name: string): Promise<null | Uint8Array>;
}

/** A {@link ByteRangeSource} over a File System Access file handle (reads a fresh `File` snapshot). */
export async function fileHandleSource(handle: FileSystemFileHandle): Promise<ByteRangeSource> {
  const file = await handle.getFile();

  return {
    size: file.size,
    slice: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
  };
}

/** Open a VER2 archive lazily: read its directory now, slice entries later. Throws if not VER2. */
export async function openLazyVer2(source: ByteRangeSource): Promise<LazyImgArchive> {
  const header = await source.slice(0, 8);
  if (new TextDecoder().decode(header.subarray(0, 4)) !== 'VER2') {
    throw new Error('not a VER2 .img archive');
  }
  const files = parseVer2Directory(await source.slice(0, ver2DirectoryLength(ver2EntryCount(header))));

  return {
    has: (name) => files.has(name.toLowerCase()),
    names: [...files.keys()],
    read: async (name): Promise<null | Uint8Array> => {
      const entry = files.get(name.toLowerCase());
      if (!entry) {
        return null;
      }
      const start = entry[0];

      return source.slice(start, Math.min(start + entry[1], source.size)); // clamp last-file sector padding
    },
  };
}
