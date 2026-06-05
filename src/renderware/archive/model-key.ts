import type { IdeObjectDef } from '../parsers/text';

/**
 * Instancing key: object defs that share both model (dff) and texture (txd)
 * names share geometry + material, so all their placements can be drawn with a
 * single InstancedMesh.
 */
export function modelKey(def: IdeObjectDef): string {
  return `${def.modelName.toLowerCase()}|${def.txdName.toLowerCase()}`;
}
