import type { DxtFormat } from './dxt';

/**
 * DXT (S3TC / BCn) **encoder** — RGBA8888 → DXT1/3/5 (plan 010, Phase 2). Lets DXT textures keep their
 * compression when mips are added (no 8888 blow-up). A fast BC1 colour encoder (endpoints = the two RGB
 * pixels furthest apart, nearest-index assignment) + DXT3 explicit / DXT5 interpolated alpha. Quality is fine
 * for downsampled mip levels; it round-trips cleanly through {@link import('./dxt').decodeDxt}.
 */
export function encodeDxt(format: DxtFormat, rgba: Uint8Array, width: number, height: number): Uint8Array {
  const blockBytes = format === 'dxt1' ? 8 : 16;
  const blocksWide = Math.max(1, Math.ceil(width / 4));
  const blocksHigh = Math.max(1, Math.ceil(height / 4));
  const out = new Uint8Array(blocksWide * blocksHigh * blockBytes);
  let offset = 0;
  for (let by = 0; by < blocksHigh; by += 1) {
    for (let bx = 0; bx < blocksWide; bx += 1) {
      const block = gatherBlock(rgba, width, height, bx * 4, by * 4);
      if (format === 'dxt1') {
        encodeColorBlock(block, true, out, offset);
      } else {
        encodeAlpha(format, block, out, offset);
        encodeColorBlock(block, false, out, offset + 8);
      }
      offset += blockBytes;
    }
  }

  return out;
}

/** 4-colour BC1 palette (RGB) for endpoints `c0`/`c1`; index 3 is transparent in punch-through mode. */
function buildPalette(c0: number, c1: number, punch: boolean): [number, number, number][] {
  const e0 = from565(c0);
  const e1 = from565(c1);
  const mid = punch
    ? ([Math.round((e0[0] + e1[0]) / 2), Math.round((e0[1] + e1[1]) / 2), Math.round((e0[2] + e1[2]) / 2)] as const)
    : ([
        Math.round((2 * e0[0] + e1[0]) / 3),
        Math.round((2 * e0[1] + e1[1]) / 3),
        Math.round((2 * e0[2] + e1[2]) / 3),
      ] as const);
  const third: [number, number, number] = punch
    ? [0, 0, 0]
    : [Math.round((e0[0] + 2 * e1[0]) / 3), Math.round((e0[1] + 2 * e1[1]) / 3), Math.round((e0[2] + 2 * e1[2]) / 3)];

  return [e0, e1, [mid[0], mid[1], mid[2]], third];
}

function colorDistance(block: Uint8Array, i: number, j: number): number {
  const dr = block[i * 4] - block[j * 4];
  const dg = block[i * 4 + 1] - block[j * 4 + 1];
  const db = block[i * 4 + 2] - block[j * 4 + 2];

  return dr * dr + dg * dg + db * db;
}

/** DXT3 explicit (4-bit) or DXT5 interpolated (3-bit) alpha for a 16-pixel block, written at `base`. */
function encodeAlpha(format: 'dxt3' | 'dxt5', block: Uint8Array, out: Uint8Array, base: number): void {
  if (format === 'dxt3') {
    for (let i = 0; i < 16; i += 1) {
      out[base + (i >> 1)] |= Math.round(block[i * 4 + 3] / 17) << ((i & 1) * 4);
    }

    return;
  }

  let a0 = 0;
  let a1 = 255;
  for (let i = 0; i < 16; i += 1) {
    a0 = Math.max(a0, block[i * 4 + 3]);
    a1 = Math.min(a1, block[i * 4 + 3]);
  }
  if (a0 === a1) {
    if (a0 > 0) {
      a1 -= 1;
    } else {
      a0 = 1;
    }
  }
  const ramp = [a0, a1, 0, 0, 0, 0, 0, 0];
  for (let i = 1; i <= 6; i += 1) {
    ramp[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7);
  }
  out[base] = a0;
  out[base + 1] = a1;
  let bits = 0;
  for (let i = 0; i < 16; i += 1) {
    bits += nearestAlpha(ramp, block[i * 4 + 3]) * 2 ** (3 * i);
  }
  for (let k = 0; k < 6; k += 1) {
    out[base + 2 + k] = Math.floor(bits / 2 ** (8 * k)) & 0xff;
  }
}

