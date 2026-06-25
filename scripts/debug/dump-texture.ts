import type { RWTexture } from '@opensa/renderware/parsers/binary/types';

import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

import { gameArg, openGameArchive, positionalArgs } from '../lib/game';

/**
 * Dump one texture from a TXD to a PNG (no deps — zlib IDAT). Used to inspect glyph atlases
 * like `roadsignfont` (plan 042 item 5b). The TXD is an archive entry (e.g. `particle.txd`) or a
 * filesystem path. Run:
 * `npx tsx scripts/debug/dump-texture.ts particle.txd roadsignfont out.png [alpha] [--game original]`
 */
const [txdTarget, textureName, outPath, mode] = positionalArgs();
if (!txdTarget || !textureName) {
  console.error('usage: npx tsx scripts/debug/dump-texture.ts <txd> <textureName> [out.png] [alpha] [--game original]');
  process.exit(1);
}

const fromArchive = openGameArchive(gameArg()).get(txdTarget);
if (!fromArchive && !existsSync(txdTarget)) {
  console.error(`not found in archive or filesystem: ${txdTarget}`);
  process.exit(1);
}
let bytes = fromArchive;
if (!bytes) {
  const file = readFileSync(txdTarget);
  bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}
const txd = parseTxd(bytes);
const texture = txd.textures.find((t) => t.name.toLowerCase() === textureName.toLowerCase());
if (!texture) {
  console.error(`texture "${textureName}" not found; available: ${txd.textures.map((t) => t.name).join(', ')}`);
  process.exit(1);
}

let rgba = decodeToRgba(texture);
let outWidth = texture.width;
let outHeight = texture.height;
if (mode === 'alpha') {
  // Visualise the alpha channel as opaque grayscale (glyph atlases are white-on-transparent).
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = rgba[i + 3];
    rgba[i + 1] = rgba[i + 3];
    rgba[i + 2] = rgba[i + 3];
    rgba[i + 3] = 255;
  }
  // Tall glyph strips are unreadable as-is: cut into 4 vertical strips laid side by side, ×8 zoom.
  if (outHeight >= outWidth * 4) {
    const strips = 4;
    const stripHeight = outHeight / strips;
    const reflowed = new Uint8Array(outWidth * strips * stripHeight * 4);
    for (let strip = 0; strip < strips; strip += 1) {
      for (let y = 0; y < stripHeight; y += 1) {
        const src = (strip * stripHeight + y) * outWidth * 4;
        const dst = (y * outWidth * strips + strip * outWidth) * 4;
        reflowed.set(rgba.subarray(src, src + outWidth * 4), dst);
      }
    }
    rgba = reflowed;
    outWidth *= strips;
    outHeight = stripHeight;
  }
  const zoom = 8;
  const zoomed = new Uint8Array(outWidth * zoom * outHeight * zoom * 4);
  for (let y = 0; y < outHeight * zoom; y += 1) {
    for (let x = 0; x < outWidth * zoom; x += 1) {
      const src = (Math.floor(y / zoom) * outWidth + Math.floor(x / zoom)) * 4;
      zoomed.set(rgba.subarray(src, src + 4), (y * outWidth * zoom + x) * 4);
    }
  }
  rgba = zoomed;
  outWidth *= zoom;
  outHeight *= zoom;
}
console.log(`${texture.name}: ${texture.width}x${texture.height} ${texture.format} alpha=${texture.hasAlpha}`);
writeFileSync(outPath ?? `${textureName}.png`, encodePng(outWidth, outHeight, rgba));
console.log(`written ${outPath ?? `${textureName}.png`} (${outWidth}x${outHeight})`);

function alphaOf(
  rw: RWTexture,
  data: Uint8Array,
  offset: number,
  x: number,
  y: number,
  colorIndex: number,
  oneBitMode: boolean,
): number {
  if (rw.format === 'dxt1') {
    return oneBitMode && colorIndex === 3 ? 0 : 255;
  }
  if (rw.format === 'dxt3') {
    const nibble = (data[offset + y * 2 + (x >> 1)] >> ((x & 1) * 4)) & 0xf;

    return nibble * 17;
  }
  // dxt5: two endpoint bytes + 16 3-bit indices
  const a0 = data[offset];
  const a1 = data[offset + 1];
  const bitIndex = (y * 4 + x) * 3;
  const byteIndex = 2 + (bitIndex >> 3);
  const bits = (data[offset + byteIndex] | (data[offset + byteIndex + 1] << 8)) >> (bitIndex & 7);
  const index = bits & 7;
  if (index === 0) {
    return a0;
  }
  if (index === 1) {
    return a1;
  }
  if (a0 > a1) {
    return Math.round(((8 - index) * a0 + (index - 1) * a1) / 7);
  }
  if (index === 6) {
    return 0;
  }
  if (index === 7) {
    return 255;
  }

  return Math.round(((6 - index) * a0 + (index - 1) * a1) / 5);
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, data.length + 8)), data.length + 8);

  return out;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function decodeBlock(rw: RWTexture, data: Uint8Array, offset: number, out: Uint8Array, px: number, py: number): void {
  const colorOffset = rw.format === 'dxt1' ? offset : offset + 8;
  const c0 = data[colorOffset] | (data[colorOffset + 1] << 8);
  const c1 = data[colorOffset + 2] | (data[colorOffset + 3] << 8);
  const palette = [rgb565(c0), rgb565(c1), [0, 0, 0], [0, 0, 0]] as number[][];
  if (rw.format !== 'dxt1' || c0 > c1) {
    palette[2] = palette[0].map((v, i) => Math.round((2 * v + palette[1][i]) / 3));
    palette[3] = palette[0].map((v, i) => Math.round((v + 2 * palette[1][i]) / 3));
  } else {
    palette[2] = palette[0].map((v, i) => Math.round((v + palette[1][i]) / 2));
    palette[3] = [0, 0, 0]; // 1-bit-alpha mode: index 3 = transparent black
  }
  for (let y = 0; y < 4; y += 1) {
    const rowBits = data[colorOffset + 4 + y];
    for (let x = 0; x < 4; x += 1) {
      if (px + x >= rw.width || py + y >= rw.height) {
        continue;
      }
      const index = (rowBits >> (x * 2)) & 3;
      const dst = ((py + y) * rw.width + px + x) * 4;
      out[dst] = palette[index][0];
      out[dst + 1] = palette[index][1];
      out[dst + 2] = palette[index][2];
      out[dst + 3] = alphaOf(rw, data, offset, x, y, index, c0 <= c1);
    }
  }
}

/** Decode the base mip to RGBA8888 (DXT1/3/5 software decode; rgba passes through). */
function decodeToRgba(rw: RWTexture): Uint8Array {
  const mip = rw.mipmaps[0];
  if (rw.format === 'rgba8888') {
    return mip.data;
  }
  const out = new Uint8Array(rw.width * rw.height * 4);
  const blockBytes = rw.format === 'dxt1' ? 8 : 16;
  const blocksWide = Math.ceil(rw.width / 4);
  for (let by = 0; by < Math.ceil(rw.height / 4); by += 1) {
    for (let bx = 0; bx < blocksWide; bx += 1) {
      const offset = (by * blocksWide + bx) * blockBytes;
      decodeBlock(rw, mip.data, offset, out, bx * 4, by * 4);
    }
  }

  return out;
}

/** Minimal PNG encoder: 8-bit RGBA, one IDAT, filter 0 per scanline. */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))];

  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

function rgb565(value: number): number[] {
  return [((value >> 11) & 31) * 8.226, ((value >> 5) & 63) * 4.048, (value & 31) * 8.226].map(Math.round);
}
