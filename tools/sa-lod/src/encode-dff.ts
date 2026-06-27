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

/**
 * Serialize a merged + decimated cell {@link MergedMesh} into a standard SA RenderWare DFF (plan 002, 1d) — a
 * one-atomic clump whose single multi-material geometry carries the cell's prelit/UV/normals, one material per
 * texture group, and a BinMesh PLG (so the **real** game renders the material splits). Built from scratch via the
 * map-optimizer chunk codec (`writeRw` + `encodeGeometryStruct`); the geometry stays in native Z-up,
 * cell-centre-relative space (the IPL inst places it back at the cell centre). u16 vertex indices cap a geometry
 * at 65 535 verts — far above a decimated cell, but asserted.
 */
export function encodeLodDff(mesh: MergedMesh, name: string): Uint8Array {
  const vertexCount = mesh.positions.length / 3;
  if (vertexCount > 0xffff) {
    throw new Error(`LOD ${name}: ${vertexCount} vertices exceeds the 65535 u16 limit — lower the LOD budget`);
  }

  return writeRw({
    chunks: [
      container(RW_CLUMP, [
        leaf(RW_STRUCT, u32s([1, 0, 0])), // numAtomics, numLights, numCameras
        frameList(name),
        container(RW_GEOMETRY_LIST, [leaf(RW_STRUCT, u32s([1])), geometry(mesh, vertexCount)]),
        atomic(),
        container(RW_EXTENSION, []),
      ]),
    ],
    trailing: new Uint8Array(0),
  });
}

const RW_VERSION = 0x1803ffff; // SA (RW 3.6.0.3)
const RW_STRING = 0x02;
const RW_TEXTURE = 0x06;
const RW_MATERIAL = 0x07;
const RW_MATERIAL_LIST = 0x08;
const RW_FRAME_LIST = 0x0e;
const RW_ATOMIC = 0x14;
const RW_FRAME_NAME = 0x253f2fe;
/** Geometry flags: positions, textured, prelit, normals, light, modulate-material-colour. */
const GEOMETRY_FLAGS = 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x40;

/** Atomic → frame 0, geometry 0 (flags 5 = render | collision-test). */
function atomic(): RwChunk {
  return {
    children: [leaf(RW_STRUCT, u32s([0, 0, 5, 0])), container(RW_EXTENSION, [])],
    type: RW_ATOMIC,
    version: RW_VERSION,
  };
}

/** BinMesh PLG (trilist): one split per texture group → the real game's render lists. */
function binMesh(mesh: MergedMesh): RwChunk {
  const totalIndices = mesh.groups.reduce((sum, group) => sum + group.indices.length, 0);
  const parts: number[] = [0, mesh.groups.length, totalIndices]; // flags(trilist), numMeshes, totalIndices
  mesh.groups.forEach((group, g) => {
    parts.push(group.indices.length, g, ...group.indices);
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

  return container(RW_GEOMETRY, [
    leaf(RW_STRUCT, encodeGeometryStruct(struct)),
    materialList(mesh),
    container(RW_EXTENSION, [binMesh(mesh)]),
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
