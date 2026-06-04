import {
  CompressedTexture,
  DataTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT3_Format,
  SRGBColorSpace,
} from 'three';
import { describe, expect, it } from 'vitest';

import type { RWTexture, RWTextureDictionary } from '../parser/types';

import { buildTextureMap } from './build-texture';

function dictionary(textures: RWTexture[]): RWTextureDictionary {
  return { textures };
}

function texture(partial: Partial<RWTexture> & Pick<RWTexture, 'format' | 'name'>): RWTexture {
  return {
    hasAlpha: false,
    height: 4,
    maskName: '',
    mipmaps: [{ data: new Uint8Array(8), height: 4, width: 4 }],
    width: 4,
    ...partial,
  };
}

describe('buildTextureMap', () => {
  it('keys textures by lowercased name', () => {
    const map = buildTextureMap(dictionary([texture({ format: 'dxt1', name: 'Tree_Branches44' })]));
    expect(map.has('tree_branches44')).toBe(true);
  });

  it('builds a CompressedTexture for DXT formats with the matching GL format', () => {
    const map = buildTextureMap(
      dictionary([texture({ format: 'dxt1', name: 'a' }), texture({ format: 'dxt3', hasAlpha: true, name: 'b' })]),
    );
    const a = map.get('a') as CompressedTexture;
    const b = map.get('b') as CompressedTexture;
    expect(a).toBeInstanceOf(CompressedTexture);
    expect(a.format).toBe(RGBA_S3TC_DXT1_Format);
    expect(b.format).toBe(RGBA_S3TC_DXT3_Format);
  });

  it('builds a DataTexture for uncompressed 32-bit textures', () => {
    const map = buildTextureMap(
      dictionary([
        texture({ format: 'rgba8888', mipmaps: [{ data: new Uint8Array(4), height: 1, width: 1 }], name: 'raw' }),
      ]),
    );
    expect(map.get('raw')).toBeInstanceOf(DataTexture);
  });

  it('applies repeat wrapping, sRGB, unflipped Y and records alpha in userData', () => {
    const map = buildTextureMap(dictionary([texture({ format: 'dxt3', hasAlpha: true, name: 'a' })]));
    const tex = map.get('a')!;
    expect(tex.wrapS).toBe(RepeatWrapping);
    expect(tex.wrapT).toBe(RepeatWrapping);
    expect(tex.colorSpace).toBe(SRGBColorSpace);
    expect(tex.flipY).toBe(false);
    expect(tex.userData.hasAlpha).toBe(true);
  });

  it('enables trilinear filtering only when a mip chain is present', () => {
    const single = buildTextureMap(dictionary([texture({ format: 'dxt1', name: 'one' })])).get('one')!;
    const multi = buildTextureMap(
      dictionary([
        texture({
          format: 'dxt1',
          mipmaps: [
            { data: new Uint8Array(8), height: 4, width: 4 },
            { data: new Uint8Array(8), height: 2, width: 2 },
          ],
          name: 'many',
        }),
      ]),
    ).get('many')!;
    expect(multi.minFilter).toBe(LinearMipmapLinearFilter);
    expect(single.minFilter).toBe(single.magFilter);
  });
});
