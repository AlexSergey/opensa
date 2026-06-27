import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { describe, expect, it } from 'vitest';

import type { SourceTexture, TextureSource } from './texture-source';

import { encodeLodTxd } from './encode-txd';

/** A solid-colour RGBA texture of the given size. */
function solid(size: number, r: number, g: number, b: number): SourceTexture {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }

  return { hasAlpha: false, height: size, rgba, width: size };
}

function source(textures: Record<string, SourceTexture>): TextureSource {
  return { get: (name) => textures[name.toLowerCase()] ?? null };
}

describe('encodeLodTxd', () => {
  describe('negative cases', () => {
    it('skips names missing from the source, keeping the resolvable ones', () => {
      const txd = encodeLodTxd(['absent', 'road'], source({ road: solid(64, 1, 2, 3) }), 64);
      expect(parseTxd(toArrayBuffer(txd)).textures.map((t) => t.name)).toEqual(['road']);
    });
  });

  describe('positive cases', () => {
    it('round-trips the cell textures (downscaled, named) through the engine parser', () => {
      const textures = { grass: solid(128, 20, 180, 40), road: solid(256, 200, 100, 50) };
      const txd = encodeLodTxd(['road', 'grass'], source(textures), 64);
      const parsed = parseTxd(toArrayBuffer(txd)).textures;

      expect(parsed.map((t) => t.name).sort()).toEqual(['grass', 'road']);
      const road = parsed.find((t) => t.name === 'road')!;
      expect(road.width).toBe(64); // 256 → downscaled to the 64 budget
      expect(road.height).toBe(64);
      // Top-mip centre pixel keeps the source colour (RGBA round-trips through the BGRA store).
      const mid = (road.width * (road.height / 2) + road.width / 2) * 4;
      expect([road.mipmaps[0].data[mid], road.mipmaps[0].data[mid + 1], road.mipmaps[0].data[mid + 2]]).toEqual([
        200, 100, 50,
      ]);
    });
  });
});
