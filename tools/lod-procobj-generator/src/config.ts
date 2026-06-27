/** Build knobs for the procobj LOD generator (overridable via CLI flags). */
export interface ProcObjLodConfig {
  /** Emitted LOD draw distance (world units) — the visibility gate for the LOD def. */
  drawDistance: number;
  /** Optional min HD height (m) gate — drops short clutter (grass) from conversion. 0 = off. */
  procObjHeight: number;
  /** Cap on statically converted procobj objects (0 disables the conversion). */
  procObjMax: number;
  /** Max texture dimension (px) in the shared `lod_procobj.txd`; sources are downscaled to it. */
  textureSize: number;
  /** QEM decimation target triangles per LOD model. */
  tris: number;
}

/** Defaults tuned for medium-distance procobj clutter (bushes, rocks, scrub). */
export const config: ProcObjLodConfig = {
  drawDistance: 300,
  procObjHeight: 0,
  procObjMax: 20000,
  textureSize: 64,
  tris: 200,
};
