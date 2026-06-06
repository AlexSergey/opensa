import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  type Texture,
} from 'three';

import type { WaterQuad } from '../parsers/text/water.parser';

/** World units per texture repeat (UVs tile from world X/Y). */
const TILE = 16;
const OPACITY = 0.7;

/**
 * Build a single merged water surface mesh from parsed {@link WaterQuad}s. Each
 * quad becomes two triangles (a triangle one), UVs tile from world X/Y so the
 * texture repeats across the map, and the whole thing is one unlit, translucent,
 * double-sided {@link MeshBasicMaterial} (no shader). Native GTA Z-up — the caller
 * parents it under a −90°X group.
 */
export function buildWater(quads: readonly WaterQuad[], texture: Texture): Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];

  for (const quad of quads) {
    const base = positions.length / 3;
    for (const [x, y, z] of quad.vertices) {
      positions.push(x, y, z);
      uvs.push(x / TILE, y / TILE);
    }
    if (quad.vertices.length >= 4) {
      // water.dat corners are grid-ordered (v0, +X, +Y, +X+Y) → two triangles.
      index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    } else {
      index.push(base, base + 1, base + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();

  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;

  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ depthWrite: false, map: texture, opacity: OPACITY, side: DoubleSide, transparent: true }),
  );
  mesh.name = 'Water';

  return mesh;
}
