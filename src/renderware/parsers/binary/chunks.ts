import type { BinaryStream } from './binary-stream';

import { RwSection } from './constants';

/** SA Clump Struct payload: numAtomics + numLights + numCameras (3 × u32). */
const CLUMP_STRUCT_BYTES = 12;

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
 * Iterate a Clump's children, tolerant of the "inflated struct size" anti-rip lock (e.g. cheetah.dff):
 * the leading Struct's declared size is bloated to swallow its siblings, so a boundary-respecting walk
 * sees only the Struct and misses the FrameList / GeometryList / Atomics / Extension. When the Struct
 * overshoots the clump (impossible for a valid file), its real SA payload is a fixed 12 bytes — resume
 * sibling iteration right after it. Valid clumps are untouched (their Struct ends within the clump).
 */
export function forEachClumpChild(stream: BinaryStream, clump: ChunkHeader, cb: (header: ChunkHeader) => void): void {
  stream.seek(clump.dataStart);
  const first = readChunkHeader(stream);
  const start =
    first.type === RwSection.STRUCT && first.end > clump.end ? first.dataStart + CLUMP_STRUCT_BYTES : clump.dataStart;
  forEachChild(stream, start, clump.end, cb);
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
