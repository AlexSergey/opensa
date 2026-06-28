import type { RwChunk } from '@opensa/rw-codec/chunk';

import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_DICTIONARY, writeRw } from '@opensa/rw-codec/chunk';
import { zlibSync } from 'fflate';

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Assemble a `.txd` (Texture Dictionary) from ready TextureNative chunks — for seeding a base file in tests. */
export function buildTxd(natives: readonly RwChunk[], version: number): Uint8Array {
  const struct = new Uint8Array(4);
  new DataView(struct.buffer).setUint16(0, natives.length, true); // textureCount; deviceId 0

  return writeRw({
    chunks: [
      {
        children: [
          { data: struct, type: RW_STRUCT, version },
          ...natives,
          { children: [], type: RW_EXTENSION, version },
        ],
        type: RW_TEXTURE_DICTIONARY,
        version,
      },
    ],
    trailing: new Uint8Array(0),
  });
}

/**
 * Minimal PNG **encoder** for tests (the inverse of `png-decode`): 8-bit colour type 6 (RGBA) or 2 (RGB), with a
 * chosen scanline `filter` (0–4) applied to every row — so the decoder's un-filter paths are exercised. `rgba` is
 * the RGBA source; for type 2 the alpha is dropped.
 */
export function encodePng(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: { colorType?: 2 | 6; filter?: number } = {},
): Uint8Array {
  const colorType = options.colorType ?? 6;
  const filter = options.filter ?? 0;
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) {
        row[x * channels + c] = rgba[(y * width + x) * 4 + c];
      }
    }
    const o = y * (stride + 1);
    raw[o] = filter;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      raw[o + 1 + i] = (row[i] - predict(filter, left, up, upLeft)) & 0xff;
    }
    prev = row;
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;

  return concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

/** A flat `width × height` RGBA buffer filled with one colour (alpha defaults opaque). */
export function solidRgba(width: number, height: number, [r, g, b, a]: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }

  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);

  return out;
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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }

  return pb <= pc ? b : c;
}

function predict(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      return 0;
  }
}
