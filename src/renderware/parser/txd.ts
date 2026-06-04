import { BinaryStream } from './binary-stream';
import { ChunkHeader, findChild, forEachChild } from './chunks';
import { D3dCompression, RasterFormat, RwSection } from './constants';
import { RWMipLevel, RWTexture, RWTextureDictionary, RWTextureFormat } from './types';

/**
 * Parse a RenderWare Texture Dictionary (.txd) into RWTextureDictionary.
 *
 * Supports the GTA SA D3D8/D3D9 Texture Native layout. Pixel formats handled:
 * DXT1/3/5 (kept as raw blocks), uncompressed 32-bit (8888), and 8-/4-bit
 * palettized (expanded to RGBA here). Textures whose format is not understood
 * are skipped rather than aborting the whole dictionary.
 */
export function parseTxd(buffer: ArrayBuffer): RWTextureDictionary {
  const stream = new BinaryStream(buffer);
  const dictHeader = readDictHeader(stream);

  const textures: RWTexture[] = [];
  forEachChild(stream, dictHeader.dataStart, dictHeader.end, (child) => {
    if (child.type === RwSection.TEXTURE_NATIVE) {
      const texture = parseTextureNative(stream, child);
      if (texture) {
        textures.push(texture);
      }
    }
  });

  return { textures };
}

function readDictHeader(stream: BinaryStream): ChunkHeader {
  const type = stream.u32();
  const size = stream.u32();
  const version = stream.u32();
  if (type !== RwSection.TEXTURE_DICTIONARY) {
    throw new Error(`Not a TXD: expected TexDictionary (0x16), got 0x${type.toString(16)}`);
  }
  return { type, size, version, dataStart: stream.position, end: stream.position + size };
}

function parseTextureNative(stream: BinaryStream, header: ChunkHeader): RWTexture | null {
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
  stream.u8(); // depth
  const numLevels = stream.u8();
  stream.u8(); // raster type
  const flags = stream.u8();
  const hasAlpha = (flags & 0x01) !== 0;

  const format = classifyFormat(d3dFormat, rasterFormat);
  if (!format) {
    return null; // unsupported (e.g. 16-bit) — skip, chunk walker advances past it
  }

  // Palettized rasters carry a colour table before the mip data.
  let palette: Uint8Array | null = null;
  if (rasterFormat & RasterFormat.PAL8) {
    palette = stream.bytes(256 * 4);
  } else if (rasterFormat & RasterFormat.PAL4) {
    palette = stream.bytes(16 * 4);
  }

  const mipmaps = readMipmaps(stream, width, height, numLevels, format, palette);
  if (mipmaps.length === 0) {
    return null;
  }

  return {
    name,
    maskName,
    width,
    height,
    format: palette ? 'rgba8888' : format,
    hasAlpha,
    mipmaps,
  };
}

/** Map RW format identifiers to the adapter's format tag, or null if unsupported. */
function classifyFormat(d3dFormat: number, rasterFormat: number): RWTextureFormat | null {
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
  if ((rasterFormat & RasterFormat.PIXEL_FORMAT_MASK) === RasterFormat.C8888) {
    return 'rgba8888';
  }
  return null;
}

function readMipmaps(
  stream: BinaryStream,
  width: number,
  height: number,
  numLevels: number,
  format: RWTextureFormat,
  palette: Uint8Array | null,
): RWMipLevel[] {
  const mipmaps: RWMipLevel[] = [];
  let w = width;
  let h = height;
  for (let level = 0; level < numLevels; level += 1) {
    const size = stream.u32();
    const raw = stream.bytes(size);
    let data = raw;
    if (palette) {
      data = expandPalette(raw, palette);
    } else if (format === 'rgba8888') {
      data = swizzleBgraToRgba(raw);
    }
    mipmaps.push({ width: Math.max(1, w), height: Math.max(1, h), data });
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return mipmaps;
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
