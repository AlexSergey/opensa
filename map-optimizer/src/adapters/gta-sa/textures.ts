import type { RwChunk } from './codec/chunk';
import type { DxtFormat } from './codec/dxt';

import { parseTxd } from '../../../../src/renderware/parsers/binary/txd';
import { buildMipChain } from '../../lib/mip';
import { readRw, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from './codec/chunk';
import { decodeDxt } from './codec/dxt';
import { encodeDxt } from './codec/dxt-encode';
import { encodeRgba8888Struct, encodeSameFormatStruct, readTextureName } from './codec/texture-native';

const DXT_FORMATS = new Set<string>(['dxt1', 'dxt3', 'dxt5']);

/** Outcome of optimizing one TXD: the rebuilt bytes + how many textures got mips vs were left as-is. */
export interface TxdResult {
  bytes: Uint8Array;
  processed: number;
  skipped: number;
}

/**
 * Generate mip chains for the single-level, power-of-two textures in a TXD and write them back natively
 * (DXT → uncompressed 8888; uncompressed → 8888 + mips). Textures left untouched keep their exact bytes (the
 * chunk codec preserves them). Decodes pixels via `../src` `parseTxd` read-only; matches the chunk tree's
 * TextureNatives to it **by name**.
 */
export function optimizeTxd(txdBytes: Uint8Array): TxdResult {
  const dictionary = parseTxd(toArrayBuffer(txdBytes));
  const byName = new Map(dictionary.textures.map((texture) => [texture.name.toLowerCase(), texture]));
  const file = readRw(txdBytes);
  let processed = 0;
  let skipped = 0;

  for (const native of textureNatives(file.chunks)) {
    const struct = native.children?.find((child) => child.type === RW_STRUCT && child.data);
    const texture = struct?.data ? byName.get(readTextureName(struct.data).toLowerCase()) : undefined;
    if (!struct?.data || !texture || !shouldMip(texture.mipmaps.length, texture.width, texture.height)) {
      skipped += 1;
      continue;
    }
    if (DXT_FORMATS.has(texture.format)) {
      const format = texture.format as DxtFormat;
      const rgba = buildMipChain(
        decodeDxt(format, texture.mipmaps[0].data, texture.width, texture.height),
        texture.width,
        texture.height,
      );
      // Keep the original base level (lossless); re-encode only the downsampled mips to the same DXT format.
      const levels = [
        { data: texture.mipmaps[0].data },
        ...rgba.slice(1).map((level) => ({ data: encodeDxt(format, level.data, level.width, level.height) })),
      ];
      struct.data = encodeSameFormatStruct(struct.data, levels);
    } else {
      struct.data = encodeRgba8888Struct(
        struct.data,
        buildMipChain(texture.mipmaps[0].data, texture.width, texture.height),
        texture.hasAlpha,
      );
    }
    processed += 1;
  }

  return { bytes: writeRw(file), processed, skipped };
}

function isPow2(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/** A texture earns mips when it has exactly one stored level, is power-of-two, and isn't already 1×1. */
function shouldMip(levelCount: number, width: number, height: number): boolean {
  return levelCount === 1 && isPow2(width) && isPow2(height) && (width > 1 || height > 1);
}

function textureNatives(chunks: readonly RwChunk[]): RwChunk[] {
  const natives: RwChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.type === RW_TEXTURE_DICTIONARY) {
      for (const child of chunk.children ?? []) {
        if (child.type === RW_TEXTURE_NATIVE) {
          natives.push(child);
        }
      }
    }
  }

  return natives;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
