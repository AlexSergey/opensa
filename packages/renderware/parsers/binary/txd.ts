import type { ChunkHeader } from './chunks';
import type { RWMipLevel, RWTexture, RWTextureDictionary, RWTextureFormat } from './types';

import { BinaryStream } from './binary-stream';
import { findChild, forEachChild, readChunkHeader, recoverLockedList } from './chunks';
import { D3dCompression, RasterFormat, RwSection } from './constants';

/** A TEXTURE_NATIVE is a Struct (raster) + Extension — used to find its real end past a bloated lock size. */
const TEXTURE_CHILDREN: ReadonlySet<number> = new Set([RwSection.EXTENSION, RwSection.STRUCT]);

/**
 * Parse a RenderWare Texture Dictionary (.txd) into RWTextureDictionary.
 *
 * Supports the GTA SA D3D8/D3D9 Texture Native layout. Pixel formats handled:
 * DXT1/3/5 (kept as raw blocks), uncompressed 32-bit (8888/888), 16-bit
 * (R5G6B5 / A1R5G5B5 / A4R4G4B4 — expanded to RGBA here, plan 043), and 8-/4-bit
 * palettized (expanded to RGBA here). Textures whose format is not understood
 * are skipped rather than aborting the whole dictionary.
 */
export function parseTxd(buffer: ArrayBuffer): RWTextureDictionary {
  const stream = new BinaryStream(buffer);
  const dictHeader = findDictHeader(stream);
  if (dictHeader) {
    const textures = parseDictionary(stream, dictHeader);
    if (textures.length > 0) {
      return { textures };
    }
  }

  // Anti-rip "obfuscated wrapper" lock (e.g. gostown's lodveg.txd): the outer TexDictionary header is hidden,
  // so no 0x16 is found (or it yields nothing). The real TEXTURE_NATIVE chunks are still present — recover them
  // RW-style by scanning the stream directly, like the engine tolerates locked streams.
  const recovered = recoverLockedTextures(stream);
  if (recovered.length > 0) {
    return { textures: recovered };
  }

  throw new Error('Not a TXD: no TexDictionary (0x16) chunk and no recoverable TEXTURE_NATIVE chunks');
}

/** Map RW format identifiers to the adapter's format tag, or null if unsupported. */
function classifyFormat(d3dFormat: number, rasterFormat: number, depth: number): null | RWTextureFormat {
  switch (d3dFormat) {
    case D3dCompression.DXT1:
      return 'dxt1';
    case D3dCompression.DXT3:
      return 'dxt3';
    case D3dCompression.DXT5:
      return 'dxt5';
    default:
      break;
  }
  if (rasterFormat & (RasterFormat.PAL8 | RasterFormat.PAL4)) {
    return 'rgba8888'; // expanded from palette below
  }
  // Uncompressed 32-bit: A8R8G8B8 (raster C8888) and X8R8G8B8 (raster C888) are
  // both 4 bytes/pixel — classify by depth so neither is dropped.
  const pixelFormat = rasterFormat & RasterFormat.PIXEL_FORMAT_MASK;
  if (depth === 32 || pixelFormat === RasterFormat.C8888 || pixelFormat === RasterFormat.C888) {
    return 'rgba8888';
  }
  // Uncompressed 16-bit (R5G6B5 / A1R5G5B5 / A4R4G4B4) — expanded to RGBA8888 in readMipmaps.
  if (pixelFormat === RasterFormat.C565 || pixelFormat === RasterFormat.C1555 || pixelFormat === RasterFormat.C4444) {
    return 'rgba8888';
  }

  return null;
}

/** Expand 16-bit D3D pixels (R5G6B5 / A1R5G5B5 / A4R4G4B4, little-endian) to RGBA8888. */
function expand16(raw: Uint8Array, pixelFormat: number): Uint8Array {
  const out = new Uint8Array(raw.length * 2);
  for (let i = 0; i < raw.length; i += 2) {
    const value = raw[i] | (raw[i + 1] << 8);
    const o = i * 2;
    if (pixelFormat === RasterFormat.C565) {
      out[o] = Math.round(((value >> 11) & 31) * (255 / 31));
      out[o + 1] = Math.round(((value >> 5) & 63) * (255 / 63));
      out[o + 2] = Math.round((value & 31) * (255 / 31));
      out[o + 3] = 255;
    } else if (pixelFormat === RasterFormat.C1555) {
      out[o] = Math.round(((value >> 10) & 31) * (255 / 31));
      out[o + 1] = Math.round(((value >> 5) & 31) * (255 / 31));
      out[o + 2] = Math.round((value & 31) * (255 / 31));
      out[o + 3] = value & 0x8000 ? 255 : 0;
    } else {
      // C4444: A4R4G4B4 — 4-bit channels scale by 17 (0xF → 255).
      out[o] = ((value >> 8) & 15) * 17;
      out[o + 1] = ((value >> 4) & 15) * 17;
      out[o + 2] = (value & 15) * 17;
      out[o + 3] = ((value >> 12) & 15) * 17;
    }
  }

  return out;
}

