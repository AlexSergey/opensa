import type { Matrix4 } from 'three';

import { Vector3 } from 'three';

import type { RegionColliders } from '../collision';
import type { ColFace } from '../parsers/binary/col-types';
import type { ProcObjRule } from '../parsers/text';
import type { ProcObjCategoryName } from './procobj-categories';

import { procObjCategory } from './procobj-categories';

/**
 * Deterministic procobj scatter (plan 042, iteration 3b): turn one cell's collision faces into
 * ground-clutter placements per `procobj.dat`. Pure — same colliders + rules + cell coords give
 * byte-identical output, so streamed cells never "reshuffle" between visits or sessions.
 *
 * Density headroom: vanilla density is 1; the debug slider dials 0–{@link PROC_OBJ_MAX_DENSITY}.
 * We generate `MAX_DENSITY ×` the vanilla count of candidates, give each a `lottery` value
 * uniform in [0, MAX_DENSITY) and sort each batch by it — the renderer then shows exactly the
 * instances with `lottery < density` via a plain instance-count cutoff (no rebuild on the knob).
 *
 * Vanilla's MINDIST column (create-around-the-camera radius in SA's streaming CProcObjectMan) is
 * ignored — our placements are static per cell and visibility is the per-category drawDistance.
 */

export interface ProcObjBatch {
  category: ProcObjCategoryName;
  /** Clutter model name (lowercased) — defs/meshes resolve through the regular IDE catalog. */
  model: string;
  /** Sorted by `lottery` ascending — see the density cutoff note above. */
  placements: ProcObjPlacement[];
}

export interface ProcObjPlacement {
  /** Align the object to the face normal (from the rule); otherwise it stays world-upright. */
  align: boolean;
  /** Density lottery in [0, {@link PROC_OBJ_MAX_DENSITY}): drawn while `lottery < density`. */
  lottery: number;
  /** Unit face normal (GTA Z-up world space). */
  normal: [number, number, number];
  /** World position (GTA Z-up), z-offset already applied. */
  position: [number, number, number];
  /** Rotation around the up axis, radians. */
  rotation: number;
  /** XY scale. */
  scale: number;
  scaleZ: number;
}

/** Max density the config/debug slider supports (candidates generated per m² scale with this). */
export const PROC_OBJ_MAX_DENSITY = 3;

const DEG_TO_RAD = Math.PI / 180;

/** Reused triangle temporaries (one allocation per cell, not per face). */
interface TriangleScratch {
  a: Vector3;
  ab: Vector3;
  ac: Vector3;
  b: Vector3;
  c: Vector3;
  normal: Vector3;
}

/** Index `procobj.dat` rules by their (lowercased) surface name — the scatter's lookup shape. */
export function groupRulesBySurface(rules: readonly ProcObjRule[]): Map<string, ProcObjRule[]> {
  const bySurface = new Map<string, ProcObjRule[]>();
  for (const rule of rules) {
    const list = bySurface.get(rule.surface);
    if (list) {
      list.push(rule);
    } else {
      bySurface.set(rule.surface, [rule]);
    }
  }

  return bySurface;
}

/**
 * The cell's `procObjLimit` as a lottery threshold: the lottery value below which exactly
 * `limit` placements fall, across ALL of the cell's batches (lowest lotteries win — the
 * most-vanilla subset). `Infinity` when under the limit or unlimited. Both the render meshes
 * and the clutter colliders cut by `lottery < min(density, cap)`, so what isn't rendered is
 * never collided.
 */
