/** RenderWare binary stream constants (GTA San Andreas / RW 3.x). */

/** Chunk section type IDs. */
export const RwSection = {
  STRUCT: 0x01,
  STRING: 0x02,
  EXTENSION: 0x03,
  TEXTURE: 0x06,
  MATERIAL: 0x07,
  MATERIAL_LIST: 0x08,
  FRAME_LIST: 0x0e,
  GEOMETRY: 0x0f,
  CLUMP: 0x10,
  ATOMIC: 0x14,
  TEXTURE_NATIVE: 0x15,
  TEXTURE_DICTIONARY: 0x16,
  GEOMETRY_LIST: 0x1a,
  // Plugin extension chunks
  FRAME: 0x253f2fe,
  BIN_MESH_PLG: 0x50e,
} as const;

/** Geometry format flags (RpGeometryFlag). */
export const GeometryFlag = {
  TRISTRIP: 0x0001,
  POSITIONS: 0x0002,
  TEXTURED: 0x0004,
  PRELIT: 0x0008,
  NORMALS: 0x0010,
  LIGHT: 0x0020,
  MODULATE_MATERIAL_COLOR: 0x0040,
  TEXTURED2: 0x0080,
  NATIVE: 0x01000000,
} as const;

/** Raster pixel-format flags (low nibble = base format, high bits = options). */
export const RasterFormat = {
  DEFAULT: 0x0000,
  C1555: 0x0100,
  C565: 0x0200,
  C4444: 0x0300,
  LUM8: 0x0400,
  C8888: 0x0500,
  C888: 0x0600,
  D16: 0x0700,
  D24: 0x0800,
  D32: 0x0900,
  C555: 0x0a00,
  AUTO_MIPMAP: 0x1000,
  PAL8: 0x2000,
  PAL4: 0x4000,
  MIPMAP: 0x8000,
  PIXEL_FORMAT_MASK: 0x0f00,
} as const;

/** D3D compression identifiers stored in Texture Native (SA platform). */
export const D3dCompression = {
  NONE: 0,
  DXT1: 0x31545844, // 'DXT1'
  DXT3: 0x33545844, // 'DXT3'
  DXT5: 0x35545844, // 'DXT5'
} as const;
