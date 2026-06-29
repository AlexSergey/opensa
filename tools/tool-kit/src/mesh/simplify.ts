/**
 * Quadric-error-metric mesh simplification (Garland–Heckbert edge collapse), shared `tool-kit` core. Operates on
 * raw `positions` + flat `faces` (vertex index triples) with a **per-face group id** (material/texture); edges
 * between faces of different groups — and open boundary edges — are pinned with a heavy boundary quadric, so
 * material seams and the far silhouette survive decimation. Per-vertex `attributes` (UV, colour, …) are carried
 * and linearly interpolated along each collapse, so the caller doesn't re-sample them.
 *
 * Placement uses the cheapest of {endpoint A, endpoint B, midpoint} (robust, no matrix inversion); collapses
 * that would flip an incident face (foldover) are rejected. Runs until the face budget is met or no valid
 * collapse remains, then compacts to dense indices.
 */

/** A per-vertex attribute stream (mutable; `data.length === vertexCount * size`), interpolated on collapse. */
export interface SimplifyAttribute {
  data: Float64Array;
  size: number;
}

export interface SimplifyMesh {
  /** Optional per-vertex attribute streams (UV, colour, …) carried + interpolated. */
  attributes?: SimplifyAttribute[];
  /** Material/texture group per face (faceCount) — collapses across a boundary are pinned. */
  faceGroup: Int32Array;
  /** Vertex index triples, flattened (faceCount × 3). */
  faces: Int32Array;
  /** Vertex positions, flattened (vertexCount × 3). */
  positions: Float64Array;
}

export interface SimplifyOptions {
  /**
   * Cap a collapse from creating an edge longer than `maxEdgeFactor ×` the mesh's longest input edge. QEM only
   * scores planar error + rejects normal flips, so on flat surfaces it freely stretches triangles into long thin
   * spikes; this bounds how far an edge can grow, killing those spikes with no triangle-budget cost. Omit (default)
   * to leave decimation unbounded — existing callers are unchanged.
   */
  maxEdgeFactor?: number;
  /**
   * Never collapse a face group (material/texture) below this many faces. A flat surface has zero in-plane quadric
   * error and its boundary pin only resists *perpendicular* motion, so QEM slides its boundary inward and collapses
   * the whole surface to nothing — the surface (and its texture) vanishes, leaving a hole. This floors every group
   * so each surface survives. Omit (default) to leave groups uncapped — existing callers are unchanged.
   */
  minFacesPerGroup?: number;
}

export interface SimplifyResult {
  attributes: SimplifyAttribute[];
  faceGroup: Int32Array;
  faces: Int32Array;
  positions: Float64Array;
}

/** Weight pinning boundary / material-seam edges so the silhouette + seams survive (Garland §6). */
const BOUNDARY_WEIGHT = 1000;

interface HeapEntry {
  cost: number;
  target: [number, number, number];
  u: number;
  v: number;
  version: number;
}

/** Mutable simplification state — positions, quadrics, vertex→face adjacency, and a lazy edge heap. */
class Simplifier {
  private readonly attributes: SimplifyAttribute[];
  private readonly edgeVersion = new Map<string, number>();
  private faceCount: number;
  private readonly faceGroup: Int32Array;
  private faceLive: Uint8Array;
  private readonly faces: Int32Array;
  private readonly groupLive = new Map<number, number>();
  private readonly heap: HeapEntry[] = [];
  private readonly maxEdgeLimit: number;
  private readonly minFacesPerGroup: number;
  private readonly positions: Float64Array;
  private readonly quadrics: Float64Array;
  private readonly vertFaces: Set<number>[];
  private readonly vertLive: Uint8Array;

