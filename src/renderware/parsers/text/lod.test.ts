import { describe, expect, it } from 'vitest';

import { isLodModel } from './lod';

describe('isLodModel', () => {
  it('detects the GTA SA lod-prefixed naming convention, case-insensitively', () => {
    expect(isLodModel('lodflatsgnd12_sfs')).toBe(true);
    expect(isLodModel('LOD1scmgym1_lae')).toBe(true);
    expect(isLodModel('lod_hse_04_sfxrf')).toBe(true);
  });

  it('treats full-detail model names as non-lod', () => {
    expect(isLodModel('gplane')).toBe(false);
    expect(isLodModel('vgsbldng01_lvs')).toBe(false);
    expect(isLodModel('testground')).toBe(false);
  });
});
