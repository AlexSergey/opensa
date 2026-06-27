import type { HdTree, Impostor, ImpostorCard, TreeLodConfig, Vec3 } from './types';

import { createRaster, rasterizeTriangle } from './raster';

/** Foliage cutout threshold (0–1) — fragments with combined alpha below this are dropped. */
const ALPHA_TEST = 0.5;

/**
 * Bake a tree's impostor: N crossed vertical cards around the trunk axis (Z-up). Each card is an orthographic
 * view of the HD mesh looking along its normal, fit tightly to that view's silhouette, rendered into one tile of
 * the per-tree atlas image. Returns the image + per-card placement/UV for the LOD DFF.
 */
export function renderImpostor(tree: HdTree, config: TreeLodConfig): Impostor {
  const count = config.cards;
  const cols = Math.ceil(Math.sqrt(count));
  const { height, tileH, tileW, width } = pickAtlasShape(tree, config, cols);
  const image = new Uint8Array(width * height * 4);
  const cx = (tree.bbox.min[0] + tree.bbox.max[0]) / 2;
  const cy = (tree.bbox.min[1] + tree.bbox.max[1]) / 2;
  const cards: ImpostorCard[] = [];

  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * i) / count;
    const tx = -Math.sin(angle);
    const ty = Math.cos(angle); // card tangent (horizontal, in-plane)
    const nx = Math.cos(angle);
    const ny = Math.sin(angle); // card normal (view direction)

    let uMin = Infinity;
    let uMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const triangle of tree.triangles) {
      for (const p of triangle.positions) {
        const u = (p[0] - cx) * tx + (p[1] - cy) * ty;
        uMin = Math.min(uMin, u);
        uMax = Math.max(uMax, u);
        zMin = Math.min(zMin, p[2]);
        zMax = Math.max(zMax, p[2]);
      }
    }
    const uSpan = Math.max(1e-3, uMax - uMin);
    const zSpan = Math.max(1e-3, zMax - zMin);

    const raster = createRaster(tileW, tileH);
    const toPx = (p: Vec3): [number, number, number] => {
      const u = (p[0] - cx) * tx + (p[1] - cy) * ty;
      const depth = (p[0] - cx) * nx + (p[1] - cy) * ny;

      return [((u - uMin) / uSpan) * (tileW - 1), ((zMax - p[2]) / zSpan) * (tileH - 1), depth];
    };
    for (const triangle of tree.triangles) {
      const texture = triangle.texture ? (tree.textures.get(triangle.texture) ?? null) : null;
      rasterizeTriangle(
        raster,
        {
          colors: triangle.colors,
          pixels: [toPx(triangle.positions[0]), toPx(triangle.positions[1]), toPx(triangle.positions[2])],
          uvs: triangle.uvs,
        },
        texture,
        ALPHA_TEST,
      );
    }

    const gx = (i % cols) * tileW;
    const gy = Math.floor(i / cols) * tileH;
    blit(image, width, raster.color, tileW, tileH, gx, gy);
    cards.push({ angle, uvRect: { h: tileH, w: tileW, x: gx, y: gy }, worldU: [uMin, uMax], worldZ: [zMin, zMax] });
  }

  return { bbox: tree.bbox, cards, height, image, name: `lod${tree.name}`, width };
}

/** Copy a `tileW×tileH` RGBA sub-image into `dst` (width `dstW`) at offset (`gx`, `gy`). */
function blit(
  dst: Uint8Array,
  dstW: number,
  src: Uint8Array,
  tileW: number,
  tileH: number,
  gx: number,
  gy: number,
): void {
  for (let y = 0; y < tileH; y += 1) {
    const dstRow = ((gy + y) * dstW + gx) * 4;
    const srcRow = y * tileW * 4;
    dst.set(src.subarray(srcRow, srcRow + tileW * 4), dstRow);
  }
}

/**
 * Atlas dimensions for a tree: square `textureSize²` normally, **portrait** `textureSize × 2·textureSize` when the
 * tree is taller than `aspectThreshold × its horizontal extent` — so a tall narrow tree gets twice the vertical
 * texels instead of squashing its silhouette into a square tile. Cards tile in the `cols × rows` grid.
 */
function pickAtlasShape(
  tree: HdTree,
  config: TreeLodConfig,
  cols: number,
): { height: number; tileH: number; tileW: number; width: number } {
  const spanX = tree.bbox.max[0] - tree.bbox.min[0];
  const spanY = tree.bbox.max[1] - tree.bbox.min[1];
  const spanZ = tree.bbox.max[2] - tree.bbox.min[2];
  const portrait = spanZ > config.aspectThreshold * Math.max(spanX, spanY, 1e-3);
  const tileW = Math.floor(config.textureSize / cols);

  return {
    height: portrait ? config.textureSize * 2 : config.textureSize,
    tileH: portrait ? tileW * 2 : tileW,
    tileW,
    width: config.textureSize,
  };
}
