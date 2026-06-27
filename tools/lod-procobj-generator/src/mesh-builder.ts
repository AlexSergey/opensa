import type { RWClump, RWGeometry } from '@opensa/renderware/parsers/binary/types';
import type { MergedMesh, Vec3 } from '@opensa/sa-lod/mesh';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO: Vec3 = [0, 0, 0];

/** Mutable parallel attribute arrays accumulated across a clump's atomics. */
interface Attributes {
  colors: number[];
  normals: number[];
  positions: number[];
  uvs: number[];
}

/**
 * Build a **model-local** {@link MergedMesh} from a clump for the simplified-copy LOD: iterate the clump's
 * atomics and place each geometry by its **frame transform** (right/up/at basis + translation — so multi-atomic /
 * frame-offset models assemble correctly, mirroring the engine and `lod-trees-generator`'s bake). The instance's
 * world placement is applied later by the IPL `inst`, so the mesh stays model-local. Triangles are bucketed by
 * texture name; prelit defaults to opaque white; normals are frame-rotated (or zeroed for the normals pass).
 */
export function buildModelMesh(clump: RWClump): MergedMesh {
  const out: Attributes = { colors: [], normals: [], positions: [], uvs: [] };
  const groups = new Map<string, number[]>();

  for (const atomic of clump.atomics) {
    const geometry = clump.geometries[atomic.geometryIndex];
    if (!geometry) {
      continue;
    }
    const frame = clump.frames[atomic.frameIndex];
    const base = out.positions.length / 3;
    appendVertices(out, geometry, frame?.rotation ?? IDENTITY, frame?.position ?? ZERO);
    for (const tri of geometry.triangles) {
      const texture = geometry.materials[tri.materialIndex]?.texture?.name.toLowerCase() ?? '';
      bucket(groups, texture).push(base + tri.a, base + tri.b, base + tri.c);
    }
  }

  return {
    colors: Uint8Array.from(out.colors),
    groups: [...groups].map(([texture, indices]) => ({ indices: Uint32Array.from(indices), texture })),
    normals: Float32Array.from(out.normals),
    positions: Float32Array.from(out.positions),
    uvs: Float32Array.from(out.uvs),
  };
}

/** Axis-aligned bounds of a mesh's vertices (for the LOD's collision bounds + height gate). */
export function meshBounds(mesh: MergedMesh): { max: Vec3; min: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.positions[i + axis]);
      max[axis] = Math.max(max[axis], mesh.positions[i + axis]);
    }
  }

  return { max, min };
}

/** Append one geometry's frame-transformed vertices (position/normal/uv/colour) to the accumulator. */
function appendVertices(out: Attributes, geometry: RWGeometry, r: readonly number[], t: Vec3): void {
  const count = geometry.positions.length / 3;
  const uv = geometry.uvLayers[0] ?? null;
  const prelit = geometry.prelitColors;
  const norm = geometry.normals;
  for (let i = 0; i < count; i += 1) {
    const x = geometry.positions[i * 3];
    const y = geometry.positions[i * 3 + 1];
    const z = geometry.positions[i * 3 + 2];
    out.positions.push(
      r[0] * x + r[3] * y + r[6] * z + t[0],
      r[1] * x + r[4] * y + r[7] * z + t[1],
      r[2] * x + r[5] * y + r[8] * z + t[2],
    );
    if (norm) {
      const nx = norm[i * 3];
      const ny = norm[i * 3 + 1];
      const nz = norm[i * 3 + 2];
      out.normals.push(
        r[0] * nx + r[3] * ny + r[6] * nz,
        r[1] * nx + r[4] * ny + r[7] * nz,
        r[2] * nx + r[5] * ny + r[8] * nz,
      );
    } else {
      out.normals.push(0, 0, 0);
    }
    out.uvs.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
    if (prelit) {
      out.colors.push(prelit[i * 4], prelit[i * 4 + 1], prelit[i * 4 + 2], prelit[i * 4 + 3]);
    } else {
      out.colors.push(255, 255, 255, 255);
    }
  }
}

function bucket(groups: Map<string, number[]>, texture: string): number[] {
  let indices = groups.get(texture);
  if (!indices) {
    indices = [];
    groups.set(texture, indices);
  }

  return indices;
}
