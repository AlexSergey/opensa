/**
 * Model archive reader. Two on-disk formats are supported, picked by magic:
 *
 * - **WIMG** — our own single-file pack (so the map is one download instead of ~10k
 *   requests). Layout: `"WIMG0001"` (8 bytes) | `directoryLength` (u32 LE) | directory
 *   (UTF-8 JSON `{ files: { <lowercased name>: [relativeOffset, size] } }`) | data.
 *
 * - **VER2** — the stock GTA San Andreas `.img` format, so the game's own archives (and
 *   mods that ship as `.img`, e.g. Proper Fixes) load directly. Layout: `"VER2"` (4 bytes)
 *   | `numEntries` (u32 LE) | `numEntries` × 32-byte directory entries | data. Each entry:
 *   `offset` (u32, in 2048-byte sectors) | `streamingSize` (u16, sectors) | `sizeInArchive`
 *   (u16, sectors, usually 0) | `name` (24 bytes, NUL-terminated). Directory + data share
 *   the one file.
 *
 * Both expose the same {@link ImgArchive}: O(1) lookup by lowercased filename.
 */
const WIMG_MAGIC = 'WIMG0001';

const HEADER_SIZE = 12;

/** GTA `.img` sector size — VER2 offsets/sizes are counted in these. */
const SECTOR = 2048;

export interface ImgArchive {
  /** Raw bytes of a file by name (case-insensitive), or null if absent. */
  get(name: string): ArrayBuffer | null;
  readonly names: string[];
}

/** Build an archive in memory (for tests / small sets; the packer streams instead). */
export function buildArchiveBuffer(entries: { data: Uint8Array; name: string }[]): Uint8Array {
  const files: Record<string, [number, number]> = {};
  let offset = 0;
  for (const entry of entries) {
    files[entry.name.toLowerCase()] = [offset, entry.data.length];
    offset += entry.data.length;
  }
  const directory = new TextEncoder().encode(JSON.stringify({ files }));

  const out = new Uint8Array(HEADER_SIZE + directory.length + offset);
  out.set(new TextEncoder().encode(WIMG_MAGIC), 0);
  new DataView(out.buffer).setUint32(8, directory.length, true);
  out.set(directory, HEADER_SIZE);
  let cursor = HEADER_SIZE + directory.length;
  for (const entry of entries) {
    out.set(entry.data, cursor);
    cursor += entry.data.length;
  }

  return out;
}

/**
 * Build a stock GTA San Andreas VER2 `.img` in memory (for tests / small sets; {@link buildArchiveBuffer}'s
 * VER2 sibling — the packer script streams instead, in the same format). Files are laid out on whole 2048-byte
 * sector boundaries; the 24-byte name field needs a NUL terminator, so names must be ≤ 23 bytes (throws else).
 */
export function buildVer2Buffer(entries: { data: Uint8Array; name: string }[]): Uint8Array {
  const dirSectors = Math.ceil((8 + entries.length * 32) / SECTOR);
  let cursor = dirSectors;
  const placed = entries.map((entry) => {
    const name = new TextEncoder().encode(entry.name);
    if (name.length > 23) {
      throw new Error(`VER2 name too long (max 23 bytes): ${entry.name}`);
    }
    const sectors = Math.max(1, Math.ceil(entry.data.length / SECTOR));
    const offset = cursor;
    cursor += sectors;

    return { data: entry.data, name, offset, sectors };
  });
  const out = new Uint8Array(cursor * SECTOR);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode('VER2'), 0);
  view.setUint32(4, entries.length, true);
  placed.forEach((entry, i) => {
    const base = 8 + i * 32;
    view.setUint32(base, entry.offset, true);
    view.setUint16(base + 4, entry.sectors, true); // streamingSize (sectors); sizeInArchive stays 0
    out.set(entry.name, base + 8);
    out.set(entry.data, entry.offset * SECTOR);
  });

  return out;
}

