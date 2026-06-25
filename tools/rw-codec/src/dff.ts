import type { RwChunk } from './chunk';

import { RW_CLUMP, RW_GEOMETRY, RW_GEOMETRY_LIST, RW_STRUCT } from './chunk';

/** Every Geometry chunk, in document order (matches a clump's geometry-list order). */
export function collectGeometries(chunks: readonly RwChunk[]): RwChunk[] {
  const geometries: RwChunk[] = [];
  for (const clump of chunks) {
    if (clump.type !== RW_CLUMP) {
      continue;
    }
    for (const list of clump.children ?? []) {
      if (list.type !== RW_GEOMETRY_LIST) {
        continue;
      }
      for (const geometry of list.children ?? []) {
        if (geometry.type === RW_GEOMETRY) {
          geometries.push(geometry);
        }
      }
    }
  }

  return geometries;
}

/** The Struct leaf of every Geometry, in document order (for tests). */
export function collectGeometryStructs(chunks: readonly RwChunk[]): RwChunk[] {
  return collectGeometries(chunks)
    .map((geometry) => geometry.children?.find((child) => child.type === RW_STRUCT && child.data))
    .filter((struct): struct is RwChunk => Boolean(struct));
}
