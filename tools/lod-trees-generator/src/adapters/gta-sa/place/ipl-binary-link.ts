/**
 * Patch a binary IPL stream's `lod` fields in place — point selected HD instances at their freshly appended
 * impostor LOD (a text-IPL index). No records are added or removed, so the file size and every other field
 * stays byte-identical.
 */
const OFFSET_INST = 0x1c;
const INST_SIZE = 40;
const REC_LOD = 36;

/** `instanceIndex → new lod (text-IPL index)`. Returns the patched bytes (a copy) or the input if `links` empty. */
export function linkBinaryLods(buffer: Uint8Array, links: ReadonlyMap<number, number>): Uint8Array {
  if (links.size === 0) {
    return buffer;
  }
  const bytes = buffer.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const instOffset = view.getUint32(OFFSET_INST, true);
  for (const [index, lod] of links) {
    view.setInt32(instOffset + index * INST_SIZE + REC_LOD, lod, true);
  }

  return bytes;
}
