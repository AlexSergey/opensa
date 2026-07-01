/**
 * Gap stitch — the pure Phase-1 core (plan 017, variants A + B + D). Given the **uniquely-placed** map models it
 * finds boundary vertices/edges of two *different* models and closes or hides the crack between them:
 *
 * - **A — vertex weld:** a boundary vertex mutually nearest to another model's boundary **vertex** within
 *   `(minGap, maxGap]` → both move to their **midpoint**. Mutual nearest-neighbour (not union-into-a-group, which
 *   would collapse a whole seam edge to a point).
 * - **B — T-junction split:** a boundary vertex that lands on the **interior of another model's boundary edge** →
 *   the vertex snaps onto the edge **and** that edge is split at the projection (a new vertex, exact attribute
 *   lerp) so the two surfaces share the point. Runs on the vertices A didn't pair.
 * - **D — skirt:** a **wide-gap** (> `maxGap`, ≤ `skirtMaxGap`) horizontal boundary edge facing a coplanar
 *   neighbour it can't reach → extrude a **downward skirt** to occlude the void behind the crack (guarded to a
 *   real outward seam at similar height, so it never flaps off an open ledge or a cliff).
 *
 * Returns per-model **moves** (A + B snaps), **splits** (B) and **skirts** (D), keyed by local position, consumed
 * by `plugins/stitch-gap-split.ts` → `stitch-gap-position.ts` → `skirt-boundary.ts`. Shares boundary/transform/
 * grid helpers with the seam weld via `boundary.ts`.
 */

import type { Placement, Vec3, WorldPoint } from './boundary';

import {
  boundaryEdges,
  boundaryVertices,
  dot,
  neighbourIndices,
  rotateByConjugate,
  spatialGrid,
  sub,
  transformToWorld,
  vertexNormals,
  worldToLocal,
} from './boundary';

/** A boundary edge (local endpoints P, Q) to split at parameter `t ∈ (0, 1)` measured P → Q. */
export interface EdgeSplit {
  edge: readonly [readonly [number, number, number], readonly [number, number, number]];
  t: number;
}

/** One geometry of a model (positions + triangles; prelit is irrelevant to the geometric stitch). */
export interface GapGeometry {
  positions: Float32Array;
  triangles: readonly { a: number; b: number; c: number }[];
}

/** A uniquely-placed model: its placement + the geometries whose boundaries may be stitched. */
export interface GapModel {
  geometries: readonly GapGeometry[];
  name: string;
  placement: Placement;
}

export interface GapStitchOptions {
  /** Include `lod*` models (consumed by the adapter's model selection). Default **false**. */
  includeLods?: boolean;
  /** Upper crack width (world units): boundaries farther apart than this aren't a crack. Default 0.4. */
  maxGap?: number;
  /** Lower bound (world units): closer than this is already coincident → the seam weld's job. Default 0.05. */
  minGap?: number;
  /** Min cosine between the two world normals — keeps a floor edge off a perpendicular wall base. Default cos 45°. */
  normalCosThreshold?: number;
  /** Variant D — skirt depth (world units) a wide-gap edge is extruded down. `0` disables skirts. Default 1.5. */
  skirtDepth?: number;
  /** Variant D — min cosine of a boundary edge's normal with world-up to be "horizontal" (skirt candidate).
   *  Default cos 40°. Keeps skirts off walls / vertical faces. */
  skirtHorizontalCos?: number;
  /** Variant D — max horizontal gap (world units) to a coplanar neighbour at similar height for a skirt to fire.
   *  A wider neighbour (or none — an open ledge over air) gets no skirt. Default 3. */
  skirtMaxGap?: number;
  /** Variant D — max height difference (world units) to the neighbour: a vertical drop (roof over street) is not a
   *  coplanar seam and gets no skirt. Default 1. */
  skirtMaxRise?: number;
}

export interface GapStitchResult {
  /** Per model, boundary vertices to move to a new local position (variants A + B). */
  moves: Map<string, PositionOverride[]>;
  /** Per model, boundary edges to extrude into an occluding skirt (variant D). */
  skirts: Map<string, SkirtEdge[]>;
  /** Per model, boundary edges to split at a parameter (variant B). */
  splits: Map<string, EdgeSplit[]>;
  stats: GapStitchStats;
}