  constructor(mesh: SimplifyMesh, options: SimplifyOptions) {
    this.positions = Float64Array.from(mesh.positions);
    this.faces = Int32Array.from(mesh.faces);
    this.faceGroup = Int32Array.from(mesh.faceGroup);
    this.attributes = (mesh.attributes ?? []).map((a) => ({ data: Float64Array.from(a.data), size: a.size }));
    this.faceCount = this.faces.length / 3;
    const vertexCount = this.positions.length / 3;
    this.quadrics = new Float64Array(vertexCount * 10);
    this.vertFaces = Array.from({ length: vertexCount }, () => new Set<number>());
    this.vertLive = new Uint8Array(vertexCount).fill(1);
    this.faceLive = new Uint8Array(this.faceCount).fill(1);
    this.maxEdgeLimit = options.maxEdgeFactor ? this.initialMaxEdge() * options.maxEdgeFactor : Infinity;
    this.minFacesPerGroup = options.minFacesPerGroup ?? 0;
    for (let f = 0; f < this.faceCount; f += 1) {
      this.groupLive.set(this.faceGroup[f], (this.groupLive.get(this.faceGroup[f]) ?? 0) + 1);
    }

    this.buildAdjacencyAndQuadrics();
    this.buildHeap();
  }

  /** Drop removed verts/faces, remap to dense indices, and return the simplified mesh. */
  compact(): SimplifyResult {
    const remap = new Int32Array(this.positions.length / 3).fill(-1);
    const positions: number[] = [];
    const attrOut = this.attributes.map((a) => ({ data: [] as number[], size: a.size }));
    let next = 0;
    const keep = (v: number): number => {
      if (remap[v] === -1) {
        remap[v] = next;
        next += 1;
        positions.push(this.positions[v * 3], this.positions[v * 3 + 1], this.positions[v * 3 + 2]);
        this.attributes.forEach((a, ai) => {
          for (let i = 0; i < a.size; i += 1) {
            attrOut[ai].data.push(a.data[v * a.size + i]);
          }
        });
      }

      return remap[v];
    };

    const faces: number[] = [];
    const faceGroup: number[] = [];
    for (let f = 0; f < this.faceLive.length; f += 1) {
      if (!this.faceLive[f]) {
        continue;
      }
      faces.push(keep(this.faces[f * 3]), keep(this.faces[f * 3 + 1]), keep(this.faces[f * 3 + 2]));
      faceGroup.push(this.faceGroup[f]);
    }

    return {
      attributes: attrOut.map((a) => ({ data: Float64Array.from(a.data), size: a.size })),
      faceGroup: Int32Array.from(faceGroup),
      faces: Int32Array.from(faces),
      positions: Float64Array.from(positions),
    };
  }

  /** Collapse the cheapest valid edge until the budget is met or the heap drains. */
  run(targetFaces: number): void {
    while (this.faceCount > targetFaces && this.heap.length > 0) {
      const entry = this.pop();
      if (!entry || !this.isCurrent(entry)) {
        continue;
      }
      if (
        !this.wouldFold(entry.u, entry.v, entry.target) &&
        !this.wouldStretch(entry.u, entry.v, entry.target) &&
        !this.wouldStarveGroup(entry.u, entry.v)
      ) {
        this.collapse(entry.u, entry.v, entry.target);
      }
    }
  }

  private addPlaneQuadric(vertex: number, plane: [number, number, number, number], weight: number): void {
    const [a, b, c, d] = plane;
    const q = this.quadrics;
    const base = vertex * 10;
    q[base] += weight * a * a;
    q[base + 1] += weight * a * b;
    q[base + 2] += weight * a * c;
    q[base + 3] += weight * a * d;
    q[base + 4] += weight * b * b;
    q[base + 5] += weight * b * c;
    q[base + 6] += weight * b * d;
    q[base + 7] += weight * c * c;
    q[base + 8] += weight * c * d;
    q[base + 9] += weight * d * d;
  }

  private bestCollapse(u: number, v: number): { cost: number; target: [number, number, number] } {
    const candidates: [number, number, number][] = [this.vertex(u), this.vertex(v), this.midpoint(u, v)];
    let best = candidates[0];
    let bestCost = Infinity;
    for (const candidate of candidates) {
      const cost = this.quadricError(u, v, candidate);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    }

    return { cost: bestCost, target: best };
  }

