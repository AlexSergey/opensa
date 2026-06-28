import type { RwChunk } from '@opensa/rw-codec/chunk';

import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_NATIVE } from '@opensa/rw-codec/chunk';
import { buildMipChain } from '@opensa/rw-codec/mip';
import { encodeDxtStruct } from '@opensa/rw-codec/texture-native';

import { decodePng } from './png-decode';

/**
 * Build a RenderWare `TextureNative` chunk from a PNG: pick **DXT5** when the image has any real alpha, else
 * **DXT1**; generate a full mip chain; DXT-compress each level. `version` is the host dictionary's RW version, so
 * the new texture stays consistent with the file it joins.
 */
export function pngToTextureNative(name: string, pngBytes: Uint8Array, version: number): RwChunk {
  const { height, rgba, width } = decodePng(pngBytes);
  const format = hasAlpha(rgba) ? 'dxt5' : 'dxt1';
  const levels = buildMipChain(rgba, width, height);

  return {
    children: [
      { data: encodeDxtStruct(name, format, levels), type: RW_STRUCT, version },
      { children: [], type: RW_EXTENSION, version },
    ],
    type: RW_TEXTURE_NATIVE,
    version,
  };
}

/** Any pixel with alpha < 255 ⇒ the texture needs a real alpha channel (DXT5). */
function hasAlpha(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) {
      return true;
    }
  }

  return false;
}
