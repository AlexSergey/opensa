/**
 * Renderer-agnostic data model for parsed RenderWare assets.
 *
 * These structures contain no three.js types so the parser stays testable in
 * plain Node and reusable for non-rendering consumers (collision, streaming).
 */

/** Links a frame to a geometry (one renderable instance). */
export interface RWAtomic {
  frameIndex: number;
  geometryIndex: number;
}
export interface RWClump {
  atomics: RWAtomic[];
  frames: RWFrame[];
  geometries: RWGeometry[];
}

/** A single frame: local transform + hierarchy link. */
export interface RWFrame {
  name: string;
  parentIndex: number;
  position: Vec3;
  /** Row-major 3x3 rotation matrix, flattened (9 floats). */
  rotation: number[];
}

export interface RWGeometry {
  flags: number;
  materials: RWMaterial[];
  /** Vertex normals if stored, else null (compute downstream). */
  normals: Float32Array | null;
  numUVLayers: number;
  /** Vertex positions, flattened (numVertices * 3). */
  positions: Float32Array;
  /** Prelit RGBA bytes if present, flattened (numVertices * 4), else null. */
  prelitColors: null | Uint8Array;
  triangles: RWTriangle[];
  /** UV layers, each flattened (numVertices * 2). */
  uvLayers: Float32Array[];
}

export interface RWMaterial {
  color: [number, number, number, number];
  texture: null | RWTextureRef;
  textured: boolean;
}

export interface RWMipLevel {
  data: Uint8Array;
  height: number;
  width: number;
}

export interface RWTexture {
  format: RWTextureFormat;
  hasAlpha: boolean;
  height: number;
  maskName: string;
  mipmaps: RWMipLevel[];
  name: string;
  width: number;
}

export interface RWTextureDictionary {
  textures: RWTexture[];
}

/** Texture pixel encoding as understood by the three.js adapter. */
export type RWTextureFormat = 'dxt1' | 'dxt3' | 'dxt5' | 'rgba8888';

/** A material's diffuse/mask texture references (resolved against a TXD later). */
export interface RWTextureRef {
  maskName: string;
  name: string;
}

/** A triangle as stored by RW: vertex indices + which material it uses. */
export interface RWTriangle {
  a: number;
  b: number;
  c: number;
  materialIndex: number;
}

export type Vec2 = [number, number];

export type Vec3 = [number, number, number];
