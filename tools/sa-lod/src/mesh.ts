/**
 * The merged-mesh interchange types for the simplified-copy LOD pipeline (decimate → normals → encode). A producer
 * (a cell merge, or a single procobj model) builds a {@link MergedMesh}; `@opensa/sa-lod` decimates, re-derives
 * normals, and encodes it to a RenderWare DFF.
 */

/** One texture's triangles within a {@link MergedMesh} — `indices` are triples into the vertex arrays. */
export interface MergedGroup {
  indices: Uint32Array;
  /** Base texture name (lowercased), or '' for untextured materials. */
  texture: string;
}

/**
 * A mesh in native Z-up space, triangles bucketed into per-texture {@link MergedGroup}s (no atlas). Vertex
 * attributes are parallel arrays indexed by the group `indices`. Normals are carried from the source when present,
 * else left zero for a downstream normals pass; colours default to opaque white when a source vertex had no prelit.
 */
export interface MergedMesh {
  /** Prelit RGBA bytes (SA **day** colours), flattened (vertexCount × 4). */
  colors: Uint8Array;
  /** Per-texture triangle groups (vertex indices into the attribute arrays). */
  groups: MergedGroup[];
  /** SA **night** prelit RGBA bytes (the `0x253F2F9` "extra vertex colour" set), flattened (vertexCount × 4).
   *  Optional — when absent, the encoder writes no night plugin (the engine falls back to the day colours). */
  nightColors?: Uint8Array;
  /** Vertex normals, flattened (vertexCount × 3); zero where the source had none. */
  normals: Float32Array;
  /** Vertex positions, flattened (vertexCount × 3). */
  positions: Float32Array;
  /** UV layer 0, flattened (vertexCount × 2). */
  uvs: Float32Array;
}

export type Quat = readonly [number, number, number, number];

export type Vec3 = readonly [number, number, number];
