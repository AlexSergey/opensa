import type { RwChunk } from '@opensa/rw-codec/chunk';

import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readRw, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';

/**
 * Trim a TXD to only the textures named in `keep` (lowercased): drop the unused `TEXTURE_NATIVE` chunks (copying
 * the kept ones **verbatim** — native format preserved, no re-encode) and fix the dictionary's texture count.
 * Used when packing a shared mod TXD that also held textures for models we dropped (procobj / non-tree), so the
 * dead ones don't bloat the output `gta3.img`. Returns the **original** bytes on anything unexpected (no readable
 * dictionary, an anti-rip/recovered count mismatch, or a failed round-trip) — a pack must never break.
 */
export function trimTxd(bytes: Uint8Array, keep: ReadonlySet<string>): Uint8Array {
  try {
    const names = parseTxd(toArrayBuffer(bytes)).textures.map((texture) => texture.name.toLowerCase());
    const file = readRw(bytes);
    const dict = findDictionary(file.chunks);
    if (!dict?.children) {
      return bytes;
    }
    const natives = dict.children.filter((chunk) => chunk.type === RW_TEXTURE_NATIVE);
    if (natives.length !== names.length) {
      return bytes; // parse order / count differs (e.g. anti-rip recovery) — don't risk a wrong drop
    }
    const drop = new Set(natives.filter((_, i) => !keep.has(names[i])));
    if (drop.size === 0) {
      return bytes; // every texture is used — nothing to trim
    }

    const keptCount = natives.length - drop.size;
    dict.children = dict.children.filter((chunk) => !drop.has(chunk));
    const struct = dict.children.find((chunk) => chunk.type === RW_STRUCT);
    if (struct?.data && struct.data.length >= 2) {
      const data = new Uint8Array(struct.data); // copy — never mutate the input buffer
      new DataView(data.buffer).setUint16(0, keptCount, true); // numTextures (deviceId follows, untouched)
      struct.data = data;
    }

    const out = writeRw(file);

    return parseTxd(toArrayBuffer(out)).textures.length === keptCount ? out : bytes; // sanity-check the round-trip
  } catch {
    return bytes;
  }
}

/** First `TEXTURE_DICTIONARY` chunk anywhere in the tree (usually top-level). */
function findDictionary(chunks: readonly RwChunk[]): RwChunk | undefined {
  for (const chunk of chunks) {
    if (chunk.type === RW_TEXTURE_DICTIONARY) {
      return chunk;
    }
    const nested = chunk.children ? findDictionary(chunk.children) : undefined;
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
