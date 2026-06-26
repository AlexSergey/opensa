import type { Impostor, Vec3 } from '../../core';

/**
 * Encode a COL3 collision library (one `.col`) — one **bounds-only** model per tree, matching what SA's LOD
 * vegetation ships (`lodCedar1_hi`: bounds set, zero spheres/boxes/faces/vertices). SA binds collision by model
 * **name**, so each col model is named with the impostor's registered model name (`names[i]` — the IDE/IMG
 * alias), and the library must be packed into the IMG (SA auto-discovers `.col` entries). Without it the game
 * faults with "model … does not have loaded collision". Layout mirrors `parsers/binary/col.ts`.
 */
const FOURCC = 'COL3';
const NAME_BYTES = 22;
// Stock empty-collision COL3 models are 112 bytes: name(22) + modelId(2) + bounds(40) + a 48-byte all-zero tail
// (counts/offsets/shadow). The size MUST be exact — an undersized model misaligns SA's parse of the rest of the
// library and corrupts collision globally (faults an unrelated model with "does not have loaded collision").
const BODY_BYTES = 112;

export function encodeColLibrary(impostors: Impostor[], names: readonly string[]): Uint8Array {
  return concat(impostors.map((impostor, i) => encodeModel(impostor, names[i])));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function encodeModel(impostor: Impostor, name: string): Uint8Array {
  const { max, min } = impostor.bbox;
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  const body = new Uint8Array(BODY_BYTES);
  const view = new DataView(body.buffer);
  writeName(body, name);
  view.setUint16(22, 0, true); // modelId — SA binds collision by name, stock leaves this 0
  setVec3(view, 24, min);
  setVec3(view, 36, max);
  setVec3(view, 48, center);
  view.setFloat32(60, radius, true);
  // Bytes 64..111 (counts, offsets, shadow-mesh fields) stay 0 — exactly like a stock empty-collision LOD.

  const head = new Uint8Array(8);
  const headView = new DataView(head.buffer);
  for (let i = 0; i < 4; i += 1) {
    head[i] = FOURCC.charCodeAt(i);
  }
  headView.setUint32(4, BODY_BYTES, true);

  return concat([head, body]);
}

function setVec3(view: DataView, offset: number, vec: Vec3): void {
  view.setFloat32(offset, vec[0], true);
  view.setFloat32(offset + 4, vec[1], true);
  view.setFloat32(offset + 8, vec[2], true);
}

function writeName(out: Uint8Array, name: string): void {
  for (let i = 0; i < Math.min(name.length, NAME_BYTES - 1); i += 1) {
    out[i] = name.charCodeAt(i);
  }
}
