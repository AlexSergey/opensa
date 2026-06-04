/**
 * "WIMG" archive — our own single-file pack of the GTA models, so the map is
 * one download instead of ~10k requests.
 *
 * Layout: `"WIMG0001"` (8 bytes) | `directoryLength` (u32 LE) | directory
 * (UTF-8 JSON `{ files: { <lowercased name>: [relativeOffset, size] } }`) |
 * data (concatenated raw bytes). `relativeOffset` is from the start of the data
 * section (`12 + directoryLength`) so offsets don't depend on the directory's
 * own size. Lookup is O(1) by lowercased filename.
 */
const MAGIC = 'WIMG0001';

const HEADER_SIZE = 12;

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
  out.set(new TextEncoder().encode(MAGIC), 0);
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

/** Parse archive bytes into an O(1) name->bytes accessor. */
export function openArchive(bytes: Uint8Array): ImgArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (decode(bytes, 0, 8) !== MAGIC) {
    throw new Error('Not a WIMG archive');
  }
  const directoryLength = view.getUint32(8, true);
  const directory = JSON.parse(decode(bytes, HEADER_SIZE, HEADER_SIZE + directoryLength)) as {
    files: Record<string, [number, number]>;
  };
  const dataStart = HEADER_SIZE + directoryLength;
  const { files } = directory;

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
