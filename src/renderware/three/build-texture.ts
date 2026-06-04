import {
  CompressedTexture,
  DataTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT3_Format,
  RGBA_S3TC_DXT5_Format,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
} from 'three';
import { RWTexture, RWTextureDictionary } from '../parser/types';

const DXT_FORMAT = {
  dxt1: RGBA_S3TC_DXT1_Format,
  dxt3: RGBA_S3TC_DXT3_Format,
  dxt5: RGBA_S3TC_DXT5_Format,
} as const;

/** Build a name-keyed (lowercased) map of three.js textures from a TXD. */
export function buildTextureMap(dict: RWTextureDictionary): Map<string, Texture> {
  const map = new Map<string, Texture>();
  for (const rw of dict.textures) {
    map.set(rw.name.toLowerCase(), buildTexture(rw));
  }
  return map;
}

function buildTexture(rw: RWTexture): Texture {
  const texture = rw.format === 'rgba8888' ? buildDataTexture(rw) : buildCompressedTexture(rw);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false; // compressed textures cannot be flipped; keep DDS-style orientation
  texture.name = rw.name;
  texture.userData.hasAlpha = rw.hasAlpha;
  texture.needsUpdate = true;
  return texture;
}

function buildCompressedTexture(rw: RWTexture): CompressedTexture {
  const format = DXT_FORMAT[rw.format as keyof typeof DXT_FORMAT];
  const mipmaps = rw.mipmaps.map((m) => ({ data: m.data, width: m.width, height: m.height }));
  const texture = new CompressedTexture(mipmaps, rw.width, rw.height, format, UnsignedByteType);
  // Only enable trilinear mipmapping when the chain is actually present.
  texture.minFilter = mipmaps.length > 1 ? LinearMipmapLinearFilter : texture.magFilter;
  return texture;
}

function buildDataTexture(rw: RWTexture): DataTexture {
  const base = rw.mipmaps[0];
  return new DataTexture(base.data, base.width, base.height, RGBAFormat, UnsignedByteType);
}
