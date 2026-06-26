import type { RwChunk } from '@opensa/rw-codec/chunk';

import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';
import { encodeDxt } from '@opensa/rw-codec/dxt-encode';
import { buildMipChain } from '@opensa/rw-codec/mip';

import type { Impostor } from '../../core';

const PLATFORM_D3D9 = 9;
const FILTER_LINEAR_MIP = 0x1106; // trilinear + wrap/wrap addressing
const RASTER_TYPE_TEXTURE = 4;
const HEADER_SIZE = 88;
// DXT5 raster header (matches `LODvegetation.txd`): A8R8G8B8 raster format + mipmap flag, d3dFormat "DXT5".
const RASTER_8888_MIP = 0x8300;
const D3DFMT_DXT5 = 0x35545844;
const DXT_DEPTH = 16;
const FLAGS_DXT_ALPHA = 0x09;

/**
 * Pack every impostor image into one shared TXD (like `LODvegetation.txd`): one named texture (`lod<Name>`) per
 * tree, **DXT5** + full mip chain. DXT5 (not raw A8R8G8B8) is essential: 286 × 256² uncompressed is ~95 MB and
 * SA fails to load it; DXT5 brings it to a few MB, matching the reference LOD mod. `version` is the source game's
 * RW library version (from the template DFF) so the TXD matches.
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

/** A TextureNative Struct holding the DXT5-compressed mip chain for one impostor. */
function encodeDxt5Struct(
  name: string,
  levels: readonly { data: Uint8Array; height: number; width: number }[],
): Uint8Array {
  const blocks = levels.map((level) => encodeDxt('dxt5', level.data, level.width, level.height));
  const dataSize = blocks.reduce((sum, block) => sum + 4 + block.length, 0);
  const out = new Uint8Array(HEADER_SIZE + dataSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, PLATFORM_D3D9, true);
  view.setUint32(4, FILTER_LINEAR_MIP, true);
  writeName(out, 8, name); // name[32]
  writeName(out, 40, name); // maskName[32]
  view.setUint32(72, RASTER_8888_MIP, true);
  view.setUint32(76, D3DFMT_DXT5, true);
  view.setUint16(80, levels[0].width, true);
  view.setUint16(82, levels[0].height, true);
  out[84] = DXT_DEPTH;
  out[85] = levels.length;
  out[86] = RASTER_TYPE_TEXTURE;
  out[87] = FLAGS_DXT_ALPHA;

  let offset = HEADER_SIZE;
  for (const block of blocks) {
    view.setUint32(offset, block.length, true);
    offset += 4;
    out.set(block, offset);
    offset += block.length;
  }

  return out;
}

function textureNative(impostor: Impostor, version: number): RwChunk {
  const levels = buildMipChain(impostor.image, impostor.size, impostor.size);

  return {
    children: [
      { data: encodeDxt5Struct(impostor.name, levels), type: RW_STRUCT, version },
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
