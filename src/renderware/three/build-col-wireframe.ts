import type { Object3D } from 'three';

import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three';

import type { RegionColliders } from '../collision';
import type { ColModel } from '../parsers/binary/col-types';
import type { Vec3 } from '../parsers/binary/types';

const COLLISION_COLOR = 0x00ff66;

const SPHERE_SEGMENTS = 12;

/**
 * Build a single wireframe overlay (one `LineSegments`, one draw call) for a set
 * of bound colliders: collision-triangle edges + box edges + sphere rings, with
 * each model's line set transformed by every placement of it. The result is in
 * native GTA model space (Z-up); the caller wraps it in the renderer's −90°X
 * group so it overlays the rendered models. Debug-only — for the whole map this
 * is heavy, so it is driven by the region the user is viewing.
 */
export function buildCollisionWireframe(colliders: RegionColliders[]): Object3D {
  const positions: number[] = [];
  const point = new Vector3();

  for (const { col, transforms } of colliders) {
    const lines = modelLines(col);
    for (const matrix of transforms) {
      for (let i = 0; i < lines.length; i += 3) {
        point.set(lines[i], lines[i + 1], lines[i + 2]).applyMatrix4(matrix);
        positions.push(point.x, point.y, point.z);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));

  return new LineSegments(geometry, new LineBasicMaterial({ color: COLLISION_COLOR }));
}

/** Flatten a collision model to line-segment endpoints in model space. */
function modelLines(col: ColModel): number[] {
  const out: number[] = [];
  const vertices = col.vertices;
  for (const face of col.faces) {
    pushEdge(out, vertices, face.a, face.b);
    pushEdge(out, vertices, face.b, face.c);
    pushEdge(out, vertices, face.c, face.a);
  }
  for (const box of col.boxes) {
    pushBox(out, box.min, box.max);
  }
  for (const sphere of col.spheres) {
    pushSphere(out, sphere.center, sphere.radius);
  }

  return out;
}

function pushBox(out: number[], min: Vec3, max: Vec3): void {
  const corners: Vec3[] = [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], max[2]],
    [min[0], max[1], max[2]],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  for (const [a, b] of edges) {
    out.push(...corners[a], ...corners[b]);
  }
}

function pushEdge(out: number[], vertices: Float32Array, i: number, j: number): void {
  out.push(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
  out.push(vertices[j * 3], vertices[j * 3 + 1], vertices[j * 3 + 2]);
}

function pushSphere(out: number[], center: Vec3, radius: number): void {
  for (let axis = 0; axis < 3; axis += 1) {
    for (let s = 0; s < SPHERE_SEGMENTS; s += 1) {
      const a0 = (s / SPHERE_SEGMENTS) * Math.PI * 2;
      const a1 = ((s + 1) / SPHERE_SEGMENTS) * Math.PI * 2;
      out.push(...ringPoint(center, radius, axis, a0), ...ringPoint(center, radius, axis, a1));
    }
  }
}

/** A point on the great circle around `axis` (0 = YZ, 1 = XZ, 2 = XY). */
function ringPoint(center: Vec3, radius: number, axis: number, angle: number): Vec3 {
  const u = Math.cos(angle) * radius;
  const w = Math.sin(angle) * radius;
  if (axis === 0) {
    return [center[0], center[1] + u, center[2] + w];
  }
  if (axis === 1) {
    return [center[0] + u, center[1], center[2] + w];
  }

  return [center[0] + u, center[1] + w, center[2]];
}
