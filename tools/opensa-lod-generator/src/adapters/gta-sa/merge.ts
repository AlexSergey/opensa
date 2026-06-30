import type { RWGeometry } from '@opensa/renderware/parsers/binary/types';
import type { MergedMesh, Quat, Vec3 } from '@opensa/sa-lod/mesh';
import type { ModelSource } from '@opensa/sa-lod/model-source';

import type { Cell } from '../../core/types';

/** Accumulates transformed geometry into parallel attribute arrays + per-texture index groups. */
class MeshBuilder {
  private readonly colors: number[] = [];
  private readonly groups = new Map<string, number[]>();
  private hasNight = false;
  private readonly nightColors: number[] = [];
  private readonly normals: number[] = [];
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];

  /** Append one raw geometry, transformed by `rotation` (quaternion) + `position`, offset to `origin`. */
  add(geometry: RWGeometry, rotation: Quat, position: Vec3, origin: Vec3): void {
    const base = this.positions.length / 3;
    const vertexCount = geometry.positions.length / 3;
    const uv = geometry.uvLayers[0] ?? null;
    for (let i = 0; i < vertexCount; i += 1) {
      const [wx, wy, wz] = rotate(
        rotation,
        geometry.positions[i * 3],
        geometry.positions[i * 3 + 1],
        geometry.positions[i * 3 + 2],
      );
      this.positions.push(wx + position[0] - origin[0], wy + position[1] - origin[1], wz + position[2] - origin[2]);
      this.pushNormal(geometry.normals, rotation, i);
      this.uvs.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
      this.pushColor(geometry.prelitColors, i);
      this.pushNightColor(geometry.nightColors, geometry.prelitColors, i);
    }
    for (const tri of geometry.triangles) {
      const texture = geometry.materials[tri.materialIndex]?.texture?.name.toLowerCase() ?? '';
      this.group(texture).push(base + tri.a, base + tri.b, base + tri.c);
    }
  }

  finish(): MergedMesh {
    return {
      colors: Uint8Array.from(this.colors),
      groups: [...this.groups].map(([texture, indices]) => ({ indices: Uint32Array.from(indices), texture })),
      // Only carry night colours when at least one source model had them — else the engine's day-at-night
      // fallback applies (writing night = day everywhere would just be redundant bytes).
      ...(this.hasNight ? { nightColors: Uint8Array.from(this.nightColors) } : {}),
      normals: Float32Array.from(this.normals),
      positions: Float32Array.from(this.positions),
      uvs: Float32Array.from(this.uvs),
    };
  }

  private group(texture: string): number[] {
    let indices = this.groups.get(texture);
    if (!indices) {
      indices = [];
      this.groups.set(texture, indices);
    }

    return indices;
  }

  private pushColor(prelit: null | Uint8Array, i: number): void {
    if (prelit) {
      this.colors.push(prelit[i * 4], prelit[i * 4 + 1], prelit[i * 4 + 2], prelit[i * 4 + 3]);
    } else {
      this.colors.push(255, 255, 255, 255); // opaque white where the source had no prelit
    }
  }

  /** Night prelit for vertex `i`: the source's night colours when present (marking the mesh as carrying them),
   *  else its day prelit, else opaque white — so a night-bearing cell isn't black where some models lacked it. */
  private pushNightColor(night: null | Uint8Array, day: null | Uint8Array, i: number): void {
    if (night) {
      this.hasNight = true;
    }
    const src = night ?? day;
    if (src) {
      this.nightColors.push(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3]);
    } else {
      this.nightColors.push(255, 255, 255, 255);
    }
  }

  private pushNormal(normals: Float32Array | null, rotation: Quat, i: number): void {
    if (normals) {
      const [nx, ny, nz] = rotate(rotation, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
      this.normals.push(nx, ny, nz);
    } else {
      this.normals.push(0, 0, 0); // re-derived by the downstream normals pass
    }
  }
}

/**
 * Merge a cell's instances into one cell-centre-relative, native Z-up mesh (Phase 1), triangles bucketed by
 * texture. Every instance's atomics are placed by their IPL transform — **rotation = the conjugate of the IPL
 * quaternion** (GTA stores its inverse; matches `build-region.ts`) — offset to the cell centre (small coords for
 * float precision; the cell-LOD inst places it back). The DFF **frame** transform is ignored, as the engine does
 * for map atomics (`build-clump.ts`). Decimation runs afterward on the whole merged cell (see `decimateMesh`), not
 * per model, so the simplifier shares one budget across surfaces — keeping coverage far higher than decimating each
 * model on its own (which over-thinned small models into holes).
 */
export function mergeCell(cell: Cell, cellSize: number, source: ModelSource): MergedMesh {
  const origin: Vec3 = [(cell.cx + 0.5) * cellSize, (cell.cy + 0.5) * cellSize, 0];
  const builder = new MeshBuilder();
  for (const instance of cell.instances) {
    const clump = source.load(instance.model);
    if (!clump) {
      continue;
    }
    for (const atomic of clump.atomics) {
      const geometry = clump.geometries[atomic.geometryIndex];
      if (geometry) {
        builder.add(geometry, conjugate(instance.rotation), instance.position, origin);
      }
    }
  }

  return builder.finish();
}

/** GTA IPL quaternions are the inverse of the standard convention — conjugate before use (cf. build-region). */
function conjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rotate `(vx,vy,vz)` by quaternion `q` (x,y,z,w): `v + 2w(qv×v) + 2qv×(qv×v)`. */
function rotate(q: Quat, vx: number, vy: number, vz: number): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);

  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
