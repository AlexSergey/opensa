import type { OptimizerConfig } from './core/asset';

import { createDedupeFaces } from './plugins/dedupe-faces';
import { createPruneVertices } from './plugins/prune-vertices';
import { createRecomputeNormals } from './plugins/recompute-normals';
import { createWeldVertices } from './plugins/weld-vertices';

/**
 * The default pipeline (the "gulpfile"). Runs the ordered plugins over every map model; add stages here as
 * they land. `pass-through` (the no-op loop validator) stays available in `plugins/pass-through.ts`.
 */
export const config: OptimizerConfig = {
  concurrency: 4,
  plugins: [createRecomputeNormals(), createWeldVertices(), createDedupeFaces(), createPruneVertices()],
};
