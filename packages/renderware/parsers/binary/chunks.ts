import type { BinaryStream } from './binary-stream';

import { RwSection } from './constants';

/** SA Clump Struct payload: numAtomics + numLights + numCameras (3 × u32). */
const CLUMP_STRUCT_BYTES = 12;

/**
 * Direct children of each clump-level container, used to recompute a container's real end from its
 * honest-sized children when its own declared size is bloated past the clump (anti-rip lock — see
 * {@link forEachClumpChild}). The leaf/child sizes stay intact; only the outer container size is tampered.
 */
const CLUMP_CHILD_CONTENT: Readonly<Record<number, { allowed: ReadonlySet<number>; stopAfter?: ReadonlySet<number> }>> =
  {
    [RwSection.ATOMIC]: {
      allowed: new Set([RwSection.EXTENSION, RwSection.STRUCT]),
      stopAfter: new Set([RwSection.EXTENSION]),
    },
    [RwSection.EXTENSION]: { allowed: new Set([RwSection.COLLISION, RwSection.STRUCT]) },
    [RwSection.FRAME_LIST]: { allowed: new Set([RwSection.EXTENSION, RwSection.STRUCT]) },
    [RwSection.GEOMETRY_LIST]: { allowed: new Set([RwSection.GEOMETRY, RwSection.STRUCT]) },
  };

/** A parsed 12-byte RenderWare chunk header plus its data bounds. */
export interface ChunkHeader {
  /** Stream offset where the chunk's payload begins. */
  dataStart: number;
  /** Stream offset one past the chunk's payload (dataStart + size). */
  end: number;
  size: number;
  type: number;
  version: number;
}

/**
 * Real end of a list item whose declared chunk size may be inflated to swallow siblings (anti-rip lock):
 * the end of its last consecutive child of an allowed type, walked from `dataStart`. The item's own
 * children keep intact sizes — only the outer item size is tampered — so this lands on the real boundary.
 */
export function contentEnd(
  stream: BinaryStream,
  dataStart: number,
  limit: number,
  allowed: ReadonlySet<number>,
  stopAfter?: ReadonlySet<number>,
): number {
  let cursor = dataStart;
  let end = dataStart;
  while (cursor + 12 <= limit) {
    stream.seek(cursor);
    const header = readChunkHeader(stream);
    if (!allowed.has(header.type)) {
      break;
    }
    end = header.end;
    cursor = header.end;
    // Stop once we've consumed a terminal child (e.g. an Atomic's single Extension), so the walk doesn't
    // greedily swallow a same-typed sibling that follows the item (the trailing clump Extension after the
    // last Atomic — both are EXTENSION).
    if (stopAfter?.has(header.type)) {
      break;
    }
  }

  return end;
}

/** Find the first direct child chunk of the given type, or null. */
export function findChild(stream: BinaryStream, start: number, end: number, type: number): ChunkHeader | null {
  let found: ChunkHeader | null = null;
  forEachChild(stream, start, end, (header) => {
    if (found === null && header.type === type) {
      found = header;
    }
  });

  return found;
}

/**
 * RenderWare's `RwStreamFindChunk`: scan forward from `start` for the next chunk of `type`, **ignoring
 * declared sizes as boundaries** — skip non-matching chunks (and `0x0` size-0 padding) until a match or
 * `end`. Used to recover anti-rip "inflated size" locks (e.g. yosemite) whose chunk sizes swallow their
 * siblings; a boundary-respecting walk ({@link forEachChild}) misses them, but RW reads lists by count
 * and finds each item this way. Returns the header (cursor at its payload), or null.
 */
export function findChunkFrom(stream: BinaryStream, start: number, end: number, type: number): ChunkHeader | null {
  let cursor = start;
  while (cursor + 12 <= end) {
    stream.seek(cursor);
    const header = readChunkHeader(stream);
    if (header.type === type) {
      return header;
    }
    cursor = Math.max(header.end, header.dataStart); // advance ≥ 12 even for a size-0 chunk
  }

  return null;
}

