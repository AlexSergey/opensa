import type { RwChunk } from '@opensa/rw-codec/chunk';
import type { GeometryStruct } from '@opensa/rw-codec/geometry-struct';

import {
  RW_BIN_MESH_PLG,
  RW_CLUMP,
  RW_EXTENSION,
  RW_GEOMETRY,
  RW_GEOMETRY_LIST,
  RW_STRUCT,
  writeRw,
} from '@opensa/rw-codec/chunk';
import { encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';

import type { MergedMesh } from './mesh';

export interface EncodeLodDffOptions {
  /**
   * Emit each triangle in both windings (see {@link doubleSided}). **OpenSA-specific** — it back-face-culls opaque
   * world materials, and a merged cell's inconsistent winding would otherwise hole the ground. Off by default: a
   * single authored model (e.g. a procobj impostor) has consistent winding and renders fine single-sided in the
   * real game, where doubling is just an unproven structural change + wasted triangles.
   */
  doubleSided?: boolean;
}

/**
 * Serialize a merged + decimated {@link MergedMesh} into a standard SA RenderWare DFF (plan 002, 1d) — a clump
 * whose multi-material geometry carries the prelit/UV/normals (+ the **night** prelit plugin when the mesh has
 * `nightColors`, so the LOD isn't dark at night), one material per texture group, and a BinMesh PLG (so the
 * **real** game renders the material splits). Optionally **two-sided** (`options.doubleSided`, for OpenSA — see
 * {@link doubleSided}). Built from scratch via the map-optimizer chunk codec (`writeRw` + `encodeGeometryStruct`);
 * the geometry stays in native Z-up, model-local space (the IPL inst places it). u16 vertex indices cap a geometry
 * at 65 535 verts, so a dense mesh is split across several geometries/atomics (see {@link splitMesh}).
 */
export function encodeLodDff(rawMesh: MergedMesh, name: string, options: EncodeLodDffOptions = {}): Uint8Array {
  // u16 vertex indices cap a geometry at 65 535 verts; a dense mesh can exceed that, so split it across several
  // geometries/atomics (all sharing the one identity frame) instead of decimating harder. Double-side after the
  // split (OpenSA only) — it only doubles indices, leaving the vertex count untouched.
  const prepare = options.doubleSided ? doubleSided : (mesh: MergedMesh): MergedMesh => mesh;
  const chunks = splitMesh(rawMesh, 0xffff).map(prepare);

  return writeRw({
    chunks: [
      container(RW_CLUMP, [
        leaf(RW_STRUCT, u32s([chunks.length, 0, 0])), // numAtomics, numLights, numCameras
        frameList(name),
        container(RW_GEOMETRY_LIST, [
          leaf(RW_STRUCT, u32s([chunks.length])),
          ...chunks.map((chunk) => geometry(chunk, chunk.positions.length / 3)),
        ]),
        ...chunks.map((_, i) => atomic(i)),
        container(RW_EXTENSION, []),
      ]),
    ],
    trailing: new Uint8Array(0),
  });
}

/** Partition a merged mesh into sub-meshes each within `maxVerts` vertices (re-indexed), so each fits one DFF
 *  geometry's u16 indices. Triangles are taken group by group; a chunk is flushed when the next triangle's new
 *  vertices would overflow. A single triangle (≤3 verts) always fits a fresh chunk. */
function splitMesh(mesh: MergedMesh, maxVerts: number): MergedMesh[] {
  const totalVerts = mesh.positions.length / 3;
  if (totalVerts <= maxVerts) {
    return [mesh];
  }
  const chunks: MergedMesh[] = [];
  const remap = new Int32Array(totalVerts);
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const night: number[] = [];
  const normals: number[] = [];
  let groups = new Map<string, number[]>();
  const reset = (): void => {
    remap.fill(-1);
    positions.length = uvs.length = colors.length = night.length = normals.length = 0;
    groups = new Map<string, number[]>();
  };
  reset();
  const addVertex = (v: number): number => {
    if (remap[v] === -1) {
      remap[v] = positions.length / 3;
      positions.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]);
      uvs.push(mesh.uvs[v * 2], mesh.uvs[v * 2 + 1]);
      colors.push(mesh.colors[v * 4], mesh.colors[v * 4 + 1], mesh.colors[v * 4 + 2], mesh.colors[v * 4 + 3]);
      normals.push(mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]);
      if (mesh.nightColors) {
        night.push(mesh.nightColors[v * 4], mesh.nightColors[v * 4 + 1], mesh.nightColors[v * 4 + 2], mesh.nightColors[v * 4 + 3]); // prettier-ignore
      }
    }

    return remap[v];
  };
  const flush = (): void => {
    chunks.push({
      colors: Uint8Array.from(colors),
      groups: [...groups].map(([texture, indices]) => ({ indices: Uint32Array.from(indices), texture })),
      ...(mesh.nightColors ? { nightColors: Uint8Array.from(night) } : {}),
      normals: Float32Array.from(normals),
      positions: Float32Array.from(positions),
      uvs: Float32Array.from(uvs),
    });
    reset();
  };
  for (const group of mesh.groups) {
    for (let i = 0; i < group.indices.length; i += 3) {
      const tri = [group.indices[i], group.indices[i + 1], group.indices[i + 2]];
      const fresh = tri.reduce((n, v) => n + (remap[v] === -1 ? 1 : 0), 0);
      if (positions.length / 3 + fresh > maxVerts) {
        flush();
      }
      let indices = groups.get(group.texture);
      if (!indices) {
        indices = [];
        groups.set(group.texture, indices);
      }
      indices.push(addVertex(tri[0]), addVertex(tri[1]), addVertex(tri[2]));
    }
  }
  if (positions.length > 0) {
    flush();
  }

  return chunks;
}

