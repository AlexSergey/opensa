import type { Impostor } from './types';

/** Flat geometry arrays for the LOD card cage — fed into the game adapter's DFF encoder. */
export interface CardGeometry {
  positions: Float32Array;
  prelit: Uint8Array;
  triangles: { a: number; b: number; c: number }[];
  uvs: Float32Array;
}

/**
 * Build the crossed-billboard geometry from a baked {@link Impostor}: per card, a quad spanning its world
 * extents (tangent `u` around the trunk centre, absolute `z`), UV-mapped to its atlas tile, doubled-sided so it
 * reads from both faces. Prelit is flat white — the atlas already has the HD lighting baked in.
 */
export function buildCardGeometry(impostor: Impostor): CardGeometry {
  const cx = (impostor.bbox.min[0] + impostor.bbox.max[0]) / 2;
  const cy = (impostor.bbox.min[1] + impostor.bbox.max[1]) / 2;
  const size = impostor.size;
  const positions: number[] = [];
  const uvs: number[] = [];
  const triangles: { a: number; b: number; c: number }[] = [];

  let base = 0;
  for (const card of impostor.cards) {
    const tx = -Math.sin(card.angle);
    const ty = Math.cos(card.angle);
    const [uMin, uMax] = card.worldU;
    const [zMin, zMax] = card.worldZ;
    const uL = card.uvRect.x / size;
    const uR = (card.uvRect.x + card.uvRect.w) / size;
    const vT = card.uvRect.y / size;
    const vB = (card.uvRect.y + card.uvRect.h) / size;

    // Corners: 0 = (uMin,zMax) TL, 1 = (uMax,zMax) TR, 2 = (uMin,zMin) BL, 3 = (uMax,zMin) BR.
    positions.push(cx + tx * uMin, cy + ty * uMin, zMax);
    positions.push(cx + tx * uMax, cy + ty * uMax, zMax);
    positions.push(cx + tx * uMin, cy + ty * uMin, zMin);
    positions.push(cx + tx * uMax, cy + ty * uMax, zMin);
    uvs.push(uL, vT, uR, vT, uL, vB, uR, vB);

    // Two triangles per face, both windings → double-sided.
    triangles.push({ a: base, b: base + 1, c: base + 2 }, { a: base + 2, b: base + 1, c: base + 3 });
    triangles.push({ a: base, b: base + 2, c: base + 1 }, { a: base + 2, b: base + 3, c: base + 1 });
    base += 4;
  }

  return {
    positions: new Float32Array(positions),
    prelit: new Uint8Array((positions.length / 3) * 4).fill(255),
    triangles,
    uvs: new Float32Array(uvs),
  };
}
