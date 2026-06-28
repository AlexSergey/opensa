import { unzlibSync } from 'fflate';

export interface DecodedPng {
  height: number;
  /** Tightly-packed RGBA, `width * height * 4` bytes. */
  rgba: Uint8Array;
  width: number;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Minimal PNG decoder (the inverse of lod-trees' `encodePng`): inflate the IDAT stream with fflate, then reverse
 * the per-scanline filters into RGBA. Supports 8-bit colour types **2 (RGB)** and **6 (RGBA)**, non-interlaced —
 * the norm for mod textures; anything else throws (palette / 16-bit / interlaced are a follow-up).
 */
export function decodePng(bytes: Uint8Array): DecodedPng {
  if (SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    throw new Error('not a PNG (bad signature)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4; // data + 4-byte CRC
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(
      `unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}); want 8-bit RGB/RGBA, non-interlaced`,
    );
  }

  const channels = colorType === 6 ? 4 : 3;

  return { height, rgba: unfilter(unzlibSync(concat(idat)), width, height, channels), width };
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

function reconstruct(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      throw new Error(`bad PNG scanline filter: ${filter}`);
  }
}

/** Reverse the PNG scanline filters (None/Sub/Up/Average/Paeth) and expand to RGBA (alpha 255 for RGB). */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = raw[pos + x];
      const left = x >= channels ? cur[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      cur[x] = (value + reconstruct(filter, left, up, upLeft)) & 0xff;
    }
    pos += stride;
    for (let x = 0; x < width; x += 1) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = cur[s];
      out[d + 1] = cur[s + 1];
      out[d + 2] = cur[s + 2];
      out[d + 3] = channels === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }

  return out;
}
