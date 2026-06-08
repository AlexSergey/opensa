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
  /** Skin (bone weights / inverse-bind matrices) if the geometry is skinned, else undefined. */
  skin?: RWSkin;
  triangles: RWTriangle[];
  /** UV layers, each flattened (numVertices * 2). */
  uvLayers: Float32Array[];
}

export interface RWMaterial {
  color: [number, number, number, number];
  /** SA reflection/specular material-effect plugins (from the material's Extension), if present. */
  effects?: RWMaterialEffects;
  texture: null | RWTextureRef;
  textured: boolean;
}

/** Material-effect plugins SA vehicles carry for env-map reflections + specular (parsed from the
 *  material's Extension chunk). Absent on non-vehicle / non-reflective materials. */
export interface RWMaterialEffects {
  /** RpMatFX env-map effect — marks the material reflective. */
  envMap?: {
    /** Reflection strength coefficient (0..1; 0 = effectively off). */
    coefficient: number;
    /** Env-map texture name (resolved against the merged vehicle texture map; may be custom per car). */
    texture: null | string;
    /** Whether the env map uses the frame-buffer alpha (RW flag). */
    useFrameBufferAlpha: boolean;
  };
  /** SA reflection-material plugin (0x253f2fc): env-map UV scale/offset + per-material intensity. */
  reflection?: {
    intensity: number;
    offset: [number, number];
    scale: [number, number];
  };
  /** SA specular-material plugin (0x253f2f6): highlight level + specular texture name. */
  specular?: {
    level: number;
    texture: string;
  };
}

export interface RWMipLevel {
  data: Uint8Array;
  height: number;
  width: number;
}

/** Skinning data from a geometry's Skin plugin (skinned character meshes). */
export interface RWSkin {
  /** Per-vertex bone indices (numVertices * 4), into the skin's bone list. */
  boneIndices: Uint8Array;
  /** Per-vertex bone weights (numVertices * 4), summing to ~1 per vertex. */
  boneWeights: Float32Array;
  /**
   * Inverse-bind (bone → model space) matrices, flattened (numBones * 16) in raw
   * RW layout: `right.xyz, 0, up.xyz, 0, at.xyz, 0, pos.xyz, 0` per matrix.
   */
  inverseBindMatrices: Float32Array;
  numBones: number;
  /** Bone-remap indices the skin actually uses (RW optimisation; length = numUsedBones). */
  usedBones: number[];
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
