import { describe, expect, it } from 'vitest';

import { isNonTreeModel, SA_TREE_MODELS } from './vegetation';

describe('isNonTreeModel', () => {
  describe('negative cases', () => {
    it('flags non-foliage models (rocks/columns, grass/flowers/fern, rubble, pots, proc-patch, already-lod)', () => {
      for (const model of [
        'sm_scrub_rock2',
        'sm_scrb_column1',
        'genveg_tallgrass01',
        'veg_pflowers01',
        'veg_fern_balcny_kb1',
        'veg_ivy_balcny_kb3',
        'cj_urb_rub_1',
        'p_rubblebig',
        'kb_planterbox',
        'pot_01',
        'veg_procfpatchwee',
        'lod_redwoodgrp',
      ]) {
        expect(isNonTreeModel(model)).toBe(true);
      }
    });
  });

  describe('positive cases', () => {
    it('keeps real trees / billboard-able foliage', () => {
      for (const model of [
        'veg_treea1',
        'tree_hipoly09b',
        'vgs_palm01',
        'veg_palmkb1', // 'kb' but not the `^kb_` planter prefix
        'sand_plant01', // 'plant' but not 'planter'
        'sm_des_josh_lrg1',
        'sjmcacti1',
        'genveg_bush08',
      ]) {
        expect(isNonTreeModel(model)).toBe(false);
      }
    });
  });
});

describe('SA_TREE_MODELS', () => {
  describe('positive cases', () => {
    it('is a non-empty, lowercased roster that passes its own non-tree cut', () => {
      expect(SA_TREE_MODELS.length).toBeGreaterThan(100);
      for (const model of SA_TREE_MODELS) {
        expect(model).toBe(model.toLowerCase());
        expect(isNonTreeModel(model)).toBe(false); // consistency: no rock/grass/rubble/etc. slipped into the list
      }
    });
  });
});