  private buildAdjacencyAndQuadrics(): void {
    const incident = new Map<string, { faces: number[]; groups: Set<number> }>();
    for (let f = 0; f < this.faceCount; f += 1) {
      const [a, b, c] = this.faceVerts(f);
      this.vertFaces[a].add(f);
      this.vertFaces[b].add(f);
      this.vertFaces[c].add(f);
      const plane = this.facePlane(f);
      if (plane) {
        this.addPlaneQuadric(a, plane, 1);
        this.addPlaneQuadric(b, plane, 1);
        this.addPlaneQuadric(c, plane, 1);
      }
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const key = edgeKey(p, q);
        const rec = incident.get(key) ?? { faces: [], groups: new Set<number>() };
        rec.faces.push(f);
        rec.groups.add(this.faceGroup[f]);
        incident.set(key, rec);
      }
    }
    // Pin boundary (1 face) + material-seam (multi-group) edges with a heavy perpendicular quadric.
    for (const [key, rec] of incident) {
      if (rec.faces.length === 1 || rec.groups.size > 1) {
        this.pinEdge(key, rec.faces[0]);
      }
    }
  }

  private buildHeap(): void {
    const seen = new Set<string>();
    for (let f = 0; f < this.faceCount; f += 1) {
      const [a, b, c] = this.faceVerts(f);
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const key = edgeKey(p, q);
        if (!seen.has(key)) {
          seen.add(key);
          this.pushEdge(p, q);
        }
      }
    }
  }

  private collapse(u: number, v: number, target: [number, number, number]): void {
    const t = this.edgeRatio(u, v, target);
    this.positions[u * 3] = target[0];
    this.positions[u * 3 + 1] = target[1];
    this.positions[u * 3 + 2] = target[2];
    for (const attr of this.attributes) {
      for (let i = 0; i < attr.size; i += 1) {
        const a = attr.data[u * attr.size + i];
        const b = attr.data[v * attr.size + i];
        attr.data[u * attr.size + i] = a + (b - a) * t;
      }
    }
    for (let i = 0; i < 10; i += 1) {
      this.quadrics[u * 10 + i] += this.quadrics[v * 10 + i];
    }

    for (const f of this.vertFaces[v]) {
      if (!this.faceLive[f]) {
        continue;
      }
      const base = f * 3;
      for (let i = 0; i < 3; i += 1) {
        if (this.faces[base + i] === v) {
          this.faces[base + i] = u;
        }
      }
      const [a, b, c] = this.faceVerts(f);
      if (a === b || b === c || a === c) {
        this.removeFace(f); // degenerated by the merge
      } else {
        this.vertFaces[u].add(f);
      }
    }
    this.vertFaces[v].clear();
    this.vertLive[v] = 0;

    this.refreshNeighbors(u);
  }

  private edgeLen(u: number, v: number): number {
    return Math.hypot(
      this.positions[u * 3] - this.positions[v * 3],
      this.positions[u * 3 + 1] - this.positions[v * 3 + 1],
      this.positions[u * 3 + 2] - this.positions[v * 3 + 2],
    );
  }

  private edgeRatio(u: number, v: number, target: [number, number, number]): number {
    const ux = this.positions[u * 3];
    const uy = this.positions[u * 3 + 1];
    const uz = this.positions[u * 3 + 2];
    const dx = this.positions[v * 3] - ux;
    const dy = this.positions[v * 3 + 1] - uy;
    const dz = this.positions[v * 3 + 2] - uz;
    const lenSq = dx * dx + dy * dy + dz * dz;
    if (lenSq < 1e-12) {
      return 0;
    }
    const t = ((target[0] - ux) * dx + (target[1] - uy) * dy + (target[2] - uz) * dz) / lenSq;

    return Math.max(0, Math.min(1, t));
  }

  private faceNormal(
    verts: [number, number, number],
    override?: { at: [number, number, number]; vertex: number },
  ): [number, number, number] | null {
    const p = verts.map((idx) =>
      override && idx === override.vertex
        ? override.at
        : ([this.positions[idx * 3], this.positions[idx * 3 + 1], this.positions[idx * 3 + 2]] as [
            number,
            number,
            number,
          ]),
    );
    const ux = p[1][0] - p[0][0];
    const uy = p[1][1] - p[0][1];
    const uz = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0];
    const vy = p[2][1] - p[0][1];
    const vz = p[2][2] - p[0][2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);

    return len < 1e-12 ? null : [nx / len, ny / len, nz / len];
  }

  private facePlane(f: number): [number, number, number, number] | null {
    const verts = this.faceVerts(f);
    const normal = this.faceNormal(verts);
    if (!normal) {
      return null;
    }
    const [nx, ny, nz] = normal;
    const d = -(
      nx * this.positions[verts[0] * 3] +
      ny * this.positions[verts[0] * 3 + 1] +
      nz * this.positions[verts[0] * 3 + 2]
    );

    return [nx, ny, nz, d];
  }

  private faceVerts(f: number): [number, number, number] {
    return [this.faces[f * 3], this.faces[f * 3 + 1], this.faces[f * 3 + 2]];
  }

  private initialMaxEdge(): number {
    let m = 0;
    for (let f = 0; f < this.faceCount; f += 1) {
      const [a, b, c] = this.faceVerts(f);
      m = Math.max(m, this.edgeLen(a, b), this.edgeLen(b, c), this.edgeLen(c, a));
    }

    return m;
  }

  private isCurrent(entry: HeapEntry): boolean {
    return (
      this.vertLive[entry.u] === 1 &&
      this.vertLive[entry.v] === 1 &&
      this.edgeVersion.get(edgeKey(entry.u, entry.v)) === entry.version
    );
  }

  private midpoint(u: number, v: number): [number, number, number] {
    return [
      (this.positions[u * 3] + this.positions[v * 3]) / 2,
      (this.positions[u * 3 + 1] + this.positions[v * 3 + 1]) / 2,
      (this.positions[u * 3 + 2] + this.positions[v * 3 + 2]) / 2,
    ];
  }

  private pinEdge(key: string, face: number): void {
    const [u, v] = key.split(',').map(Number);
    const normal = this.faceNormal(this.faceVerts(face));
    if (!normal) {
      return;
    }
    const ex = this.positions[v * 3] - this.positions[u * 3];
    const ey = this.positions[v * 3 + 1] - this.positions[u * 3 + 1];
    const ez = this.positions[v * 3 + 2] - this.positions[u * 3 + 2];
    // Plane through the edge, perpendicular to the face (n × edge): pins the boundary in place.
    let px = normal[1] * ez - normal[2] * ey;
    let py = normal[2] * ex - normal[0] * ez;
    let pz = normal[0] * ey - normal[1] * ex;
    const len = Math.hypot(px, py, pz);
    if (len < 1e-12) {
      return;
    }
    px /= len;
    py /= len;
    pz /= len;
    const d = -(px * this.positions[u * 3] + py * this.positions[u * 3 + 1] + pz * this.positions[u * 3 + 2]);
    this.addPlaneQuadric(u, [px, py, pz, d], BOUNDARY_WEIGHT);
    this.addPlaneQuadric(v, [px, py, pz, d], BOUNDARY_WEIGHT);
  }

  private pop(): HeapEntry | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.siftDown(0);
    }

    return top;
  }

  private pushEdge(u: number, v: number): void {
    if (u === v || !this.vertLive[u] || !this.vertLive[v]) {
      return;
    }
    const key = edgeKey(u, v);
    const version = (this.edgeVersion.get(key) ?? 0) + 1;
    this.edgeVersion.set(key, version);
    const { cost, target } = this.bestCollapse(u, v);
    const [a, b] = key.split(',').map(Number);
    const entry: HeapEntry = { cost, target, u: a, v: b, version };
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
  }

  private quadricError(u: number, v: number, point: [number, number, number]): number {
    const [x, y, z] = point;
    const base = (i: number): number => this.quadrics[u * 10 + i] + this.quadrics[v * 10 + i];

    return (
      base(0) * x * x +
      2 * base(1) * x * y +
      2 * base(2) * x * z +
      2 * base(3) * x +
      base(4) * y * y +
      2 * base(5) * y * z +
      2 * base(6) * y +
      base(7) * z * z +
      2 * base(8) * z +
      base(9)
    );
  }

  private refreshNeighbors(u: number): void {
    const neighbors = new Set<number>();
    for (const f of this.vertFaces[u]) {
      for (const w of this.faceVerts(f)) {
        if (w !== u && this.vertLive[w]) {
          neighbors.add(w);
        }
      }
    }
    for (const w of neighbors) {
      this.pushEdge(u, w);
    }
  }

  private removeFace(f: number): void {
    this.faceLive[f] = 0;
    this.faceCount -= 1;
    this.groupLive.set(this.faceGroup[f], (this.groupLive.get(this.faceGroup[f]) ?? 0) - 1);
    for (const w of this.faceVerts(f)) {
      this.vertFaces[w].delete(f);
    }
  }

  private siftDown(start: number): void {
    const heap = this.heap;
    let i = start;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < heap.length && heap[left].cost < heap[smallest].cost) {
        smallest = left;
      }
      if (right < heap.length && heap[right].cost < heap[smallest].cost) {
        smallest = right;
      }
      if (smallest === i) {
        return;
      }
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
  }

  private siftUp(start: number): void {
    const heap = this.heap;
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= heap[i].cost) {
        return;
      }
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  }

  private vertex(v: number): [number, number, number] {
    return [this.positions[v * 3], this.positions[v * 3 + 1], this.positions[v * 3 + 2]];
  }

  /** True if collapsing v→u@target would flip any surviving incident face (foldover). */
  private wouldFold(u: number, v: number, target: [number, number, number]): boolean {
    for (const origin of [u, v]) {
      for (const f of this.vertFaces[origin]) {
        const verts = this.faceVerts(f);
        if (verts.includes(u) && verts.includes(v)) {
          continue; // removed by the collapse
        }
        const before = this.faceNormal(verts);
        const moved = verts.map((idx) => (idx === v ? u : idx)) as [number, number, number];
        const after = this.faceNormal(moved, { at: target, vertex: u });
        if (before && after && before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0) {
          return true;
        }
      }
    }

    return false;
  }

  /** True if collapsing edge (u,v) would drop a face group below {@link minFacesPerGroup} — keeps surfaces alive. */
  private wouldStarveGroup(u: number, v: number): boolean {
    if (this.minFacesPerGroup <= 0) {
      return false;
    }
    const removed = new Map<number, number>(); // group → faces the collapse degenerates
    for (const f of this.vertFaces[v]) {
      if (this.faceVerts(f).includes(u)) {
        removed.set(this.faceGroup[f], (removed.get(this.faceGroup[f]) ?? 0) + 1);
      }
    }
    for (const [group, count] of removed) {
      if ((this.groupLive.get(group) ?? 0) - count < this.minFacesPerGroup) {
        return true;
      }
    }

    return false;
  }

  /** True if collapsing v→u@target would create an edge longer than {@link maxEdgeLimit} — blocks spike slivers. */
  private wouldStretch(u: number, v: number, target: [number, number, number]): boolean {
    for (const origin of [u, v]) {
      for (const f of this.vertFaces[origin]) {
        const verts = this.faceVerts(f);
        if (verts.includes(u) && verts.includes(v)) {
          continue;
        }
        const pts = verts.map((idx) =>
          idx === u || idx === v
            ? target
            : ([this.positions[idx * 3], this.positions[idx * 3 + 1], this.positions[idx * 3 + 2]] as const),
        );
        for (let i = 0; i < 3; i += 1) {
          const a = pts[i];
          const b = pts[(i + 1) % 3];
          if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > this.maxEdgeLimit) {
            return true;
          }
        }
      }
    }

    return false;
  }
}

export function simplify(mesh: SimplifyMesh, targetFaces: number, options: SimplifyOptions = {}): SimplifyResult {
  const state = new Simplifier(mesh, options);
  state.run(targetFaces);

  return state.compact();
}

function edgeKey(u: number, v: number): string {
  return u < v ? `${u},${v}` : `${v},${u}`;
}
