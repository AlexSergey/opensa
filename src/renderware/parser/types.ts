/**
 * Renderer-agnostic data model for parsed RenderWare assets.
 *
 * These structures contain no three.js types so the parser stays testable in
 * plain Node and reusable for non-rendering consumers (collision, streaming).
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** A single frame: local transform + hierarchy link. */
export interface RWFrame {
  /** Row-major 3x3 rotation matrix, flattened (9 floats). */
  rotation: number[];
  position: Vec3;
  parentIndex: number;
  name: string;
}

/** A material's diffuse/mask texture references (resolved against a TXD later). */
export interface RWTextureRef {
  name: string;
  maskName: string;
}

export interface RWMaterial {
  color: [number, number, number, number];
  textured: boolean;
  texture: RWTextureRef | null;
}

/** A triangle as stored by RW: vertex indices + which material it uses. */
export interface RWTriangle {
  a: number;
  b: number;
  c: number;
  materialIndex: number;
}

export interface RWGeometry {
  flags: number;
  numUVLayers: number;
  /** Vertex positions, flattened (numVertices * 3). */
  positions: Float32Array;
  /** Vertex normals if stored, else null (compute downstream). */
  normals: Float32Array | null;
  /** Prelit RGBA bytes if present, flattened (numVertices * 4), else null. */
  prelitColors: Uint8Array | null;
  /** UV layers, each flattened (numVertices * 2). */
  uvLayers: Float32Array[];
  triangles: RWTriangle[];
  materials: RWMaterial[];
}

/** Links a frame to a geometry (one renderable instance). */
export interface RWAtomic {
  frameIndex: number;
  geometryIndex: number;
}

export interface RWClump {
  frames: RWFrame[];
  geometries: RWGeometry[];
  atomics: RWAtomic[];
}

/** Texture pixel encoding as understood by the three.js adapter. */
export type RWTextureFormat = 'dxt1' | 'dxt3' | 'dxt5' | 'rgba8888';

export interface RWMipLevel {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RWTexture {
  name: string;
  maskName: string;
  width: number;
  height: number;
  format: RWTextureFormat;
  hasAlpha: boolean;
  mipmaps: RWMipLevel[];
}

export interface RWTextureDictionary {
  textures: RWTexture[];
}