/** BC1 colour block: furthest-pair endpoints + nearest-index. `dxt1` allows the 1-bit (punch-through) mode. */
function encodeColorBlock(block: Uint8Array, dxt1: boolean, out: Uint8Array, base: number): void {
  const punch = dxt1 && hasTransparent(block);
  let [c0, c1] = endpoints(block, punch);
  if (punch ? c0 > c1 : c0 < c1) {
    [c0, c1] = [c1, c0];
  }
  if (!punch && c0 === c1) {
    c1 = c0 > 0 ? c0 - 1 : c0;
    c0 = c0 > 0 ? c0 : 1;
  }
  const palette = buildPalette(c0, c1, punch);
  const usable = punch ? 3 : 4;
  let bits = 0;
  for (let i = 0; i < 16; i += 1) {
    let index = 0;
    if (punch && block[i * 4 + 3] < 128) {
      index = 3;
    } else {
      index = nearestColor(palette, block, i, usable);
    }
    bits |= (index & 3) << (i * 2);
  }
  out[base] = c0 & 0xff;
  out[base + 1] = (c0 >> 8) & 0xff;
  out[base + 2] = c1 & 0xff;
  out[base + 3] = (c1 >> 8) & 0xff;
  out[base + 4] = bits & 0xff;
  out[base + 5] = (bits >> 8) & 0xff;
  out[base + 6] = (bits >> 16) & 0xff;
  out[base + 7] = (bits >>> 24) & 0xff;
}

/** Endpoints = the two opaque pixels furthest apart in RGB (robust to off-diagonal colour axes, unlike a
 *  bounding box). Each returned as a 565 colour; equal when the block is a single colour. */
function endpoints(block: Uint8Array, punch: boolean): [number, number] {
  const opaque: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    if (!(punch && block[i * 4 + 3] < 128)) {
      opaque.push(i);
    }
  }
  if (opaque.length === 0) {
    return [0, 0];
  }
  let a = opaque[0];
  let b = opaque[0];
  let best = -1;
  for (let m = 0; m < opaque.length; m += 1) {
    for (let n = m + 1; n < opaque.length; n += 1) {
      const distance = colorDistance(block, opaque[m], opaque[n]);
      if (distance > best) {
        best = distance;
        a = opaque[m];
        b = opaque[n];
      }
    }
  }

  return [
    to565(block[a * 4], block[a * 4 + 1], block[a * 4 + 2]),
    to565(block[b * 4], block[b * 4 + 1], block[b * 4 + 2]),
  ];
}

function from565(value: number): [number, number, number] {
  return [
    Math.round(((value >> 11) & 31) * (255 / 31)),
    Math.round(((value >> 5) & 63) * (255 / 63)),
    Math.round((value & 31) * (255 / 31)),
  ];
}

/** Gather a 4×4 RGBA block, clamping out-of-bounds reads to the edge (partial edge blocks). */
function gatherBlock(rgba: Uint8Array, width: number, height: number, ox: number, oy: number): Uint8Array {
  const block = new Uint8Array(64);
  for (let i = 0; i < 16; i += 1) {
    const x = Math.min(ox + (i % 4), width - 1);
    const y = Math.min(oy + Math.floor(i / 4), height - 1);
    const src = (y * width + x) * 4;
    block.set(rgba.subarray(src, src + 4), i * 4);
  }

  return block;
}

function hasTransparent(block: Uint8Array): boolean {
  for (let i = 0; i < 16; i += 1) {
    if (block[i * 4 + 3] < 128) {
      return true;
    }
  }

  return false;
}

function nearestAlpha(ramp: readonly number[], alpha: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < 8; i += 1) {
    const distance = Math.abs(ramp[i] - alpha);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  return best;
}

function nearestColor(
  palette: readonly [number, number, number][],
  block: Uint8Array,
  pixel: number,
  usable: number,
): number {
  const r = block[pixel * 4];
  const g = block[pixel * 4 + 1];
  const b = block[pixel * 4 + 2];
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < usable; i += 1) {
    const dr = palette[i][0] - r;
    const dg = palette[i][1] - g;
    const db = palette[i][2] - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  return best;
}

function to565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}
