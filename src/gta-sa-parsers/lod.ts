/**
 * GTA San Andreas low-detail (LOD) models are conventionally named with a
 * `lod` prefix (e.g. `lodflatsgnd12_sfs`, `lod1scmgym1_lae`). They are the
 * distant stand-ins for full-detail objects and are skipped when rendering the
 * close-up scene.
 */
export function isLodModel(modelName: string): boolean {
  return modelName.toLowerCase().startsWith('lod');
}
