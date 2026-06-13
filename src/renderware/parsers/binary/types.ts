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
/**
 * The SA Breakable plugin (0x253F2FD; plan 045): a complete secondary "shatter" mesh the
 * engine turns into flying per-triangle debris when the prop is smashed. Model space, layout
 * byte-verified (binnt08_la / trafficlight1: header + packed arrays sum to the chunk size
 * exactly). Present only when the chunk's magic is non-zero (a runtime pointer fixup — most
 * models ship a 4-byte `magic = 0` marker meaning "not breakable").
 */
export interface RWBreakable {
  /** Per-vertex RGBA (numVertices × 4). */
  colours: Uint8Array;
  materials: RWBreakableMaterial[];
  /** Vertex positions, flattened (numVertices × 3). */
  positions: Float32Array;
  /** Per-triangle material index (numTriangles). */
  triangleMaterials: Uint16Array;
  /** Triangle vertex indices, flattened (numTriangles × 3). */
  triangles: Uint16Array;
  /** Vertex UVs, flattened (numVertices × 2). */
  uvs: Float32Array;
}

/** One material of a breakable mesh (texture names resolve against the model's TXD). */
export interface RWBreakableMaterial {
  /** Ambient colour multiplier (RGB 0–1). */
  ambient: [number, number, number];
  /** Mask texture name ('' when none; exporters leave garbage after the NUL — already trimmed). */
  mask: string;
  texture: string;
}

export interface RWClump {
  atomics: RWAtomic[];
  frames: RWFrame[];
  geometries: RWGeometry[];
  /** UV animations from the DFF's leading UVAnimDict (signs/waterfalls; plan 041), if any.
   *  Materials reference entries by name via their `uvAnim` effect. */
  uvAnimations?: RWUvAnimation[];
}

/**
 * A 2d-effect ESCALATOR entry (type 10): moving-step path baked into the host model (plan 044).
 * The step path runs `position → bottom` (lower landing), `bottom → top` (incline),
 * `top → end` (upper landing); all points are geometry-local. Six entries exist in the map
 * (LA mall pairs + the LV casino travelators).
 */
export interface RWEscalator {
  /** Start of the incline (end of the lower landing). */
  bottom: Vec3;
  /** 1 = steps move up (position → end), 0 = down (end → position). */
  direction: number;
  /** End of the upper landing (step exit). */
  end: Vec3;
  /** Start of the lower landing (step entry). */
  position: Vec3;
  /** End of the incline (start of the upper landing). */
  top: Vec3;
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
  /** SA Breakable shatter mesh (plan 045) — undefined when the model isn't breakable. */
  breakable?: RWBreakable;
  /** 2d-effect escalators (geometry-local path points; plan 044) — undefined when none. */
  escalators?: RWEscalator[];
  flags: number;
  /** 2d-effect lights/coronas (geometry-local positions) for street lamps, signs, etc. — empty if none. */
  lights: RWLight2d[];
  materials: RWMaterial[];
  /** Night (extra) prelit RGBA bytes if present, flattened (numVertices * 4), else null. SA's second vertex-
   *  colour set used at night — bright window texels here glow when the day prelit stays dark. */
  nightColors: null | Uint8Array;
  /** Vertex normals if stored, else null (compute downstream). */
  normals: Float32Array | null;
  numUVLayers: number;
  /** 2d-effect particle emitters (geometry-local positions; plan 044) — undefined when none.
   *  `effectName` keys an FX system in `effects.fxp` (e.g. `fire`, `water_fountain`). */
  particles?: RWParticle2d[];
  /** Vertex positions, flattened (numVertices * 3). */
  positions: Float32Array;
  /** Prelit RGBA bytes if present, flattened (numVertices * 4), else null. */
  prelitColors: null | Uint8Array;
  /** 2d-effect road signs (street-name plates whose text is baked into the model; plan 042) —
   *  undefined when the model has none. */
  roadsigns?: RWRoadsign[];
  /** Skin (bone weights / inverse-bind matrices) if the geometry is skinned, else undefined. */
  skin?: RWSkin;
  triangles: RWTriangle[];
  /** UV layers, each flattened (numVertices * 2). */
  uvLayers: Float32Array[];
}

/** A 2d-effect light (corona + optional point light) at a geometry-local position. */
export interface RWLight2d {
  /** RGBA 0–255. */
  color: [number, number, number, number];
  /** Distance (world units) past which the corona stops drawing. */
  coronaFarClip: number;
  /** Corona sprite base size. */
  coronaSize: number;
  /** Corona texture name (e.g. `coronastar`), in the model's TXD / particle.txd. */
  coronaTexture: string;
  /** SA light flags (corona show-mode / fog / checks) — kept for later gating. */
  flags: number;
  /** Geometry-local position. */
  position: [number, number, number];
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
  /** UV-animation plugin (0x135): which UVAnimDict entries this material plays, per UV channel.
   *  `names[i]` corresponds to the i-th set bit of `channelMask` (in practice mask = 1, one name). */
  uvAnim?: {
    channelMask: number;
    names: string[];
  };
}

export interface RWMipLevel {
  data: Uint8Array;
  height: number;
  width: number;
}

/** A 2d-effect PARTICLE entry (type 1): an FX-system emitter baked into the model (plan 044).
 *  The name keys a system in `effects.fxp` (skull-torch `fire`, `water_fountain`, vents…). */
export interface RWParticle2d {
  /** FX system name (lowercased), char[24] in the entry. */
  effectName: string;
  /** Geometry-local emitter position (transformed by each instance placement). */
  position: Vec3;
}

/**
 * A 2d-effect ROADSIGN entry (type 7): a street-name/route plate whose text is baked into the
 * model. Vanilla generates one textured quad per character from the `roadsignfont` glyph atlas
 * (particle.txd). In the text, `_` is the space glyph and `<>^#%}~` are arrow/symbol glyphs.
 */
export interface RWRoadsign {
  /** Characters drawn per line (16/2/4/8, from the flags). */
  charsPerLine: number;
  /** Text colour palette index (0 white, 1 black, 2 grey, 3 red). */
  colour: number;
  /** The plate's text lines (raw 16-char fields, count from the flags). */
  lines: string[];
  /** Plate width × height in metres. */
  plateSize: [number, number];
  /** Geometry-local position of the plate centre. */
  position: Vec3;
  /** Plate rotation in degrees (XYZ). */
  rotation: Vec3;
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

/**
 * One UV animation from a UVAnimDict (RtAnim 0x1B, keyframe type 0x1C1 — linear UV transform).
 * Keyframe `uv` params, in stream order: `[rotation, scaleX, scaleY, skew, translateX, translateY]`
 * (verified on visagesign04: a 3 s loop translating X 0 → 1 — a horizontal scroll).
 */
export interface RWUvAnimation {
  /** Loop duration in seconds. */
  duration: number;
  keyframes: { time: number; uv: number[] }[];
  /** Dict-entry name materials reference (e.g. `DolSign`, `Money`). */
  name: string;
}

export type Vec2 = [number, number];

export type Vec3 = [number, number, number];
