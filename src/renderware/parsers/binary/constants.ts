/** RenderWare binary stream constants (GTA San Andreas / RW 3.x). */

/** Chunk section type IDs. */
export const RwSection = {
  // RtAnim animation (one UV animation inside a UV_ANIM_DICT)
  ANIM_ANIMATION: 0x1b,
  ATOMIC: 0x14,
  BIN_MESH_PLG: 0x50e,
  CLUMP: 0x10,
  // Embedded collision model plugin (COL2/COL3 wrapped in the clump extension)
  COLLISION: 0x253f2fa,
  EXTENSION: 0x03,
  // Plugin extension chunks
  FRAME: 0x253f2fe,
  FRAME_LIST: 0x0e,
  GEOMETRY: 0x0f,
  GEOMETRY_LIST: 0x1a,
  MATERIAL: 0x07,
  MATERIAL_LIST: 0x08,
  // Material Effects plugin (RpMatFX) — env-map / bump effect on a material
  MATFX: 0x120,
  // SA "extra vertex colour" plugin — a second (night) prelit colour set; bright window verts glow at night
  NIGHT_VERTEX_COLORS: 0x253f2f9,
  // SA custom reflection-material plugin (env-map UV scale/offset + intensity)
  REFLECTION_MAT: 0x253f2fc,
  SKIN: 0x116,
  // SA custom specular-material plugin (level + specular texture name)
  SPECULAR_MAT: 0x253f2f6,
  STRING: 0x02,
  STRUCT: 0x01,
  TEXTURE: 0x06,
  TEXTURE_DICTIONARY: 0x16,
  TEXTURE_NATIVE: 0x15,
  // 2d Effect plugin (per-geometry lights/coronas, particles, ped attractors, …)
  TWO_D_EFFECT: 0x253f2f8,
  // UV-animation dictionary (precedes the Clump in UV-animated DFFs — signs/waterfalls)
  UV_ANIM_DICT: 0x2b,
  // Material UV-animation plugin: channel mask + dict-entry names the material plays
  UV_ANIM_PLG: 0x135,
} as const;

/** RpMatFX material effect type (the env-map effect is what SA vehicles use for reflections). */
export const MatFxEffect = {
  BUMPENVMAP: 3,
  BUMPMAP: 1,
  DUAL: 4,
  DUALUVTRANSFORM: 6,
  ENVMAP: 2,
  NULL: 0,
  UVTRANSFORM: 5,
} as const;

/** Geometry format flags (RpGeometryFlag). */
export const GeometryFlag = {
  LIGHT: 0x0020,
  MODULATE_MATERIAL_COLOR: 0x0040,
  NATIVE: 0x01000000,
  NORMALS: 0x0010,
  POSITIONS: 0x0002,
  PRELIT: 0x0008,
  TEXTURED: 0x0004,
  TEXTURED2: 0x0080,
  TRISTRIP: 0x0001,
} as const;

/** Raster pixel-format flags (low nibble = base format, high bits = options). */
export const RasterFormat = {
  AUTO_MIPMAP: 0x1000,
  C555: 0x0a00,
  C565: 0x0200,
  C888: 0x0600,
  C1555: 0x0100,
  C4444: 0x0300,
  C8888: 0x0500,
  D16: 0x0700,
  D24: 0x0800,
  D32: 0x0900,
  DEFAULT: 0x0000,
  LUM8: 0x0400,
  MIPMAP: 0x8000,
  PAL4: 0x4000,
  PAL8: 0x2000,
  PIXEL_FORMAT_MASK: 0x0f00,
} as const;

/** D3D compression identifiers stored in Texture Native (SA platform). */
export const D3dCompression = {
  DXT1: 0x31545844, // 'DXT1'
  DXT3: 0x33545844, // 'DXT3'
  DXT5: 0x35545844, // 'DXT5'
  NONE: 0,
} as const;
