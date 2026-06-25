/**
 * DXT (S3TC / BCn) **decoder** → RGBA8888 — the only "compression" code Phase 1 of the mipmap pass needs
 * (plan 010): DXT textures are decoded so they can be downsampled and re-stored uncompressed. Handles DXT1
 * (BC1), DXT3 (BC2, explicit 4-bit alpha) and DXT5 (BC3, interpolated alpha). Output is tightly-packed RGBA,
 * `width * height * 4` bytes, row-major.
 */

export type DxtFormat = 'dxt1' | 'dxt3' | 'dxt5';

export function decodeDxt(format: DxtFormat, data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const blockBytes = format === 'dxt1' ? 8 : 16;
  const blocksWide = Math.max(1, Math.ceil(width / 4));
  const blocksHigh = Math.max(1, Math.ceil(height / 4));
  let offset = 0;
  for (let by = 0; by < blocksHigh; by += 1) {
    for (let bx = 0; bx < blocksWide; bx += 1) {
      decodeBlock(format, data, offset, bx * 4, by * 4, width, height, out);
      offset += blockBytes;
    }
  }

  return out;
}

/** RGB565 (u16) → [r, g, b] bytes. */
function color565(value: number): [number, number, number] {
  return [
    Math.round(((value >> 11) & 31) * (255 / 31)),
    Math.round(((value >> 5) & 63) * (255 / 63)),
    Math.round((value & 31) * (255 / 31)),
  ];
}

/** The 4-entry colour palette for a BC1 colour block; index 3 is transparent when `dxt1 && c0 <= c1`. */
function colorPalette(c0: number, c1: number, dxt1: boolean): [number, number, number, number][] {
  const [r0, g0, b0] = color565(c0);
  const [r1, g1, b1] = color565(c1);
  const opaque = !dxt1 || c0 > c1;

  return [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    opaque
      ? [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3), 255]
      : [Math.round((r0 + r1) / 2), Math.round((g0 + g1) / 2), Math.round((b0 + b1) / 2), 255],
    opaque
      ? [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3), 255]
      : [0, 0, 0, 0],
  ];
}

/** DXT3 explicit (4-bit) or DXT5 interpolated (3-bit) per-pixel alpha for the 16 pixels of a block. */
function decodeAlpha(format: 'dxt3' | 'dxt5', data: Uint8Array, base: number): number[] {
  if (format === 'dxt3') {
    const out: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      const nibble = (data[base + (i >> 1)] >> ((i & 1) * 4)) & 0xf;
      out.push(nibble * 17);
    }

    return out;
  }

  const a0 = data[base];
  const a1 = data[base + 1];
  const ramp = [a0, a1, 0, 0, 0, 0, 0, 0];
  if (a0 > a1) {
    for (let i = 1; i <= 6; i += 1) {
      ramp[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7);
    }
  } else {
    for (let i = 1; i <= 4; i += 1) {
      ramp[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5);
    }
    ramp[6] = 0;
    ramp[7] = 255;
  }

  let bits = 0;
  for (let i = 0; i < 6; i += 1) {
    bits += data[base + 2 + i] * 2 ** (8 * i);
  }
  const out: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    out.push(ramp[Math.floor(bits / 2 ** (3 * i)) & 7]);
  }

  return out;
}

/** Decode one 4×4 block (alpha first for DXT3/5, then the BC1 colour part) into `out`. */
function decodeBlock(
  format: DxtFormat,
  data: Uint8Array,
  base: number,
  px: number,
  py: number,
  width: number,
  height: number,
  out: Uint8Array,
): void {
  const alpha = format === 'dxt1' ? null : decodeAlpha(format, data, base);
  const colorBase = format === 'dxt1' ? base : base + 8;
  const c0 = data[colorBase] | (data[colorBase + 1] << 8);
  const c1 = data[colorBase + 2] | (data[colorBase + 3] << 8);
  const palette = colorPalette(c0, c1, format === 'dxt1');
  const bits =
    data[colorBase + 4] | (data[colorBase + 5] << 8) | (data[colorBase + 6] << 16) | (data[colorBase + 7] << 24);

  for (let i = 0; i < 16; i += 1) {
    const x = px + (i % 4);
    const y = py + Math.floor(i / 4);
    if (x >= width || y >= height) {
      continue;
    }
    const color = palette[(bits >>> (i * 2)) & 3];
    const o = (y * width + x) * 4;
    out[o] = color[0];
    out[o + 1] = color[1];
    out[o + 2] = color[2];
    out[o + 3] = alpha ? alpha[i] : color[3];
  }
}
