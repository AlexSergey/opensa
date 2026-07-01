import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { decodeDxt } from '@opensa/rw-codec/dxt';
import { describe, expect, it } from 'vitest';

import type { SourceTexture, TextureSource } from './texture-source';

import { encodeHalvedTxd, encodeLodTxd } from './encode-txd';

/** A solid-colour texture of the given size (opaque unless `alpha` given). */
function solid(size: number, r: number, g: number, b: number, alpha = 255): SourceTexture {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = alpha;
  }

  return { hasAlpha: alpha !== 255, height: size, rgba, width: size };
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
    it('round-trips downscaled, named, DXT-compressed textures (DXT1 opaque, DXT5 alpha)', () => {
      const textures = { grass: solid(128, 20, 180, 40), leaf: solid(64, 10, 90, 10, 128) };
      const txd = encodeLodTxd(['grass', 'leaf'], source(textures), 64);
      const parsed = parseTxd(toArrayBuffer(txd)).textures;

      expect(parsed.map((t) => t.name).sort()).toEqual(['grass', 'leaf']);
      const grass = parsed.find((t) => t.name === 'grass')!;
      const leaf = parsed.find((t) => t.name === 'leaf')!;
      expect(grass.format).toBe('dxt1'); // opaque → DXT1
      expect(leaf.format).toBe('dxt5'); // alpha → DXT5
      expect([grass.width, grass.height]).toEqual([64, 64]); // 128 → downscaled to the 64 budget
      expect(grass.mipmaps.length).toBeGreaterThan(1); // full mip chain

      // Decoded top-mip centre pixel ≈ the source colour (DXT is lossy: 565 endpoints).
      const decoded = decodeDxt('dxt1', grass.mipmaps[0].data, grass.width, grass.height);
      const mid = (grass.width * (grass.height / 2) + grass.width / 2) * 4;
      expect(Math.abs(decoded[mid] - 20)).toBeLessThanOrEqual(8);
      expect(Math.abs(decoded[mid + 1] - 180)).toBeLessThanOrEqual(8);
      expect(Math.abs(decoded[mid + 2] - 40)).toBeLessThanOrEqual(8);
    });
  });
});

describe('encodeHalvedTxd', () => {
  describe('negative cases', () => {
    it('never drops a dimension below 1px', () => {
      const txd = encodeHalvedTxd(['dot'], source({ dot: solid(1, 5, 5, 5) }), 3);
      const dot = parseTxd(toArrayBuffer(txd)).textures[0];
      expect([dot.width, dot.height]).toEqual([1, 1]);
    });
  });

  describe('positive cases', () => {
    it('halves each side per step (½ dim = ¼ area), DXT + mips', () => {
      const txd = encodeHalvedTxd(
        ['grass', 'leaf'],
        source({ grass: solid(128, 20, 180, 40), leaf: solid(64, 1, 2, 3, 128) }),
        1,
      );
      const parsed = parseTxd(toArrayBuffer(txd)).textures;
      const grass = parsed.find((t) => t.name === 'grass')!;
      const leaf = parsed.find((t) => t.name === 'leaf')!;

      expect([grass.width, grass.height]).toEqual([64, 64]); // 128 → ½
      expect([leaf.width, leaf.height]).toEqual([32, 32]); // 64 → ½
      expect(grass.format).toBe('dxt1'); // opaque
      expect(leaf.format).toBe('dxt5'); // alpha
      expect(grass.mipmaps.length).toBeGreaterThan(1);
    });

    it('applies multiple halving steps', () => {
      const txd = encodeHalvedTxd(['grass'], source({ grass: solid(128, 20, 180, 40) }), 2);
      const grass = parseTxd(toArrayBuffer(txd)).textures[0];
      expect([grass.width, grass.height]).toEqual([32, 32]); // 128 → ¼
    });
  });
});
