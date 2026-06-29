/**
 * GTA San Andreas low-detail (LOD) models are conventionally named with a
 * `lod` prefix (e.g. `lodflatsgnd12_sfs`, `lod1scmgym1_lae`). They are the
 * distant stand-ins for full-detail objects and are skipped when rendering the
 * close-up scene.
 *
 * This is a **name heuristic**, not authoritative — a few real objects share
 * the prefix (e.g. `LODCJ_SLOT_BANK`, a casino-interior prop, not a LOD). The
 * runtime consumers (`buildWorldGrid`, `build-colliders`) drop interiors via
 * `isInterior` *before* this check, so such interior false-positives never
 * reach it. A **destructive** caller (e.g. `lod-generator`'s `--strip-lods`)
 * must NOT rely on the name alone — confirm a model is a LOD by checking it is
 * actually referenced as a `lod` target (some instance's `lod` index points to
 * it); deleting a name-matched non-LOD crashed the game.
 */
export function isLodModel(modelName: string): boolean {
  return modelName.toLowerCase().startsWith('lod');
}
