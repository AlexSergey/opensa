import type { TreeLodConfig } from './core';

/** Default bake knobs (overridable via `--tex` / `--cards`). Tuned per the SA reference (`lodCedar1_hi`). */
export const config: TreeLodConfig = {
  cards: 4,
  drawDistance: 300,
  textureSize: 256,
};
