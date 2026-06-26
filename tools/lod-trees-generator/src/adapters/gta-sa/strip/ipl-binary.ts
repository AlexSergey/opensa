const HEADER_SIZE = 76;
const INST_SIZE = 40;
const OFFSET_INST = 0x1c;
const FIELD_NUM_INST = 0x04;
const REC_ID = 28;
const REC_LOD = 36;

/**
 * Rewrite a binary ("bnry") IPL stream, dropping every INST whose model `id` fails `keep`.
 *
 * A stream's `lod` field is **not** a within-stream index — it points into the area's companion *text* IPL
 * (e.g. `countrye_stream*` → `countrye.ipl`). So surviving instances keep their own bytes verbatim except `lod`,
 * which is remapped through `textMap` (the text IPL's old→new instance map; `-1` for a dropped target). When the
 * area has no companion text IPL (`textMap` is null) the `lod` is left untouched. The 76-byte header's `numInst`
 * + post-INST section offsets are fixed up; trailing sections are copied verbatim after the shrunken INST block.
 */
export function stripBinaryIpl(
  buffer: Uint8Array,
  keep: (id: number) => boolean,
  textMap: Int32Array | null,
): { bytes: Uint8Array; changed: boolean; removed: number } {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const numInst = view.getUint32(FIELD_NUM_INST, true);
  const instOffset = view.getUint32(OFFSET_INST, true);

  const remap = (lod: number): number => {
    if (lod < 0 || !textMap) {
      return lod;
    }

    return lod < textMap.length ? textMap[lod] : -1;
  };

  const kept: number[] = [];
  let lodChanged = false;
  for (let i = 0; i < numInst; i += 1) {
    const recAt = instOffset + i * INST_SIZE;
    if (!keep(view.getUint32(recAt + REC_ID, true))) {
      continue;
    }
    if (remap(view.getInt32(recAt + REC_LOD, true)) !== view.getInt32(recAt + REC_LOD, true)) {
      lodChanged = true;
    }
    kept.push(i);
  }

  const removed = numInst - kept.length;
  if (removed === 0 && !lodChanged) {
    return { bytes: buffer, changed: false, removed: 0 };
  }

  const newInst = new Uint8Array(kept.length * INST_SIZE);
  const newView = new DataView(newInst.buffer);
  kept.forEach((source, target) => {
    const from = instOffset + source * INST_SIZE;
    newInst.set(buffer.subarray(from, from + INST_SIZE), target * INST_SIZE);
    newView.setInt32(target * INST_SIZE + REC_LOD, remap(view.getInt32(from + REC_LOD, true)), true);
  });

  const delta = removed * INST_SIZE;
  const header = buffer.slice(0, HEADER_SIZE);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(FIELD_NUM_INST, kept.length, true);
  for (let offset = OFFSET_INST + 4; offset < HEADER_SIZE; offset += 4) {
    const value = headerView.getUint32(offset, true);
    if (value > instOffset) {
      headerView.setUint32(offset, value - delta, true); // section shifted earlier by the removed INST bytes
    }
  }

  const tail = buffer.subarray(instOffset + numInst * INST_SIZE);
  const bytes = new Uint8Array(HEADER_SIZE + newInst.length + tail.length);
  bytes.set(header, 0);
  bytes.set(newInst, HEADER_SIZE);
  bytes.set(tail, HEADER_SIZE + newInst.length);

  return { bytes, changed: true, removed };
}
