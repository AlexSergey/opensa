/**
 * Data model for GTA San Andreas text map files (DAT / IDE / IPL).
 * These structures are renderer-agnostic — no three.js types.
 */

/** Parsed `gta.dat`: the asset folders and data files it references. */
export interface GtaDat {
  /** IDE directives (object-definition file paths). */
  ide: string[];
  /** IMG directives (asset archive/folder paths, e.g. `IMG\basicmap`). */
  img: string[];
  /** IPL directives (scene-placement file paths). */
  ipl: string[];
}

/** One object definition from an IDE `objs`/`anim`/`tobj` section. */
export interface IdeObjectDef {
  /** For `anim` (animated) objects: the IFP file (lowercased, no extension) holding the model's
   *  looping clip — e.g. `counxref` for the oil-pump `nt_noddonkbase` (plan 041). */
  anim?: string;
  drawDistance: number;
  flags: number;
  id: number;
  modelName: string;
  /** For `tobj` (time-of-day) objects: the hour window `[on, off)` it's visible in (wraps midnight). */
  time?: { off: number; on: number };
  txdName: string;
}

/** One placed instance from an IPL `inst` section. */
export interface IplInstance {
  id: number;
  interior: number;
  /** Index of the LOD instance, or -1 for none. */
  lod: number;
  modelName: string;
  /** World position in GTA Z-up space. */
  position: [number, number, number];
  /** Orientation quaternion (x, y, z, w). */
  rotation: [number, number, number, number];
}

/** Resolved map: object catalog keyed by id + the instances to place. */
export interface MapDefinitions {
  catalog: Map<number, IdeObjectDef>;
  /** IMG asset folder paths from the DAT, normalized. */
  imgDirs: string[];
  instances: IplInstance[];
  /**
   * Time-of-day (`tobj`) object definitions, kept separate from the render
   * catalog. Their instances render but carry a `time` window; a system toggles
   * their visibility by the game hour (see {@link IdeObjectDef.time}).
   */
  timedCatalog?: Map<number, IdeObjectDef>;
  /**
   * TXD parent links from `txdp` sections (lowercased `child → parent`). A child
   * TXD inherits textures it lacks from its parent (chain) — see the texture
   * resolver. Absent/empty when no `txdp` data was present.
   */
  txdParents?: Map<string, string>;
}
