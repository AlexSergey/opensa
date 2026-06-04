import type { BinaryStream } from './binary-stream';

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
