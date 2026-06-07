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

/**
 * Open-ocean "frame" quads: a `[-half, half]` sea-level plane with a rectangular
 * hole cut to the bounding box of `quads` (the real water.dat extent). Lets the
 * actual water polygons cover the map (so tunnels under land aren't flooded) while
 * the frame still fills out to the horizon. Returns up to 4 border quads (any
 * degenerate strip — where the data already reaches `half` — is skipped).
 */
export function oceanFrame(quads: readonly WaterQuad[], half: number, level: number): WaterQuad[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const quad of quads) {
    for (const [x, y] of quad.vertices) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) {
    return [strip(-half, half, -half, half, level)]; // no data → solid plane
  }

  const frame: WaterQuad[] = [];
  pushStrip(frame, -half, minX, -half, half, level); // left (full height)
  pushStrip(frame, maxX, half, -half, half, level); // right (full height)
  pushStrip(frame, minX, maxX, -half, minY, level); // bottom (between the side strips)
  pushStrip(frame, minX, maxX, maxY, half, level); // top

  return frame;
}

function pushStrip(out: WaterQuad[], x0: number, x1: number, y0: number, y1: number, level: number): void {
  if (x1 > x0 && y1 > y0) {
    out.push(strip(x0, x1, y0, y1, level));
  }
}

/** A sea-level quad with grid-ordered corners (v0, +X, +Y, +X+Y) for {@link buildWater}. */
function strip(x0: number, x1: number, y0: number, y1: number, level: number): WaterQuad {
  return {
    vertices: [
      [x0, y0, level],
      [x1, y0, level],
      [x0, y1, level],
      [x1, y1, level],
    ],
  };
}