const RW_VERSION = 0x1803ffff; // SA (RW 3.6.0.3)
const RW_STRING = 0x02;
const RW_TEXTURE = 0x06;
const RW_MATERIAL = 0x07;
const RW_MATERIAL_LIST = 0x08;
const RW_FRAME_LIST = 0x0e;
const RW_ATOMIC = 0x14;
const RW_FRAME_NAME = 0x253f2fe;
const RW_NIGHT_VERTEX_COLORS = 0x253f2f9; // SA "extra vertex colour" (night prelit) plugin
/** Geometry flags: positions, textured, prelit, normals, light, modulate-material-colour. */
const GEOMETRY_FLAGS = 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x40;

/** Atomic → frame 0, geometry `geometryIndex` (flags 5 = render | collision-test). */
function atomic(geometryIndex: number): RwChunk {
  return {
    children: [leaf(RW_STRUCT, u32s([0, geometryIndex, 5, 0])), container(RW_EXTENSION, [])],
    type: RW_ATOMIC,
    version: RW_VERSION,
  };
}

/** BinMesh PLG (trilist): one split per texture group → the real game's render lists. */
function binMesh(mesh: MergedMesh): RwChunk {
  const totalIndices = mesh.groups.reduce((sum, group) => sum + group.indices.length, 0);
  const parts: number[] = [0, mesh.groups.length, totalIndices]; // flags(trilist), numMeshes, totalIndices
  mesh.groups.forEach((group, g) => {
    parts.push(group.indices.length, g);
    for (const index of group.indices) {
      parts.push(index); // not `...group.indices` — spreading a large typed array overflows the call stack
    }
  });

  return leaf(RW_BIN_MESH_PLG, u32s(parts));
}

/** Bounding sphere (centre + radius) over the cell's vertices. */
function boundingSphere(positions: Float32Array): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    radius = Math.max(radius, Math.hypot(positions[i] - cx, positions[i + 1] - cy, positions[i + 2] - cz));
  }

  return [cx, cy, cz, radius];
}

function container(type: number, children: RwChunk[]): RwChunk {
  return { children, type, version: RW_VERSION };
}

/**
 * Emit each triangle twice — once as `(a,b,c)`, once reversed `(a,c,b)` — so the geometry renders **two-sided**
 * without an engine change. SA map geometry has inconsistent winding (and mostly no normals), and the engine
 * back-face-culls opaque world materials (`FrontSide`), so ~a third of every surface would otherwise vanish
 * ("shredded" LODs). The reversed copy is coincident: the real game (no world cull) draws identical pixels twice
 * (harmless), the engine culls whichever copy faces away — so one always survives. Vertices are untouched (count
 * unchanged); only the per-group index lists double. Lighting is vertex-normal Gouraud, so winding doesn't affect
 * it. Applied to the render DFF only — the COL stays single-sided.
 */
function doubleSided(mesh: MergedMesh): MergedMesh {
  const groups = mesh.groups.map((group) => {
    const src = group.indices;
    const indices = new Uint32Array(src.length * 2);
    for (let i = 0; i < src.length; i += 3) {
      const a = src[i];
      const b = src[i + 1];
      const c = src[i + 2];
      indices.set([a, b, c, a, c, b], i * 2);
    }

    return { indices, texture: group.texture };
  });

  return { ...mesh, groups };
}

