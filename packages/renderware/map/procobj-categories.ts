/**
 * Semantic categories of procobj.dat clutter models (plan 042) — the per-category tuning keys
 * the game config exposes (`GraphicsConfig.procobj` mirrors this union structurally; renderware
 * stays game-free, so the union lives here too).
 */
export type ProcObjCategoryName = 'bushes' | 'cacti' | 'flowers' | 'grass' | 'rocks' | 'trees' | 'underwater';

/** Every model `procobj.dat` references, grouped by category (names lowercased). */
const CATEGORY_MODELS: readonly [ProcObjCategoryName, readonly string[]][] = [
  [
    'grass',
    [
      'gen_tallgrsnew',
      'genveg_tallgrass04',
      'genveg_tallgrass12',
      'veg_procfpatch',
      'veg_procfpatch01',
      'veg_procgrasspatch',
    ],
  ],
  ['flowers', ['veg_pflowers02', 'veg_pflowers03', 'veg_pflowers04']],
  [
    'bushes',
    [
      'genveg_bush01',
      'genveg_bush07',
      'genveg_bush09',
      'genveg_bush10',
      'genveg_bush11',
      'genveg_bush13',
      'genveg_bush19',
      'sand_combush02',
      'sand_combush03',
      'sand_combush1',
      'sm_bush_large_1',
    ],
  ],
  ['cacti', ['sand_josh1', 'sand_josh2', 'sjmcacti2', 'sm_des_pcklypr1']],
  [
    'trees',
    [
      'ash_po',
      'cedar1_po',
      'cedar2_po',
      'cedar3_po',
      'dead_tree_2',
      'dead_tree_3',
      'dead_tree_4',
      'dead_tree_5',
      'dead_tree_6',
      'dead_tree_7',
      'dead_tree_8',
      'dead_tree_9',
      'elmdead_po',
      'pinebg_po',
      'sm_fir_scabg_po',
    ],
  ],
  [
    'rocks',
    [
      'p_rubble',
      'p_rubble03',
      'p_rubble04bcol',
      'p_rubble04col',
      'p_rubble05col',
      'p_rubble0bcol',
      'p_rubble2',
      'rockbrkq',
      'sm_scrub_rock3',
    ],
  ],
  ['underwater', ['searock01', 'searock02', 'searock03', 'searock04', 'searock05', 'searock06', 'seaweed', 'starfish']],
];

const MODEL_CATEGORY: ReadonlyMap<string, ProcObjCategoryName> = new Map(
  CATEGORY_MODELS.flatMap(([category, models]) =>
    models.map((model): [string, ProcObjCategoryName] => [model, category]),
  ),
);

/**
 * Category of a scattered model. Anything on the sea floor counts as `underwater` regardless of
 * model (rubble rules reused there must follow the underwater toggle, not `rocks`); unknown
 * models (future data) land in `bushes` — the broadest mid-distance group.
 */
export function procObjCategory(model: string, surface: string): ProcObjCategoryName {
  if (surface === 'p_underwaterbarren') {
    return 'underwater';
  }

  return MODEL_CATEGORY.get(model.toLowerCase()) ?? 'bushes';
}
