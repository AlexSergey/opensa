import { isLodModel } from '@opensa/renderware/parsers/text/lod';

/**
 * Whether a `lod*` model has a placed **HD twin** — its name with the `lod` / `lod<N>` prefix stripped is a
 * placed, non-LOD model (e.g. `lodlae2_roads89` → `lae2_roads89`, `lod1blockk_lae` → `blockk_lae`). Such a LOD is
 * a **redundant far-LOD** (the HD covers the near view and the cell/impostor covers far); a `lod*` with no twin is
 * base geometry that stands on its own. Shared by the LOD tools (opensa-lod-generator's resolve/strip; available
 * to map-optimizer). Name-based — it only matches a twin whose HD name is the `lod`-stripped form, so a LOD named
 * unlike its HD (`lodcuntw01` ↔ `cuntwland03b`) reads as having no twin; callers that need every far-LOD caught
 * gate on {@link isLodModel} directly.
 */
export function hasHdTwin(lodModel: string, placed: ReadonlySet<string>): boolean {
  for (const twin of [lodModel.replace(/^lod\d+/, ''), lodModel.replace(/^lod/, '')]) {
    if (twin !== lodModel && twin.length > 0 && !isLodModel(twin) && placed.has(twin)) {
      return true;
    }
  }

  return false;
}
