import { describe, expect, it } from 'vitest';

import type { IdeObjectDef } from '../parsers/text';

import { modelKey } from './model-key';

function def(modelName: string, txdName: string): IdeObjectDef {
  return { drawDistance: 100, flags: 0, id: 1, modelName, txdName };
}

describe('modelKey', () => {
  it('combines lowercased model and txd names', () => {
    expect(modelKey(def('Veg_Palm04', 'GTA_tree_palm'))).toBe('veg_palm04|gta_tree_palm');
  });

  it('groups instances that share model + txd, separates differing txd', () => {
    expect(modelKey(def('lamppost1', 'dynbuildng'))).toBe(modelKey(def('LAMPPOST1', 'DynBuildng')));
    expect(modelKey(def('a', 'x'))).not.toBe(modelKey(def('a', 'y')));
  });
});
