import type { Object3D } from 'three';

import { DynamicDrawUsage, InstancedMesh, Matrix4 } from 'three';

import type { RenderPart } from './build-clump';

/**
 * 2dfx escalators (plan 044): moving step rows along the path baked into the host model.
 * Each placed escalator becomes one InstancedMesh per step-model part; steps loop along the
 * 3-segment polyline `start → bottom → top → end` (lower landing, incline, upper landing).
 * Like SA, steps stay horizontal — on the incline consecutive steps form the staircase, on the
 * landings their bodies sink under the floor (only the tread shows, vanishing at the comb).
 *
 * Registry pattern mirrors {@link registerAnimatedObject}: rigs register at cell build; the
 * game loop drives {@link updateEscalators}; detached rigs (streamed-out cells) are skipped.
 */

/** One placed escalator: world-space (GTA Z-up) path points + travel direction. */
export interface EscalatorPathEntry {
  /** 1 = steps move up (start → end), 0 = down. */
  direction: number;
  /** start → bottom → top → end. */
  points: [Vec3, Vec3, Vec3, Vec3];
}

type Vec3 = [number, number, number];

/** SA escalator step travel speed, m/s (vanilla-feel; steps cross a landing in ~4 s). */
const STEP_SPEED = 0.45;

interface EscalatorRig {
  count: number;
  meshes: InstancedMesh[];
  /** Yaw aligning the step model's +Y travel axis with the path (fixed per escalator). */
  rotation: Matrix4;
  segments: PathSegment[];
  spacing: number;
  /** Signed speed (m/s) — negative when the escalator runs down. */
  speed: number;
  total: number;
  /** Lifts the step so its tread (bbox top) sits on the path line. */
  zOffset: number;
}

interface PathSegment {
  direction: Vec3; // unit
  length: number;
  origin: Vec3;
}

const rigs: EscalatorRig[] = [];

const stepMatrix = new Matrix4();

/**
 * Build the moving steps for a set of placed escalators: one InstancedMesh per (escalator,
 * step-model part), registered for {@link updateEscalators}. Degenerate paths and empty step
 * models build nothing.
 */
export function buildEscalatorSteps(parts: readonly RenderPart[], entries: readonly EscalatorPathEntry[]): Object3D[] {
  if (parts.length === 0 || entries.length === 0) {
    return [];
  }
  // The step model is authored travel-along-+Y, width X, vertical Z (like its host escalators).
  if (!parts[0].geometry.boundingBox) {
    parts[0].geometry.computeBoundingBox();
  }
  const box = parts[0].geometry.boundingBox;
  if (!box) {
    return [];
  }
  const depth = box.max.y - box.min.y;
  if (depth <= 0.01) {
    return [];
  }

  const objects: Object3D[] = [];
  for (const entry of entries) {
    const segments = pathSegments(entry.points);
    const total = segments.reduce((sum, segment) => sum + segment.length, 0);
    if (segments.length === 0 || total < depth * 2) {
      continue;
    }
    const count = Math.max(2, Math.floor(total / depth));
    // Incline horizontal heading orients every step (the whole path is straight in plan view).
    const incline = segments[Math.min(1, segments.length - 1)];
    const yaw = Math.atan2(incline.direction[1], incline.direction[0]) - Math.PI / 2;

    const meshes = parts.map((part) => {
      const mesh = new InstancedMesh(part.geometry, part.material, count);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false; // matrices move every frame; a handful of rigs world-wide
      mesh.name = 'escalator-steps';

      return mesh;
    });
    rigs.push({
      count,
      meshes,
      rotation: new Matrix4().makeRotationZ(yaw),
      segments,
      spacing: total / count, // exact division — no pop at the loop seam
      speed: entry.direction === 1 ? STEP_SPEED : -STEP_SPEED,
      total,
      zOffset: -box.max.z,
    });
    objects.push(...meshes);
  }

  return objects;
}

/** Test hook: drop all registered rigs (the registry is module-level shared state). */
export function resetEscalators(): void {
  rigs.length = 0;
}

/** Advance every attached escalator's steps to wall-clock `time` (detached = streamed out → paused). */
export function updateEscalators(time: number): void {
  for (const rig of rigs) {
    if (!rig.meshes[0].parent) {
      continue;
    }
    const travel = time * rig.speed;
    for (let i = 0; i < rig.count; i += 1) {
      const s = wrap(i * rig.spacing + travel, rig.total);
      const [x, y, z] = samplePath(rig.segments, s);
      stepMatrix.copy(rig.rotation).setPosition(x, y, z + rig.zOffset);
      for (const mesh of rig.meshes) {
        mesh.setMatrixAt(i, stepMatrix);
      }
    }
    for (const mesh of rig.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function pathSegments(points: readonly Vec3[]): PathSegment[] {
  const segments: PathSegment[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, ay, az] = points[i];
    const [bx, by, bz] = points[i + 1];
    const length = Math.hypot(bx - ax, by - ay, bz - az);
    if (length < 0.01) {
      continue; // degenerate segment (coincident points)
    }
    segments.push({
      direction: [(bx - ax) / length, (by - ay) / length, (bz - az) / length],
      length,
      origin: points[i],
    });
  }

  return segments;
}

function samplePath(segments: readonly PathSegment[], s: number): Vec3 {
  let remaining = s;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      return [
        segment.origin[0] + segment.direction[0] * remaining,
        segment.origin[1] + segment.direction[1] * remaining,
        segment.origin[2] + segment.direction[2] * remaining,
      ];
    }
    remaining -= segment.length;
  }
  const last = segments[segments.length - 1];

  return [
    last.origin[0] + last.direction[0] * last.length,
    last.origin[1] + last.direction[1] * last.length,
    last.origin[2] + last.direction[2] * last.length,
  ];
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}