export interface GapStitchStats {
  /** Distinct models that received a move, a split or a skirt. */
  modelsTouched: number;
  /** Wide-gap horizontal boundary edges extruded into a skirt (variant D). */
  skirted: number;
  /** Mutual-nearest vertex pairs moved to their midpoint (variant A). */
  stitched: number;
  /** T-junction vertices snapped onto another model's edge, splitting it (variant B). */
  tjunctions: number;
}

/** A position override for one vertex: match by original local position, overwrite the position. */
export interface PositionOverride {
  newPos: readonly [number, number, number];
  pos: readonly [number, number, number];
}

/** A boundary edge to extrude into a downward occluding skirt: its endpoints and their extruded positions. */
export interface SkirtEdge {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  belowA: readonly [number, number, number];
  belowB: readonly [number, number, number];
}

const DEFAULTS = {
  maxGap: 0.4,
  minGap: 0.05,
  normalCosThreshold: Math.cos(Math.PI / 4),
  skirtDepth: 1.5,
  skirtHorizontalCos: Math.cos((40 * Math.PI) / 180),
  skirtMaxGap: 3,
  skirtMaxRise: 1,
};

/** World up (GTA SA is Z-up). */
const UP: Vec3 = [0, 0, 1];

/** One boundary edge resolved to world space (endpoints + normals; local normals drive the skirt extrusion). */
interface GapEdge {
  localNormalP: Vec3;
  localNormalQ: Vec3;
  localP: Vec3;
  localQ: Vec3;
  model: string;
  /** World position of the owning triangle's third vertex — gives the edge's **outward** direction. */
  worldApex: Vec3;
  worldNormal: Vec3;
  worldP: Vec3;
  worldQ: Vec3;
}

/** One boundary vertex resolved to world space, carrying its model + placement so a target maps back. */
interface GapPoint extends WorldPoint {
  localPos: Vec3;
  model: string;
  placement: Placement;
}

export function computeGapStitches(models: readonly GapModel[], options: GapStitchOptions = {}): GapStitchResult {
  const minGap = options.minGap ?? DEFAULTS.minGap;
  const maxGap = options.maxGap ?? DEFAULTS.maxGap;
  const normalCos = options.normalCosThreshold ?? DEFAULTS.normalCosThreshold;

  const { edges, points } = collect(models);
  const moves = new Map<string, PositionOverride[]>();
  const splits = new Map<string, EdgeSplit[]>();
  const skirts = new Map<string, SkirtEdge[]>();
  const stats: GapStitchStats = { modelsTouched: 0, skirted: 0, stitched: 0, tjunctions: 0 };

  // A — mutual-nearest vertex pairs → midpoint.
  const nearest = nearestCrossModel(points, minGap, maxGap, normalCos);
  const handled = new Uint8Array(points.length);
  for (let i = 0; i < points.length; i += 1) {
    const j = nearest[i];
    if (j <= i || nearest[j] !== i) {
      continue;
    }
    const a = points[i];
    const b = points[j];
    const mid = midpoint(a.world, b.world);
    pushMove(moves, a.model, { newPos: worldToLocal(a.placement, mid), pos: a.localPos });
    pushMove(moves, b.model, { newPos: worldToLocal(b.placement, mid), pos: b.localPos });
    handled[i] = 1;
    handled[j] = 1;
    stats.stitched += 1;
  }

  // B — the vertices A didn't pair: snap onto the nearest cross-model boundary edge + split it there.
  const edgeGrid = spatialGrid(
    edges.map((e) => ({ world: midpoint(e.worldP, e.worldQ) })),
    maxGap,
  );
  for (let i = 0; i < points.length; i += 1) {
    if (handled[i]) {
      continue;
    }
    const hit = nearestCrossEdge(points[i], edges, edgeGrid, minGap, maxGap, normalCos);
    if (!hit) {
      continue;
    }
    const point = points[i];
    const edge = edges[hit.edge];
    pushMove(moves, point.model, { newPos: worldToLocal(point.placement, hit.projection), pos: point.localPos });
    pushSplit(splits, edge.model, { edge: [edge.localP, edge.localQ], t: hit.t });
    stats.tjunctions += 1;
  }

  // D — wide-gap horizontal boundary edges A/B can't close: extrude a downward skirt to occlude the void.
  const skirtDepth = options.skirtDepth ?? DEFAULTS.skirtDepth;
  if (skirtDepth > 0) {
    const skirtMaxGap = options.skirtMaxGap ?? DEFAULTS.skirtMaxGap;
    const skirtCos = options.skirtHorizontalCos ?? DEFAULTS.skirtHorizontalCos;
    const skirtMaxRise = options.skirtMaxRise ?? DEFAULTS.skirtMaxRise;
    const pointGrid = spatialGrid(points, skirtMaxGap);
    for (const edge of edges) {
      if (dot(normalize(edge.worldNormal), UP) < skirtCos) {
        continue; // not a (near-)horizontal surface — skirts are for ground/floor voids, not walls
      }
      if (!hasWideGapNeighbour(edge, points, pointGrid, maxGap, skirtMaxGap, skirtMaxRise, normalCos)) {
        continue; // no coplanar neighbour across a wide gap (open ledge, or A/B already sealed it)
      }
      pushSkirt(skirts, edge.model, {
        a: edge.localP,
        b: edge.localQ,
        belowA: sub(edge.localP, scale(edge.localNormalP, skirtDepth)),
        belowB: sub(edge.localQ, scale(edge.localNormalQ, skirtDepth)),
      });
      stats.skirted += 1;
    }
  }

  stats.modelsTouched = new Set([...moves.keys(), ...splits.keys(), ...skirts.keys()]).size;

  return { moves, skirts, splits, stats };
}

