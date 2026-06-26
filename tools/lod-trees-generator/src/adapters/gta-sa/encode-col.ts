import type { Impostor, Vec3 } from '../../core';

/**
 * Encode a COL3 collision library (one `.col`) — one **bounds-only** model per tree, matching what SA's LOD
 * vegetation ships (`lodCedar1_hi`: bounds set, zero spheres/boxes/faces/vertices). The model name matches the
 * LOD DFF so the game binds it. Layout mirrors `parsers/binary/col.ts`.
 */
const FOURCC = 'COL3';
const NAME_BYTES = 22;
const BODY_BYTES = 108; // name(22)+modelId(2)+bounds(40)+counts(12)+offsets(20)+shadow(12)
const OFFSET_BASE = 4;

export function encodeColLibrary(impostors: Impostor[]): Uint8Array {
  return concat(impostors.map(encodeModel));
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

function encodeModel(impostor: Impostor): Uint8Array {
  const { max, min } = impostor.bbox;
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  const body = new Uint8Array(BODY_BYTES);
  const view = new DataView(body.buffer);
  writeName(body, impostor.name);
  view.setUint16(22, 0, true); // modelId — IDE wiring is out of scope
  setVec3(view, 24, min);
  setVec3(view, 36, max);
  setVec3(view, 48, center);
  view.setFloat32(60, radius, true);
  // counts (64..76) stay 0: no spheres / boxes / faces / flags.
  const end = BODY_BYTES + OFFSET_BASE; // empty sections → offsets point past the body (never read)
  for (const offset of [76, 80, 84, 88, 92, 100, 104]) {
    view.setUint32(offset, end, true);
  }
  // numShadowFaces (96) stays 0.

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