/** Expand 8-bit palette indices to RGBA using a BGRA colour table. */
function expandPalette(indices: Uint8Array, palette: Uint8Array): Uint8Array {
  const out = new Uint8Array(indices.length * 4);
  for (let i = 0; i < indices.length; i += 1) {
    const p = indices[i] * 4;
    out[i * 4 + 0] = palette[p + 2];
    out[i * 4 + 1] = palette[p + 1];
    out[i * 4 + 2] = palette[p + 0];
    out[i * 4 + 3] = palette[p + 3];
  }

  return out;
}

function findDictHeader(stream: BinaryStream): ChunkHeader | null {
  // Scan top-level chunks for the TexDictionary, like RW's RwStreamFindChunk — some mod/exporter TXDs
  // prepend an empty type-0 chunk before the dictionary, so it isn't always the very first chunk.
  stream.seek(0);
  while (stream.position + 12 <= stream.length) {
    const before = stream.position;
    const header = readChunkHeader(stream);
    if (header.type === RwSection.TEXTURE_DICTIONARY) {
      return header;
    }
    // Advance past this chunk; guard against a 0-size chunk (would otherwise spin in place).
    stream.seek(header.end > before ? header.end : before + 12);
  }

  return null;
}

/** A recovered texture is plausible if its name is printable ASCII and its dimensions are sane powers of two. */
function isSaneTexture(texture: RWTexture): boolean {
  const isPow2 = (value: number): boolean => value > 0 && value <= 4096 && (value & (value - 1)) === 0;
  if (!isPow2(texture.width) || !isPow2(texture.height) || texture.name.length === 0) {
    return false;
  }
  for (const char of texture.name) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) {
      return false;
    }
  }

  return true;
}

/** Parse a found TexDictionary: walk its TEXTURE_NATIVE children, with the inflated-size recovery. */
function parseDictionary(stream: BinaryStream, dictHeader: ChunkHeader): RWTexture[] {
  const struct = findChild(stream, dictHeader.dataStart, dictHeader.end, RwSection.STRUCT);
  const textures: RWTexture[] = [];
  forEachChild(stream, dictHeader.dataStart, dictHeader.end, (child) => {
    if (child.type === RwSection.TEXTURE_NATIVE) {
      const texture = parseTextureNative(stream, child);
      if (texture) {
        textures.push(texture);
      }
    }
  });

  // Anti-rip "inflated size" recovery (e.g. yosemite.txd): the dictionary declares more textures than the
  // boundary walk found because each TEXTURE_NATIVE's size is bloated to swallow the next. Re-read RW-style.
  if (struct) {
    stream.seek(struct.dataStart);
    const declared = stream.u16(); // numTextures (deviceId follows)
    if (textures.length < declared) {
      return recoverTextures(stream, dictHeader, struct.end, declared);
    }
  }

  return textures;
}

function parseTextureNative(stream: BinaryStream, header: ChunkHeader): null | RWTexture {
  const struct = findChild(stream, header.dataStart, header.end, RwSection.STRUCT);
  if (!struct) {
    return null;
  }

  stream.seek(struct.dataStart);
  stream.u32(); // platform id
  stream.u32(); // filter / addressing flags
  const name = stream.string(32);
  const maskName = stream.string(32);
  const rasterFormat = stream.u32();
  const d3dFormat = stream.u32();
  const width = stream.u16();
  const height = stream.u16();
  const depth = stream.u8();
  const numLevels = stream.u8();
  stream.u8(); // raster type
  const flags = stream.u8();
  const hasAlpha = (flags & 0x01) !== 0;

  const format = classifyFormat(d3dFormat, rasterFormat, depth);
  if (!format) {
    return null; // unsupported (e.g. 16-bit) — skip, chunk walker advances past it
  }

  // Palettized rasters carry a colour table before the mip data.
  let palette: null | Uint8Array = null;
  if (rasterFormat & RasterFormat.PAL8) {
    palette = stream.bytes(256 * 4);
  } else if (rasterFormat & RasterFormat.PAL4) {
    palette = stream.bytes(16 * 4);
  }

  const pixelFormat = rasterFormat & RasterFormat.PIXEL_FORMAT_MASK;
  const mipmaps = readMipmaps(stream, width, height, numLevels, format, palette, depth, pixelFormat);
  if (mipmaps.length === 0) {
    return null;
  }

  return {
    format: palette ? 'rgba8888' : format,
    hasAlpha,
    height,
    maskName,
    mipmaps,
    name,
    width,
  };
}

