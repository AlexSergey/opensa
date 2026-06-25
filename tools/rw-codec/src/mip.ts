/**
 * Mipmap downsampling on tightly-packed RGBA buffers (plan 010). A 2×2 box average per level, halving each
 * dimension (min 1), down to 1×1. Simple linear average for now; sRGB-correct averaging is a cheap follow-up.
 */

/** One RGBA level: tightly-packed `width * height * 4` bytes. */
export interface MipLevel {
  data: Uint8Array;
  height: number;
  width: number;
}

/** The full chain starting at the given base level (inclusive), down to 1×1. */
export function buildMipChain(base: Uint8Array, width: number, height: number): MipLevel[] {
  const levels: MipLevel[] = [{ data: base, height, width }];
  let current = levels[0];
  while (current.width > 1 || current.height > 1) {
    current = downsample(current.data, current.width, current.height);
    levels.push(current);
  }

  return levels;
}

/** Halve an RGBA image (2×2 box average), each dimension floored at 1. */
export function downsample(rgba: Uint8Array, width: number, height: number): MipLevel {
  const dstWidth = Math.max(1, width >> 1);
  const dstHeight = Math.max(1, height >> 1);
  const data = new Uint8Array(dstWidth * dstHeight * 4);

  for (let y = 0; y < dstHeight; y += 1) {
    for (let x = 0; x < dstWidth; x += 1) {
      const x0 = Math.min(x * 2, width - 1);
      const x1 = Math.min(x * 2 + 1, width - 1);
      const y0 = Math.min(y * 2, height - 1);
      const y1 = Math.min(y * 2 + 1, height - 1);
      const dst = (y * dstWidth + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        data[dst + c] = Math.round(
          (rgba[(y0 * width + x0) * 4 + c] +
            rgba[(y0 * width + x1) * 4 + c] +
            rgba[(y1 * width + x0) * 4 + c] +
            rgba[(y1 * width + x1) * 4 + c]) /
            4,
        );
      }
    }
  }

  return { data, height: dstHeight, width: dstWidth };
}
