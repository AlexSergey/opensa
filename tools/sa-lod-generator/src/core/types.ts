/**
 * Game-agnostic types for the sa-lod-generator (per-object HD-clone LODs for the real game — see
 * `docs/plans/001-architecture.md`). The core only knows about resolved **HD↔LOD links** and the run config; the
 * RenderWare/GTA-SA specifics (parsing IPL `lod` fields, DFFs) live in `adapters/gta-sa`.
 */

/** Run configuration (the "what/where" knobs). */
export interface LodConfig {
  /** Curated HD models (lowercased) that have no LOD and hole the far view — a far-LOD is generated for each (plan 003). */
  holeFillModels?: readonly string[];
  /** Draw distance for the generated hole-fill LODs (covers the far view once the HD unloads). */
  holeLodDraw?: number;
  /** Output directory for the drop-in build (the CLI passes `--out <path>`); absent → report only. */
  out?: string;
  /** Texture downscale factor for the clone LODs (0.5 = half each side = quarter the pixels). */
  texScale: number;
}

/** One resolved HD→LOD relationship, aggregated over the instances that share it. */
export interface LodLink {
  /** The HD model whose far-view stand-in is `lodModel`. */
  hdModel: string;
  /** The HD model's IDE `txd` — the source atlas the 50 % clone TXD is downscaled from. */
  hdTxd: string;
  /** How many placed HD instances link `hdModel` → `lodModel`. */
  instanceCount: number;
  /** The LOD model's object id (from its IDE def) — reused on the clone (drop-in, no new id). */
  lodId: number;
  /** The stock LOD model — the entry the clone replaces in place. */
  lodModel: string;
  /** The LOD model's IDE `txd` (retargeted to the 50 % clone TXD when baking). */
  lodTxd: string;
}

/** Result of resolving the map's LOD links: the aggregated links + counts of the LODs left out. */
export interface ResolveResult {
  /** LOD models skipped because they also have a standalone (non-target) placement — cloning would corrupt it. */
  excludedDualRole: number;
  /** LOD models skipped because the HD or LOD is vegetation (trees get impostors, not HD clones). */
  excludedVegetation: number;
  links: LodLink[];
  /** Links whose LOD target had no IDE def (can't clone). */
  unresolved: number;
}