/** FrameList: one identity root frame named after the cell-LOD model. */
function frameList(name: string): RwChunk {
  const record = new Uint8Array(56);
  const view = new DataView(record.buffer);
  for (const [i, value] of [1, 0, 0, 0, 1, 0, 0, 0, 1].entries()) {
    view.setFloat32(i * 4, value, true); // identity rotation
  }
  view.setInt32(48, -1, true); // parentIndex = root
  const struct = new Uint8Array(4 + 56);
  new DataView(struct.buffer).setUint32(0, 1, true); // numFrames
  struct.set(record, 4);

  return {
    children: [leaf(RW_STRUCT, struct), container(RW_EXTENSION, [leaf(RW_FRAME_NAME, new TextEncoder().encode(name))])],
    type: RW_FRAME_LIST,
    version: RW_VERSION,
  };
}

function geometry(mesh: MergedMesh, vertexCount: number): RwChunk {
  const struct: GeometryStruct = {
    flags: GEOMETRY_FLAGS,
    morphs: [{ bounds: boundingSphere(mesh.positions), normals: mesh.normals, positions: mesh.positions }],
    native: 0,
    numTriangles: mesh.groups.reduce((sum, group) => sum + group.indices.length / 3, 0),
    numVertices: vertexCount,
    prelit: mesh.colors,
    triangles: mesh.groups.flatMap((group, g) => trianglesOf(group.indices, g)),
    uvLayers: [mesh.uvs],
  };

  const extension = [binMesh(mesh)];
  if (mesh.nightColors) {
    extension.push(nightColors(mesh.nightColors));
  }

  return container(RW_GEOMETRY, [
    leaf(RW_STRUCT, encodeGeometryStruct(struct)),
    materialList(mesh),
    container(RW_EXTENSION, extension),
  ]);
}

function leaf(type: number, data: Uint8Array): RwChunk {
  return { data, type, version: RW_VERSION };
}

function material(texture: string): RwChunk {
  const struct = new Uint8Array(28);
  const view = new DataView(struct.buffer);
  // flags(0), colour RGBA, unused(0), textured, ambient, specular, diffuse.
  struct[4] = struct[5] = struct[6] = struct[7] = 255;
  view.setUint32(12, texture ? 1 : 0, true);
  view.setFloat32(16, 1, true);
  view.setFloat32(20, 1, true);
  view.setFloat32(24, 1, true);

  const children: RwChunk[] = [leaf(RW_STRUCT, struct)];
  if (texture) {
    children.push(textureChunk(texture));
  }
  children.push(container(RW_EXTENSION, []));

  return { children, type: RW_MATERIAL, version: RW_VERSION };
}

/** Material List: one material per texture group (textured white; '' groups untextured). */
function materialList(mesh: MergedMesh): RwChunk {
  const header = new Int32Array(1 + mesh.groups.length).fill(-1); // numMaterials + per-material index (-1 = inline)
  header[0] = mesh.groups.length;

  return {
    children: [
      leaf(RW_STRUCT, new Uint8Array(header.buffer.slice(0))),
      ...mesh.groups.map((group) => material(group.texture)),
    ],
    type: RW_MATERIAL_LIST,
    version: RW_VERSION,
  };
}

/** The "extra vertex colour" (night prelit) plugin chunk: a `u32` flag (1 = present) + numVertices × RGBA. */
function nightColors(colors: Uint8Array): RwChunk {
  const data = new Uint8Array(4 + colors.length);
  new DataView(data.buffer).setUint32(0, 1, true);
  data.set(colors, 4);

  return leaf(RW_NIGHT_VERTEX_COLORS, data);
}

function stringChunk(value: string): RwChunk {
  const raw = new TextEncoder().encode(value);
  const data = new Uint8Array(Math.ceil((raw.length + 1) / 4) * 4); // NUL-terminated, padded to 4 bytes
  data.set(raw, 0);

  return leaf(RW_STRING, data);
}

function textureChunk(name: string): RwChunk {
  return {
    children: [
      leaf(RW_STRUCT, u32s([0x1102])), // filter linear + wrap addressing
      stringChunk(name),
      stringChunk(''), // mask name (empty)
      container(RW_EXTENSION, []),
    ],
    type: RW_TEXTURE,
    version: RW_VERSION,
  };
}

/** RW-order struct triangles for one material group (vertex index triples → `{a,b,c,material}`). */
function trianglesOf(indices: Uint32Array, material: number): { a: number; b: number; c: number; material: number }[] {
  const triangles: { a: number; b: number; c: number; material: number }[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    triangles.push({ a: indices[i], b: indices[i + 1], c: indices[i + 2], material });
  }

  return triangles;
}

function u32s(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value >>> 0, true));

  return out;
}