function readMipmaps(
  stream: BinaryStream,
  width: number,
  height: number,
  numLevels: number,
  format: RWTextureFormat,
  palette: null | Uint8Array,
  depth: number,
  pixelFormat: number,
): RWMipLevel[] {
  const mipmaps: RWMipLevel[] = [];
  let w = width;
  let h = height;
  for (let level = 0; level < numLevels; level += 1) {
    const size = stream.u32();
    const raw = stream.bytes(size);
    // SA TXDs often declare more mip levels than they store data for — the extra levels have size 0.
    // Skip empty levels: an empty compressed mip is rejected by WebGL ("Pixel data cannot be null").
    if (raw.length > 0) {
      let data = raw;
      if (palette) {
        data = expandPalette(raw, palette);
      } else if (format === 'rgba8888') {
        data = depth === 16 ? expand16(raw, pixelFormat) : swizzleBgraToRgba(raw);
      }
      mipmaps.push({ data, height: Math.max(1, h), width: Math.max(1, w) });
    }
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }

  return mipmaps;
}

/**
 * Recover textures from an anti-rip-locked stream that has no readable TexDictionary wrapper: byte-scan for
 * `TEXTURE_NATIVE` chunks (type 0x15 + a STRUCT child + a plausible RW stream version) and parse each. The
 * inner chunks keep intact sizes (only the outer wrapper is tampered), so they parse normally. Sanity-checked
 * (printable name + power-of-two dimensions) to avoid false hits in raster bytes; deduped by name.
 */
function recoverLockedTextures(stream: BinaryStream): RWTexture[] {
  const textures: RWTexture[] = [];
  const seen = new Set<string>();
  for (let position = 0; position + 16 <= stream.length; position += 1) {
    stream.seek(position);
    if (stream.u32() !== RwSection.TEXTURE_NATIVE) {
      continue;
    }
    const size = stream.u32();
    const version = stream.u32();
    if ((version & 0xffff) !== 0xffff) {
      continue; // not a real RW stream chunk header
    }
    stream.seek(position + 12);
    if (stream.u32() !== RwSection.STRUCT) {
      continue; // a TEXTURE_NATIVE's first child is always its raster STRUCT
    }
    const header: ChunkHeader = {
      dataStart: position + 12,
      end: Math.min(position + 12 + size, stream.length),
      size,
      type: RwSection.TEXTURE_NATIVE,
      version,
    };
    const texture = parseTextureNative(stream, header);
    if (texture && isSaneTexture(texture) && !seen.has(texture.name.toLowerCase())) {
      seen.add(texture.name.toLowerCase());
      textures.push(texture);
    }
  }

  return textures;
}

/** Re-read a texture dictionary by its declared count, RW-style ({@link recoverLockedList}), past the
 *  bloated TEXTURE_NATIVE sizes. Unparseable formats are skipped, as in the normal path. */
function recoverTextures(
  stream: BinaryStream,
  dictHeader: ChunkHeader,
  structEnd: number,
  declared: number,
): RWTexture[] {
  const textures: RWTexture[] = [];
  for (const header of recoverLockedList(
    stream,
    structEnd,
    dictHeader.end,
    declared,
    RwSection.TEXTURE_NATIVE,
    TEXTURE_CHILDREN,
  )) {
    const texture = parseTextureNative(stream, header);
    if (texture) {
      textures.push(texture);
    }
  }

  return textures;
}

/** Convert in-place a BGRA byte buffer to RGBA (returns a new buffer). */
function swizzleBgraToRgba(bgra: Uint8Array): Uint8Array {
  const out = new Uint8Array(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    out[i + 0] = bgra[i + 2];
    out[i + 1] = bgra[i + 1];
    out[i + 2] = bgra[i + 0];
    out[i + 3] = bgra[i + 3];
  }

  return out;
}
