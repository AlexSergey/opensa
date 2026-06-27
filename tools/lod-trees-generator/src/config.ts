import type { TreeLodConfig } from './core';

/** Default bake knobs (overridable via `--tex` / `--cards` / `--draw`). Tuned per the SA reference (`lodCedar1_hi`). */
export const config: TreeLodConfig = {
  // Trees taller than 2× their width bake into a portrait (width × 2*width) atlas so vertical detail isn't
  // squashed into a square tile. Below this they stay square.
  aspectThreshold: 2,
  cards: 4,
  drawDistance: 1500,
  // Convert every `--dff ∩ procobj` species to static IPL (capped at 20k objects). `procObjHeight` 0 = no height
  // gate (curate via `--dff`); raise it to drop short clutter.
  procObjHeight: 0,
  procObjMax: 20000,
  // 128 px DXT5 per tree — matches the reference LOD mod and keeps the shared TXD small enough for SA to load
  // (256 px would be ~4× larger). Override with `--tex` if you accept a bigger TXD.
  textureSize: 128,
};
