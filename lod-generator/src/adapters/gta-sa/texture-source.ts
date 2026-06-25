import type { Archive } from './io';

import { decodeDxt, type DxtFormat } from '../../../../map-optimizer/src/adapters/gta-sa/codec/dxt';
import { parseTxd } from '../../../../src/renderware/parsers/binary/txd';

/** A decoded source texture: top-mip RGBA8888 + dimensions. */
export interface SourceTexture {
  hasAlpha: boolean;
  height: number;
  rgba: Uint8Array;
  width: number;
}

/** Resolves a texture name to its decoded RGBA, loaded from the archives' TXDs and cached. */
export interface TextureSource {
  get(name: string): null | SourceTexture;
}

/**
 * Build a {@link TextureSource} over every TXD in the archives (Phase 2a). On first use it indexes all
 * `TEXTURE_NATIVE`s by name (read-only reuse of the engine `parseTxd`); `get` decodes the requested texture's
 * top mip to RGBA (DXT via the map-optimizer decoder, or raw rgba8888) and memoizes it. Missing / unparseable
 * textures resolve to null so the atlas can fall back. First TXD wins on a name clash.
 */
interface IndexedTexture {
  format: string;
  hasAlpha: boolean;
  height: number;
  mip: Uint8Array;
  width: number;
}

export function createTextureSource(archives: readonly Archive[]): TextureSource {
  const index = new Map<string, IndexedTexture>();
  const cache = new Map<string, null | SourceTexture>();
  let indexed = false;

  const buildIndex = (): void => {
    for (const archive of archives) {
      for (const name of archive.names.filter((entry) => entry.toLowerCase().endsWith('.txd'))) {
        const buffer = archive.get(name);
        if (buffer) {
          indexDictionary(buffer, index);
        }
      }
    }
    indexed = true;
  };

  return {
    get(name: string): null | SourceTexture {
      if (!indexed) {
        buildIndex();
      }
      const key = name.toLowerCase();
      const cached = cache.get(key);
      if (cached !== undefined || cache.has(key)) {
        return cached ?? null;
      }
      const entry = index.get(key);
      const texture = entry ? decode(entry) : null;
      cache.set(key, texture);

      return texture;
    },
  };
}

function decode(entry: IndexedTexture): null | SourceTexture {
  try {
    const rgba =
      entry.format === 'rgba8888'
        ? entry.mip
        : decodeDxt(entry.format as DxtFormat, entry.mip, entry.width, entry.height);

    return { hasAlpha: entry.hasAlpha, height: entry.height, rgba, width: entry.width };
  } catch {
    return null;
  }
}

function indexDictionary(buffer: ArrayBuffer, index: Map<string, IndexedTexture>): void {
  let textures;
  try {
    textures = parseTxd(buffer).textures;
  } catch {
    return; // unreadable TXD — skip
  }
  for (const texture of textures) {
    const key = texture.name.toLowerCase();
    if (!index.has(key) && texture.mipmaps.length > 0) {
      index.set(key, {
        format: texture.format,
        hasAlpha: texture.hasAlpha,
        height: texture.height,
        mip: texture.mipmaps[0].data,
        width: texture.width,
      });
    }
  }
}
