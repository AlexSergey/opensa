import type { OptimizerConfig } from './core/asset';

import { createConditionPrelit } from './plugins/condition-prelit';
import { createDedupeFaces } from './plugins/dedupe-faces';
import { createRemoveDegenerateTriangles } from './plugins/degenerate-triangles';
import { createPruneVertices } from './plugins/prune-vertices';
import { createSmoothNormals } from './plugins/smooth-normals';
import { createSynthesizeNight } from './plugins/synthesize-night';
import { createWeldVertices } from './plugins/weld-vertices';

/**
 * The default pipeline (the "gulpfile"). Runs the ordered plugins over every map model; add stages here as
 * they land. `pass-through` (the no-op loop validator) stays available in `plugins/pass-through.ts`.
 */
export const config: OptimizerConfig = {
  concurrency: 4,
  plugins: [
    createWeldVertices(),
    createRemoveDegenerateTriangles(),
    createDedupeFaces(),
    createPruneVertices(),
    // Rebuild normals from smooth groups on the cleaned geometry: SA prelit world models ship with broken/absent
    // normals, so the engine smears them (gradients, double-face zero-cancel slivers) → SSAO artifacts. This
    // splits at hard edges so walls stay flat, edges stay sharp, double faces get correct normals.
    createSmoothNormals(),
    createConditionPrelit(),
    createSynthesizeNight({ nightScale: 0.7 }),
  ],
};