/** Boundary vertices + boundary edges of every model, resolved to world space (normals computed once). */
function collect(models: readonly GapModel[]): { edges: GapEdge[]; points: GapPoint[] } {
  const points: GapPoint[] = [];
  const edges: GapEdge[] = [];
  for (const model of models) {
    for (const geometry of model.geometries) {
      const normals = vertexNormals(geometry.positions, geometry.triangles);
      const localAt = (v: number): Vec3 => [
        geometry.positions[v * 3],
        geometry.positions[v * 3 + 1],
        geometry.positions[v * 3 + 2],
      ];
      const localNormalAt = (v: number): Vec3 => [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
      const normalAt = (v: number): Vec3 => rotateByConjugate(model.placement.rotation, localNormalAt(v));
      for (const v of boundaryVertices(geometry.triangles)) {
        const localPos = localAt(v);
        points.push({
          localPos,
          model: model.name,
          placement: model.placement,
          world: transformToWorld(model.placement, localPos),
          worldNormal: normalAt(v),
        });
      }
      for (const { a, apex, b } of boundaryEdges(geometry.triangles)) {
        const localP = localAt(a);
        const localQ = localAt(b);
        const na = normalAt(a);
        const nb = normalAt(b);
        edges.push({
          localNormalP: localNormalAt(a),
          localNormalQ: localNormalAt(b),
          localP,
          localQ,
          model: model.name,
          worldApex: transformToWorld(model.placement, localAt(apex)),
          worldNormal: [na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]],
          worldP: transformToWorld(model.placement, localP),
          worldQ: transformToWorld(model.placement, localQ),
        });
      }
    }
  }

  return { edges, points };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Whether an edge's midpoint has a different-model coplanar boundary vertex across a **wide** gap (in
 *  `(maxGap, skirtMaxGap]`) at similar height — i.e. a real seam void, not an open ledge or a vertical drop. */
