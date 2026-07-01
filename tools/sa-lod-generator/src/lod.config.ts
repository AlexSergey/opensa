import type { LodConfig } from './core/types';

/**
 * Curated HD models that ship with **no LOD** and hole the far view when they unload (plan 003). Auto-detection
 * over-generates ~1000×, so this is an opt-in list, lowercased — extend it as more holes are spotted in the viewer.
 * Entries that turn out to already have a LOD (or lack a def/DFF) are skipped with a warning.
 */
const holeFillModels = [
  'lae2_landhub02',
  'lanalley1_lan',
  'vegassedge29b',
  'vgssspagjun09b',
  'miragebuild09',
  'miragebuild04',
  'vegasnroad242',
  'vegaswrailroad01',
  'pier69_models06',
  'churchgr_sfe',
  'lowbox_sfe',
  'lombardsteps',
  'tempsf_3_sfe',
  'gg_split1_sfw',
  'park3a_sfw',
  'roadssfse34',
  'bbgroundbitc_sfs',
  'traintrax01b_sfs',
  'nuroad_sfse',
];

/** Default run config. `texScale` 0.5 = half each side (quarter the pixels) for the clone LODs (plan 002). */
export const config: LodConfig = {
  holeFillModels,
  holeLodDraw: 1500,
  texScale: 0.5,
};
