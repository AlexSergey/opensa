import type { DecodedTexture, Rgba } from './types';

/**
 * A tiny software rasterizer: fills textured triangles into a shared RGBA image with a z-buffer + alpha. Used to
 * bake the impostor card views (orthographic, so UV/colour interpolate **affinely** — exact, no perspective
 * divide). Background stays α=0; the texture's own alpha drives the foliage cutout.
 */
export interface Raster {
  color: Uint8Array;
  depth: Float32Array;
  height: number;
  width: number;
}

/** A triangle already projected to image space: pixel `[x, y, depth]`, UV, and per-vertex colour (×3). */
export interface RasterTri {
  colors: [Rgba, Rgba, Rgba] | null;
  pixels: [Vec3px, Vec3px, Vec3px];
  uvs: [[number, number], [number, number], [number, number]];
}

type Vec3px = [number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];

export function createRaster(width: number, height: number): Raster {
  return {
    color: new Uint8Array(width * height * 4),
    depth: new Float32Array(width * height).fill(-Infinity),
    height,
    width,
  };
}

/** Rasterise one triangle. `alphaTest` (0–1) discards fragments below it (binary foliage cutout). */
export function rasterizeTriangle(
  raster: Raster,
  tri: RasterTri,
  texture: DecodedTexture | null,
  alphaTest: number,
): void {
  const [a, b, c] = tri.pixels;
  let area = edge(a, b, c);
  if (area === 0) {
    return; // degenerate
  }
  const flip = area < 0 ? -1 : 1;
  area *= flip;

  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(raster.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(raster.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const p: Vec3px = [x + 0.5, y + 0.5, 0];
      const w0 = edge(b, c, p) * flip;
      const w1 = edge(c, a, p) * flip;
      const w2 = edge(a, b, p) * flip;
      if (w0 < 0 || w1 < 0 || w2 < 0) {
        continue; // outside
      }
      const l0 = w0 / area;
      const l1 = w1 / area;
      const l2 = w2 / area;
      const depth = a[2] * l0 + b[2] * l1 + c[2] * l2;
      const di = y * raster.width + x;
      if (depth <= raster.depth[di]) {
        continue; // behind an already-drawn fragment
      }

      const colour = blend(tri, texture, l0, l1, l2);
      if (colour[3] < alphaTest * 255) {
        continue; // cutout
      }
      raster.depth[di] = depth;
      const o = di * 4;
      raster.color[o] = colour[0];
      raster.color[o + 1] = colour[1];
      raster.color[o + 2] = colour[2];
      raster.color[o + 3] = colour[3];
    }
  }
}

function blend(tri: RasterTri, texture: DecodedTexture | null, l0: number, l1: number, l2: number): Rgba {
  const u = tri.uvs[0][0] * l0 + tri.uvs[1][0] * l1 + tri.uvs[2][0] * l2;
  const v = tri.uvs[0][1] * l0 + tri.uvs[1][1] * l1 + tri.uvs[2][1] * l2;
  const tex = texture ? sample(texture, u, v) : WHITE;
  const vc = tri.colors ? lerpColor(tri.colors, l0, l1, l2) : WHITE;

  return [(tex[0] * vc[0]) / 255, (tex[1] * vc[1]) / 255, (tex[2] * vc[2]) / 255, (tex[3] * vc[3]) / 255];
}

function edge(p: Vec3px, q: Vec3px, r: Vec3px): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(colors: [Rgba, Rgba, Rgba], l0: number, l1: number, l2: number): Rgba {
  return [
    colors[0][0] * l0 + colors[1][0] * l1 + colors[2][0] * l2,
    colors[0][1] * l0 + colors[1][1] * l1 + colors[2][1] * l2,
    colors[0][2] * l0 + colors[1][2] * l1 + colors[2][2] * l2,
    colors[0][3] * l0 + colors[1][3] * l1 + colors[2][3] * l2,
  ];
}

/** Bilinear texture sample with wrapping (matches the engine's RepeatWrapping) — softens the impostor. */
function sample(texture: DecodedTexture, u: number, v: number): Rgba {
  const { height, rgba, width } = texture;
  const fx = (u - Math.floor(u)) * width - 0.5;
  const fy = (v - Math.floor(v)) * height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % width) + width) % width;
  const xb = (xa + 1) % width;
  const ya = ((y0 % height) + height) % height;
  const yb = (ya + 1) % height;

  const out: Rgba = [0, 0, 0, 0];
  for (let c = 0; c < 4; c += 1) {
    const top = lerp(rgba[(ya * width + xa) * 4 + c], rgba[(ya * width + xb) * 4 + c], tx);
    const bottom = lerp(rgba[(yb * width + xa) * 4 + c], rgba[(yb * width + xb) * 4 + c], tx);
    out[c] = lerp(top, bottom, ty);
  }

  return out;
}
