/**
 * Neutral mesh representation the pipeline plugins operate on — decoupled from any game's on-disk format.
 * Adapters convert their format ⇄ this IR (e.g. RenderWare `RWClump` ⇄ `MeshIR`); plugins read/mutate it
 * without touching format internals. Kept deliberately small for the base architecture; richer fields
 * (adjacency, tangents, …) are added when the plugins that need them land.
 */

/** A model's editable geometry — what flows through the pipeline. */
export interface MeshIR {
  meshes: SubMesh[];
}

/** One renderable sub-mesh (typically one source geometry / LOD). */
export interface SubMesh {
  /** Number of material slots `triangles[*].material` indexes into. */
  materialCount: number;
  /** Stable name for diagnostics (e.g. `geometry_0`). */
  name: string;
  /** Second prelit set used at night (flattened RGBA), or null. */
  nightColors: null | Uint8Array;
  /** Per-vertex normals (flattened xyz), or null when absent. */
  normals: Float32Array | null;
  /** Vertex positions, flattened xyz. */
  positions: Float32Array;
  /** Prelit (baked) per-vertex colours (flattened RGBA), or null. */
  prelitColors: null | Uint8Array;
  /** Triangles, grouped by material via `Triangle.material`. */
  triangles: Triangle[];
  /** First UV layer (flattened uv), or null. */
  uvs: Float32Array | null;
}

/** One indexed triangle (vertex indices + the material slot it belongs to). */
export interface Triangle {
  a: number;
  b: number;
  c: number;
  material: number;
}
