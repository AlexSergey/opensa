import type { MapPlugin } from '../core/asset';

/**
 * A no-op stage: proves the read → pipeline → write loop end to end without changing geometry, so the
 * adapter identity-copies the source. The first real transforms (normals, weld, dedupe, …) replace or
 * augment it in follow-up plans (002+).
 */
export const passThrough: MapPlugin = {
  name: 'pass-through',
  transform(asset, context): void {
    context.log(asset, 'pass-through', `${asset.ir.meshes.length} mesh(es), unchanged`);
  },
};