/**
 * Iterate sibling chunks within [start, end), invoking `cb` for each.
 * The stream is positioned at each child's payload start before `cb`, and the
 * cursor is advanced to the next sibling afterwards regardless of how much
 * `cb` consumed.
 */
export function forEachChild(
  stream: BinaryStream,
  start: number,
  end: number,
  cb: (header: ChunkHeader) => void,
): void {
  stream.seek(start);
  while (stream.position + 12 <= end) {
    const header = readChunkHeader(stream);
    cb(header);
    stream.seek(header.end);
  }
}

/**
 * Iterate a Clump's children, tolerant of the "inflated size" anti-rip locks:
 *
 * - **Variant B** (e.g. cheetah.dff): the leading Struct's declared size is bloated to swallow its
 *   siblings, so a boundary-respecting walk sees only the Struct and misses everything after it. When the
 *   Struct overshoots the clump (impossible for a valid file), its real SA payload is a fixed 12 bytes —
 *   resume sibling iteration right after it.
 * - **Variant D** (e.g. walton.dff): *every* container size is bloated — the FrameList overruns the clump
 *   (→ 1.2 GB) and the GeometryList swallows the Atomics that follow it. Detecting the lock by the same
 *   bloated leading Struct, every child's real end is recomputed from its honest-sized children
 *   ({@link contentEnd} over {@link CLUMP_CHILD_CONTENT}) and `cb` gets the corrected header — so each
 *   child's own parse stays bounded and the sibling walk lands on the next real chunk.
 *
 * Valid clumps are untouched (the leading Struct ends within the clump → `locked` is false → plain walk).
 */
export function forEachClumpChild(stream: BinaryStream, clump: ChunkHeader, cb: (header: ChunkHeader) => void): void {
  stream.seek(clump.dataStart);
  const first = readChunkHeader(stream);
  const locked = first.type === RwSection.STRUCT && first.end > clump.end;
  let cursor = locked ? first.dataStart + CLUMP_STRUCT_BYTES : clump.dataStart;
  while (cursor + 12 <= clump.end) {
    stream.seek(cursor);
    const header = readChunkHeader(stream);
    // On a locked clump, trust each child's honest-sized children over its bloated declared size.
    const spec = locked || header.end > clump.end ? CLUMP_CHILD_CONTENT[header.type] : undefined;
    const end = spec ? contentEnd(stream, header.dataStart, clump.end, spec.allowed, spec.stopAfter) : header.end;
    cb({ ...header, end });
    cursor = Math.max(end, header.dataStart); // always advance ≥ 12 (header is ≥ 12 from cursor)
  }
}

/** Read a chunk header at the current cursor (cursor left at payload start). */
export function readChunkHeader(stream: BinaryStream): ChunkHeader {
  const type = stream.u32();
  const size = stream.u32();
  const version = stream.u32();
  const dataStart = stream.position;

  return { dataStart, end: dataStart + size, size, type, version };
}

/** Read a RW String chunk's text (handles the chunk header itself). */
export function readStringChunk(stream: BinaryStream, header: ChunkHeader): string {
  stream.seek(header.dataStart);

  return stream.string(header.size);
}

/**
 * Recover a count-based list defeated by the "inflated size" anti-rip lock (e.g. yosemite's atomics /
 * geometries / textures): scan for `count` chunks of `type` from `start` via {@link findChunkFrom}
 * (ignoring the bloated sizes + `0x0` padding), returning each header with its `end` corrected to its
 * real content (the last consecutive child in `contentTypes`, via {@link contentEnd}). The caller parses
 * each returned header. Only meaningful when a boundary walk under-counts; well-formed lists are fine.
 */
export function recoverLockedList(
  stream: BinaryStream,
  start: number,
  end: number,
  count: number,
  type: number,
  contentTypes: ReadonlySet<number>,
): ChunkHeader[] {
  const items: ChunkHeader[] = [];
  let cursor = start;
  for (let i = 0; i < count; i += 1) {
    const item = findChunkFrom(stream, cursor, end, type);
    if (!item) {
      break;
    }
    const realEnd = contentEnd(stream, item.dataStart, end, contentTypes);
    items.push({ ...item, end: realEnd });
    cursor = realEnd;
  }

  return items;
}
