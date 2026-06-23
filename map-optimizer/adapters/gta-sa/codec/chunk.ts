/**
 * RenderWare chunk-container codec (read ⇄ write), self-contained in map-optimizer (the write capability the
 * core/`../src` never gains). A `.dff` is a tree of chunks, each a 12-byte header (`type`, `size`,
 * `libraryId/version`, all u32 LE) + a `size`-byte body. A container's body is more chunks; a leaf's body is
 * raw data. RW doesn't flag container vs leaf, so we descend only into the few types we must reach (down to a
 * Geometry's Struct) and treat everything else as a raw leaf — fewer container types = fewer ways to misparse.
 *
 * The codec is **byte-faithful**: leaves keep their exact source slice, containers re-concatenate their
 * children, and any bytes inside a container after its last parsed child (or after the last top-level chunk)
 * are captured as `trailing` and re-emitted verbatim. So `writeRw(readRw(bytes))` reproduces `bytes` exactly,
 * including odd/anti-rip layouts.
 */

/** Chunk header: type + size + libraryId, 3 × u32 LE. */
const HEADER_BYTES = 12;

export const RW_STRUCT = 0x01;
export const RW_EXTENSION = 0x03;
export const RW_GEOMETRY = 0x0f;
export const RW_CLUMP = 0x10;
export const RW_GEOMETRY_LIST = 0x1a;
export const RW_SKIN = 0x116;
export const RW_BIN_MESH_PLG = 0x50e;
export const RW_NIGHT_VERTEX_COLORS = 0x253f2f9;

/** Section types we descend into to reach a Geometry's Struct + its Extension (for BinMeshPLG / night colour
 *  rebuild); everything else (incl. the plugin chunks inside an Extension) is a leaf (raw bytes). */
const CONTAINER_TYPES = new Set<number>([RW_CLUMP, RW_EXTENSION, RW_GEOMETRY, RW_GEOMETRY_LIST]);

const EMPTY = new Uint8Array(0);

/** A parsed RenderWare chunk: either a container (`children` [+ `trailing`]) or a leaf (`data`). */
export interface RwChunk {
  children?: RwChunk[];
  data?: Uint8Array;
  trailing?: Uint8Array;
  type: number;
  version: number;
}

/** A parsed RenderWare file: top-level chunks + any bytes after the last one. */
export interface RwFile {
  chunks: RwChunk[];
  trailing: Uint8Array;
}

/** Parse RenderWare bytes into a faithful chunk tree. */
export function readRw(bytes: Uint8Array): RwFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { chunks, end } = readChunks(bytes, view, 0, bytes.length);

  return { chunks, trailing: bytes.subarray(end) };
}

/** Re-serialize a chunk tree back to bytes (identity when nothing was mutated). */
export function writeRw(file: RwFile): Uint8Array {
  return concat([...file.chunks.map(writeChunk), file.trailing]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function readChunk(
  bytes: Uint8Array,
  view: DataView,
  type: number,
  version: number,
  bodyStart: number,
  bodyEnd: number,
): RwChunk {
  if (!CONTAINER_TYPES.has(type)) {
    return { data: bytes.subarray(bodyStart, bodyEnd), type, version };
  }
  const { chunks, end } = readChunks(bytes, view, bodyStart, bodyEnd);
  const chunk: RwChunk = { children: chunks, type, version };
  if (end < bodyEnd) {
    chunk.trailing = bytes.subarray(end, bodyEnd);
  }

  return chunk;
}

function readChunks(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  limit: number,
): { chunks: RwChunk[]; end: number } {
  const chunks: RwChunk[] = [];
  let pos = start;
  while (pos + HEADER_BYTES <= limit) {
    const type = view.getUint32(pos, true);
    const size = view.getUint32(pos + 4, true);
    const version = view.getUint32(pos + 8, true);
    const bodyStart = pos + HEADER_BYTES;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > limit) {
      break; // overrun (malformed / anti-rip) — leave the rest for `trailing`
    }
    chunks.push(readChunk(bytes, view, type, version, bodyStart, bodyEnd));
    pos = bodyEnd;
  }

  return { chunks, end: pos };
}

function writeChunk(chunk: RwChunk): Uint8Array {
  const body = chunk.children
    ? concat([...chunk.children.map(writeChunk), chunk.trailing ?? EMPTY])
    : (chunk.data ?? EMPTY);
  const out = new Uint8Array(HEADER_BYTES + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, chunk.type, true);
  view.setUint32(4, body.length, true);
  view.setUint32(8, chunk.version, true);
  out.set(body, HEADER_BYTES);

  return out;
}
