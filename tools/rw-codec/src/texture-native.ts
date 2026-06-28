import type { DxtFormat } from './dxt';
import type { MipLevel } from './mip';

import { encodeDxt } from './dxt-encode';

/**
 * Write a `TextureNative` Struct as uncompressed **A8R8G8B8** with a full mip chain (plan 010, Phase 1 — no
 * DXT encoder). Preserves the original's platform / filter / name / maskName / rasterType; overrides the
 * format fields and level data. Pixels are stored **BGRA** (the engine's parser swizzles back to RGBA).
 *
 * Struct header (mirrors `src/.../txd.ts`): `platform u32, filter u32, name[32], maskName[32], rasterFormat
 * u32, d3dFormat u32, width u16, height u16, depth u8, numLevels u8, rasterType u8, flags u8`, then per level
 * `size u32 + data`.
 */

const HEADER_SIZE = 88;
const RASTER_C8888 = 0x0500;
const RASTER_MIPMAP = 0x8000;
const D3DFMT_A8R8G8B8 = 21;
const ALPHA_FLAG = 0x01;

export function encodeRgba8888Struct(original: Uint8Array, levels: readonly MipLevel[], hasAlpha: boolean): Uint8Array {
  const dataSize = levels.reduce((sum, level) => sum + 4 + level.data.length, 0);
  const out = new Uint8Array(HEADER_SIZE + dataSize);
  out.set(original.subarray(0, 72), 0); // platform + filter + name + maskName, verbatim

  const view = new DataView(out.buffer);
  view.setUint32(72, RASTER_C8888 | RASTER_MIPMAP, true);
  view.setUint32(76, D3DFMT_A8R8G8B8, true);
  view.setUint16(80, levels[0].width, true);
  view.setUint16(82, levels[0].height, true);
  out[84] = 32; // depth
  out[85] = levels.length; // numLevels
  out[86] = original[86]; // rasterType (preserve)
  out[87] = hasAlpha ? original[87] | ALPHA_FLAG : original[87] & ~ALPHA_FLAG;

  let offset = HEADER_SIZE;
  for (const level of levels) {
    view.setUint32(offset, level.data.length, true);
    offset += 4;
    for (let i = 0; i < level.data.length; i += 4) {
      out[offset + i] = level.data[i + 2]; // B
      out[offset + i + 1] = level.data[i + 1]; // G
      out[offset + i + 2] = level.data[i]; // R
      out[offset + i + 3] = level.data[i + 3]; // A
    }
    offset += level.data.length;
  }

  return out;
}

/**
 * Re-encode a TextureNative Struct keeping its **format unchanged** (used for DXT: no palette) — copy the
 * 88-byte header verbatim, set `numLevels` + the mipmap flag, and append the given pre-compressed level data.
 * The base level should be the original bytes (lossless); only the added mips are re-encoded.
 */
export function encodeSameFormatStruct(original: Uint8Array, levels: readonly { data: Uint8Array }[]): Uint8Array {
  const dataSize = levels.reduce((sum, level) => sum + 4 + level.data.length, 0);
  const out = new Uint8Array(HEADER_SIZE + dataSize);
  out.set(original.subarray(0, HEADER_SIZE), 0);

  const view = new DataView(out.buffer);
  view.setUint32(72, view.getUint32(72, true) | RASTER_MIPMAP, true);
  out[85] = levels.length;

  let offset = HEADER_SIZE;
  for (const level of levels) {
    view.setUint32(offset, level.data.length, true);
    offset += 4;
    out.set(level.data, offset);
    offset += level.data.length;
  }

  return out;
}

// From-scratch DXT struct header (mirrors the in-game-verified `LODvegetation.txd` writer). For DXT the engine's
// parser keys the format off `d3dFormat`, so `rasterFormat`/`depth` are decorative; `flags` carries the alpha bit.
const PLATFORM_D3D9 = 9;
const FILTER_LINEAR_MIP = 0x1106; // trilinear + wrap/wrap
const RASTER_TYPE_TEXTURE = 4;
const RASTER_MIP = 0x8300; // mipmap flag + a raster format (informational for DXT)
const DXT_DEPTH = 16;
const FLAG_DXT = 0x08; // "compressed" bit
const FLAG_ALPHA = 0x01;
const D3DFMT: Record<DxtFormat, number> = { dxt1: 0x31545844, dxt3: 0x33545844, dxt5: 0x35545844 };

/**
 * Build a complete TextureNative Struct **from scratch** (no original to copy): DXT-compress each RGBA mip level
 * and write the 88-byte header. `dxt1` for opaque, `dxt5` for alpha (alpha bit set in `flags`). Pairs with the
 * `RW_TEXTURE_NATIVE` wrapper to add a brand-new texture to a dictionary.
 */
export function encodeDxtStruct(name: string, format: DxtFormat, levels: readonly MipLevel[]): Uint8Array {
  const blocks = levels.map((level) => encodeDxt(format, level.data, level.width, level.height));
  const dataSize = blocks.reduce((sum, block) => sum + 4 + block.length, 0);
  const out = new Uint8Array(HEADER_SIZE + dataSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, PLATFORM_D3D9, true);
  view.setUint32(4, FILTER_LINEAR_MIP, true);
  writeName(out, 8, name); // name[32]
  writeName(out, 40, name); // maskName[32]
  view.setUint32(72, RASTER_MIP, true);
  view.setUint32(76, D3DFMT[format], true);
  view.setUint16(80, levels[0].width, true);
  view.setUint16(82, levels[0].height, true);
  out[84] = DXT_DEPTH;
  out[85] = levels.length;
  out[86] = RASTER_TYPE_TEXTURE;
  out[87] = format === 'dxt1' ? FLAG_DXT : FLAG_DXT | FLAG_ALPHA;

  let offset = HEADER_SIZE;
  for (const block of blocks) {
    view.setUint32(offset, block.length, true);
    offset += 4;
    out.set(block, offset);
    offset += block.length;
  }

  return out;
}

/** A TextureNative Struct's texture name (offset 8, 32-byte NUL-terminated). */
export function readTextureName(struct: Uint8Array): string {
  let end = 8;
  while (end < 40 && struct[end] !== 0) {
    end += 1;
  }

  return new TextDecoder().decode(struct.subarray(8, end));
}

function writeName(out: Uint8Array, offset: number, name: string): void {
  for (let i = 0; i < Math.min(name.length, 31); i += 1) {
    out[offset + i] = name.charCodeAt(i);
  }
}