function hasWideGapNeighbour(
  edge: GapEdge,
  points: readonly GapPoint[],
  pointGrid: ReadonlyMap<string, number[]>,
  maxGap: number,
  skirtMaxGap: number,
  skirtMaxRise: number,
  normalCos: number,
): boolean {
  const mid = midpoint(edge.worldP, edge.worldQ);
  const normal = normalize(edge.worldNormal);
  const outward = normalize(sub(mid, edge.worldApex)); // away from the triangle interior — the void side
  // Hot loop over many candidates — inline the vector math (no per-candidate array allocation, or GC thrashes).
  const maxGapSquared = maxGap * maxGap;
  const skirtMaxGapSquared = skirtMaxGap * skirtMaxGap;
  for (const j of neighbourIndices(pointGrid, mid, skirtMaxGap)) {
    const p = points[j];
    if (p.model === edge.model) {
      continue;
    }
    const dz = p.world[2] - mid[2];
    if (Math.abs(dz) > skirtMaxRise || dot(normal, p.worldNormal) < normalCos) {
      continue;
    }
    const dx = p.world[0] - mid[0];
    const dy = p.world[1] - mid[1];
    const dSquared = dx * dx + dy * dy + dz * dz;
    if (dSquared <= maxGapSquared || dSquared > skirtMaxGapSquared) {
      continue;
    }
    // The neighbour must be on the edge's **outward** side (a real void across this edge), not the far edge or a
    // surface off to the side — else a corner catches an unrelated tile and hangs a spurious skirt.
    if ((outward[0] * dx + outward[1] * dy + outward[2] * dz) / Math.sqrt(dSquared) > 0.5) {
      return true;
    }
  }

  return false;
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** The nearest **different-model** boundary edge a point projects onto (interior, in the band, normal agrees). */
function nearestCrossEdge(
  point: GapPoint,
  edges: readonly GapEdge[],
  edgeGrid: ReadonlyMap<string, number[]>,
  minGap: number,
  maxGap: number,
  normalCos: number,
): null | { edge: number; projection: Vec3; t: number } {
  let best = maxGap;
  let hit: null | { edge: number; projection: Vec3; t: number } = null;
  const seen = new Set<number>();
  for (const e of neighbourIndices(edgeGrid, point.world, maxGap)) {
    if (seen.has(e)) {
      continue;
    }
    seen.add(e);
    const edge = edges[e];
    if (edge.model === point.model || dot(point.worldNormal, edge.worldNormal) < normalCos) {
      continue;
    }
    const projected = projectOntoSegment(point.world, edge.worldP, edge.worldQ);
    // Interior only: the split point must sit at least `minGap` from each endpoint (else it's an A weld / a sliver).
    if (projected.along <= minGap || projected.along >= projected.length - minGap) {
      continue;
    }
    const d = distance(point.world, projected.point);
    if (d > minGap && d < best) {
      best = d;
      hit = { edge: e, projection: projected.point, t: projected.along / projected.length };
    }
  }

  return hit;
}

/** For each point, the index of the nearest **different-model** boundary vertex in the band `(minGap, maxGap]`
 *  whose normal agrees; `-1` if none. */
function nearestCrossModel(points: readonly GapPoint[], minGap: number, maxGap: number, normalCos: number): Int32Array {
  const nearest = new Int32Array(points.length).fill(-1);
  const grid = spatialGrid(points, maxGap);
  points.forEach((point, i) => {
    let best = maxGap;
    let bestJ = -1;
    for (const j of neighbourIndices(grid, point.world, maxGap)) {
      const other = points[j];
      if (j === i || other.model === point.model || dot(point.worldNormal, other.worldNormal) < normalCos) {
        continue;
      }
      const d = distance(point.world, other.world);
      if (d > minGap && d < best) {
        best = d;
        bestJ = j;
      }
    }
    nearest[i] = bestJ;
  });

  return nearest;
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Project `p` onto segment `a→b`: the clamped closest point, its distance `along` from `a`, and the length. */
function projectOntoSegment(p: Vec3, a: Vec3, b: Vec3): { along: number; length: number; point: Vec3 } {
  const ab = sub(b, a);
  const lengthSquared = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const ap = sub(p, a);
  const t =
    lengthSquared > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / lengthSquared)) : 0;
  const length = Math.sqrt(lengthSquared);

  return { along: t * length, length, point: [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]] };
}

function pushMove(moves: Map<string, PositionOverride[]>, model: string, move: PositionOverride): void {
  const list = moves.get(model);
  if (list) {
    list.push(move);
  } else {
    moves.set(model, [move]);
  }
}

function pushSkirt(skirts: Map<string, SkirtEdge[]>, model: string, skirt: SkirtEdge): void {
  const list = skirts.get(model);
  if (list) {
    list.push(skirt);
  } else {
    skirts.set(model, [skirt]);
  }
}

function pushSplit(splits: Map<string, EdgeSplit[]>, model: string, split: EdgeSplit): void {
  const list = splits.get(model);
  if (list) {
    list.push(split);
  } else {
    splits.set(model, [split]);
  }
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}
