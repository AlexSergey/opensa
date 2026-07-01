/**
 * GTA San Andreas low-detail (LOD) models are conventionally named with a
 * `lod` prefix (e.g. `lodflatsgnd12_sfs`, `lod1scmgym1_lae`). They are the
 * distant stand-ins for full-detail objects and are skipped when rendering the
 * close-up scene.
 *
 * This is a **name heuristic**, not authoritative — a few real objects share
 * the prefix (e.g. `LODCJ_SLOT_BANK`, a casino-interior prop, not a LOD), and it
 * misses name-mismatched LODs (`nw_lodbit_18`, `laelodpark01`). The authoritative
 * HD/LOD split is the IPL `lod` index — `buildWorldGrid` now buckets by
 * `IplInstance.isLod` (set in `resolveMap`), not by this name. `build-colliders`
 * still uses the heuristic (it drops interiors via `isInterior` first, so interior
 * false-positives never reach it). A **destructive** caller (e.g.
 * `opensa-lod-generator`'s `--strip-lods`) must NOT rely on the name alone —
 * confirm a model is a LOD by checking it is actually referenced as a `lod` target
 * (some instance's `lod` index points to it); deleting a name-matched non-LOD
 * crashed the game.
 */
export function isLodModel(modelName: string): boolean {
  return modelName.toLowerCase().startsWith('lod');
}