export function procObjLotteryCap(batches: readonly ProcObjBatch[], limit?: number): number {
  if (limit === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const lotteries: number[] = [];
  for (const batch of batches) {
    for (const placement of batch.placements) {
      lotteries.push(placement.lottery);
    }
  }
  if (lotteries.length <= limit) {
    return Number.POSITIVE_INFINITY;
  }
  lotteries.sort((a, b) => a - b);

  return lotteries[limit]; // first excluded value — `< cap` keeps exactly `limit` placements
}

/**
 * Scatter one cell's clutter. `surfaceNames` is the surfinfo table (index = COL material id);
 * faces whose surface has no rules are skipped. Walk order (colliders → transforms → faces →
 * rules) is deterministic, and the RNG is seeded by the cell coords alone.
 */
export function scatterProcObjects(
  colliders: readonly RegionColliders[],
  rulesBySurface: ReadonlyMap<string, readonly ProcObjRule[]>,
  surfaceNames: readonly string[],
  cx: number,
  cy: number,
): ProcObjBatch[] {
  const random = mulberry32(cellSeed(cx, cy));
  const batches = new Map<string, ProcObjBatch>();
  const scratch: TriangleScratch = {
    a: new Vector3(),
    ab: new Vector3(),
    ac: new Vector3(),
    b: new Vector3(),
    c: new Vector3(),
    normal: new Vector3(),
  };

  for (const collider of colliders) {
    const { faces, vertices } = collider.col;
    for (const transform of collider.transforms) {
      for (const face of faces) {
        scatterTriangle(batches, random, rulesBySurface, surfaceNames, face, vertices, transform, scratch);
      }
    }
  }

  const result = [...batches.values()];
  for (const batch of result) {
    batch.placements.sort((left, right) => left.lottery - right.lottery);
  }

  return result;
}

/** Stable per-cell seed (coords hashed with two large primes, like the world-grid keys). */
function cellSeed(cx: number, cy: number): number {
  return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) >>> 0;
}

/** Deterministic 32-bit PRNG (mulberry32) — tiny, seedable, plenty for decoration. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scatterFace(
  batches: Map<string, ProcObjBatch>,
  random: () => number,
  rule: ProcObjRule,
  surface: string,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  normal: Vector3,
  area: number,
): void {
  // MAX_DENSITY × the vanilla expectation; the fractional part rolls one extra candidate so
  // small faces still average out to the authored spacing.
  const expected = (area / rule.spacing) * PROC_OBJ_MAX_DENSITY;
  const count = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
  if (count === 0) {
    return;
  }
  let batch = batches.get(rule.model);
  if (!batch) {
    batch = { category: procObjCategory(rule.model, surface), model: rule.model, placements: [] };
    batches.set(rule.model, batch);
  }
  for (let i = 0; i < count; i += 1) {
    // Uniform point on the triangle (sqrt warp keeps it area-uniform, not corner-biased).
    const r = Math.sqrt(random());
    const s = random();
    const wa = 1 - r;
    const wb = r * (1 - s);
    const wc = r * s;
    batch.placements.push({
      align: rule.align,
      lottery: random() * PROC_OBJ_MAX_DENSITY,
      normal: [normal.x, normal.y, normal.z],
      position: [
        a.x * wa + b.x * wb + c.x * wc,
        a.y * wa + b.y * wb + c.y * wc,
        a.z * wa + b.z * wb + c.z * wc + rule.zOffsetMin + random() * (rule.zOffsetMax - rule.zOffsetMin),
      ],
      rotation: (rule.minRotation + random() * (rule.maxRotation - rule.minRotation)) * DEG_TO_RAD,
      scale: rule.minScale + random() * (rule.maxScale - rule.minScale),
      scaleZ: rule.minScaleZ + random() * (rule.maxScaleZ - rule.minScaleZ),
    });
  }
}

/** Scatter one collision face: resolve its surface rules, build the world triangle + upward
 *  normal, and roll the placements for every matching rule. */
function scatterTriangle(
  batches: Map<string, ProcObjBatch>,
  random: () => number,
  rulesBySurface: ReadonlyMap<string, readonly ProcObjRule[]>,
  surfaceNames: readonly string[],
  face: ColFace,
  vertices: Float32Array,
  transform: Matrix4,
  scratch: TriangleScratch,
): void {
  const surface: string | undefined = surfaceNames[face.material];
  if (surface === undefined) {
    return;
  }
  const rules = rulesBySurface.get(surface);
  if (!rules || rules.length === 0) {
    return;
  }
  const { a, ab, ac, b, c, normal } = scratch;
  a.fromArray(vertices, face.a * 3).applyMatrix4(transform);
  b.fromArray(vertices, face.b * 3).applyMatrix4(transform);
  c.fromArray(vertices, face.c * 3).applyMatrix4(transform);
  normal.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a));
  const area = normal.length() / 2;
  if (area < 1e-6) {
    return;
  }
  normal.normalize();
  // COL winding is not consistent for ground faces — clutter must grow OUT of the surface,
  // so a downward normal (align rules would plant bushes upside-down, buried) is flipped up.
  if (normal.z < 0) {
    normal.negate();
  }
  for (const rule of rules) {
    scatterFace(batches, random, rule, surface, a, b, c, normal, area);
  }
}
