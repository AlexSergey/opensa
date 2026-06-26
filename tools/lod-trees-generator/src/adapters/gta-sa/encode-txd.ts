import type { RwChunk } from '@opensa/rw-codec/chunk';

import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';
import { buildMipChain } from '@opensa/rw-codec/mip';
import { encodeRgba8888Struct } from '@opensa/rw-codec/texture-native';

import type { Impostor } from '../../core';

const PLATFORM_D3D9 = 9;
const FILTER_LINEAR = 0x1102; // linear + wrap/wrap addressing
const RASTER_TYPE_TEXTURE = 4;

/**
 * Pack every impostor image into one shared TXD (like `LODvegetation.txd`): one named texture (`lod<Name>`) per
 * tree, A8R8G8B8 + full mip chain (lossless; the engine reads it directly). `version` is the source game's RW
 * library version (taken from the template DFF) so the TXD matches.
 */
export function encodeAtlasTxd(impostors: Impostor[], version: number): Uint8Array {
  const struct = new Uint8Array(4);
  new DataView(struct.buffer).setUint16(0, impostors.length, true); // textureCount; deviceId stays 0 (any)

  const dictionary: RwChunk = {
    children: [
      { data: struct, type: RW_STRUCT, version },
      ...impostors.map((impostor) => textureNative(impostor, version)),
      { children: [], type: RW_EXTENSION, version },
    ],
    type: RW_TEXTURE_DICTIONARY,
    version,
  };

  return writeRw({ chunks: [dictionary], trailing: new Uint8Array(0) });
}

function textureHeader(name: string): Uint8Array {
  const header = new Uint8Array(88);
  const view = new DataView(header.buffer);
  view.setUint32(0, PLATFORM_D3D9, true);
  view.setUint32(4, FILTER_LINEAR, true);
  writeName(header, 8, name); // name[32]
  writeName(header, 40, name); // maskName[32]
  header[86] = RASTER_TYPE_TEXTURE;

  return header;
}

function textureNative(impostor: Impostor, version: number): RwChunk {
  const levels = buildMipChain(impostor.image, impostor.size, impostor.size);
  const struct = encodeRgba8888Struct(textureHeader(impostor.name), levels, true);

  return {
    children: [
      { data: struct, type: RW_STRUCT, version },
      { children: [], type: RW_EXTENSION, version },
    ],
    type: RW_TEXTURE_NATIVE,
    version,
  };
}

function writeName(out: Uint8Array, offset: number, name: string): void {
  for (let i = 0; i < Math.min(name.length, 31); i += 1) {
    out[offset + i] = name.charCodeAt(i);
  }
}
