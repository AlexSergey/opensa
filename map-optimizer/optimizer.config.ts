import type { OptimizerConfig } from './core/asset';

import { passThrough } from './plugins/pass-through';

/**
 * The default pipeline (the "gulpfile"). No transforms yet — just the no-op stage that validates the
 * read → pipeline → write loop. Add ordered plugins here as they land.
 */
export const config: OptimizerConfig = {
  concurrency: 4,
  plugins: [passThrough],
};