/**
 * Download a WIMG archive in one buffered read, cached per url.
 *
 * A single `arrayBuffer()` is used rather than a streamed `getReader()` loop:
 * the latter proved unreliable for large cross-origin responses (and
 * Content-Length isn't exposed to JS cross-origin anyway, so it couldn't drive
 * a percentage). The preloader is therefore indeterminate. The cache dedupes
 * concurrent/repeat calls (e.g. React StrictMode's double-invoked effect) so the
 * big archive is downloaded once.
 */
const archiveCache = new Map<string, Promise<ImgArchive>>();

export function loadArchive(url: string): Promise<ImgArchive> {
  let promise = archiveCache.get(url);
  if (!promise) {
    promise = downloadArchive(url).catch((error: unknown) => {
      archiveCache.delete(url); // allow a retry after failure
      throw error;
    });
    archiveCache.set(url, promise);
  }

  return promise;
}

/** Parse archive bytes (WIMG or stock GTA VER2, by magic) into an O(1) name->bytes accessor. */
export function openArchive(bytes: Uint8Array): ImgArchive {
  if (decode(bytes, 0, 8) === WIMG_MAGIC) {
    return openWimg(bytes);
  }
  if (decode(bytes, 0, 4) === 'VER2') {
    return openVer2(bytes);
  }
  throw new Error('Not a WIMG or VER2 archive');
}

function decode(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder().decode(bytes.subarray(start, end));
}

async function downloadArchive(url: string): Promise<ImgArchive> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download archive ${url}: ${response.status}`);
  }

  return openArchive(new Uint8Array(await response.arrayBuffer()));
}

/** Stock GTA San Andreas `.img` (VER2): inline 32-byte directory entries, offsets/sizes in 2048-byte sectors. */
function openVer2(bytes: Uint8Array): ImgArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4, true);
  // name (lowercased) -> [byteOffset, byteSize]. Sizes are padded to whole sectors; our chunk parsers
  // read by length and ignore the trailing padding, so handing back the padded slice is fine.
  const files = new Map<string, [number, number]>();
  for (let i = 0; i < count; i += 1) {
    const base = 8 + i * 32;
    const offsetSectors = view.getUint32(base, true);
    const streamingSize = view.getUint16(base + 4, true);
    const sizeInArchive = view.getUint16(base + 6, true);
    const sectors = streamingSize !== 0 ? streamingSize : sizeInArchive;
    let end = base + 8;
    while (end < base + 32 && bytes[end] !== 0) {
      end += 1;
    }
    const name = decode(bytes, base + 8, end).toLowerCase();
    files.set(name, [offsetSectors * SECTOR, sectors * SECTOR]);
  }

  return {
    get(name: string): ArrayBuffer | null {
      const entry = files.get(name.toLowerCase());
      if (!entry) {
        return null;
      }
      const start = bytes.byteOffset + entry[0];
      const stop = Math.min(start + entry[1], bytes.byteOffset + bytes.byteLength); // clamp last-file padding

      return bytes.buffer.slice(start, stop) as ArrayBuffer;
    },
    names: [...files.keys()],
  };
}

/** Our WIMG pack: a JSON directory of `[relativeOffset, size]` then concatenated data. */
function openWimg(bytes: Uint8Array): ImgArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directoryLength = view.getUint32(8, true);
  const { files } = JSON.parse(decode(bytes, HEADER_SIZE, HEADER_SIZE + directoryLength)) as {
    files: Record<string, [number, number]>;
  };
  const dataStart = HEADER_SIZE + directoryLength;

  return {
    get(name: string): ArrayBuffer | null {
      const entry = files[name.toLowerCase()];
      if (!entry) {
        return null;
      }
      const start = bytes.byteOffset + dataStart + entry[0];

      return bytes.buffer.slice(start, start + entry[1]) as ArrayBuffer;
    },
    names: Object.keys(files),
  };
}
