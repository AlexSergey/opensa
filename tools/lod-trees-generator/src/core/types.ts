/**
 * Game-agnostic types for the tree-LOD generator. The core renders + packs + emits; everything game-specific
 * (DFF/TXD/IDE I/O, encoding) lives behind a {@link TreeLodAdapter} so a future game plugs in without touching
 * the core (cf. lod-generator's core/adapter split).
 */

/** A decoded source texture as raw RGBA (`width*height*4`), ready for software sampling. */
export interface DecodedTexture {
  hasAlpha: boolean;
  height: number;
  rgba: Uint8Array;
  width: number;
}

/** A loaded HD tree: its triangle soup + decoded textures + bounding box. */
export interface HdTree {
  bbox: { max: Vec3; min: Vec3 };
  name: string;
  textures: Map<string, DecodedTexture>;
  triangles: HdTriangle[];
}

/** One HD triangle flattened for rasterising: 3 positions (native Z-up), 3 UVs, optional prelit colors, and the
 *  material's texture name (lowercased) — `null` when the material is untextured. */
export interface HdTriangle {
  colors: [Rgba, Rgba, Rgba] | null;
  positions: [Vec3, Vec3, Vec3];
  texture: null | string;
  uvs: [Vec2, Vec2, Vec2];
}

/** A baked tree impostor: the per-tree atlas image (RGBA, `size*size*4`) + the cards (placement + UV rect) the
 *  LOD DFF will reference. One {@link Impostor} → one named texture in the shared TXD. */
export interface Impostor {
  bbox: { max: Vec3; min: Vec3 };
  cards: ImpostorCard[];
  image: Uint8Array;
  name: string;
  size: number;
}

/** One crossed-billboard card: angle around vertical Z, world extents (tangent `u` rel. to centre, absolute
 *  `z`), and its pixel rect in the atlas image. */
export interface ImpostorCard {
  angle: number;
  uvRect: { h: number; w: number; x: number; y: number };
  worldU: [number, number];
  worldZ: [number, number];
}

/** RGBA byte color (0–255). */
export type Rgba = [number, number, number, number];

/** Game-specific I/O for the generator. */
export interface TreeLodAdapter {
  /** Encode + write all baked impostors (LOD DFFs + shared atlas TXD + COL) to `--out`. */
  finalize: (impostors: Impostor[]) => void;
  /** HD tree model names to process (from `--in`). */
  listInputs: () => string[];
  /** Parse + decode one HD tree (geometry + textures, resolved against `--game`). */
  loadTree: (name: string) => HdTree;
}

/** Bake knobs (the "how big / how many" of the impostor). */
export interface TreeLodConfig {
  /** Number of crossed billboard cards in the impostor cage. */
  cards: number;
  /** Emitted LOD draw distance (world units) — the visibility gate for the LOD def. */
  drawDistance: number;
  /** Per-tree texture size (px) in the shared atlas — the N card views tile inside it. */
  textureSize: number;
}

export type Vec2 = [number, number];

export type Vec3 = [number, number, number];
