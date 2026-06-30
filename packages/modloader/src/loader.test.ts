import { describe, expect, it } from 'vitest';

import { parseLoader } from './loader';

describe('parseLoader', () => {
  describe('negative cases', () => {
    it('returns empty lists for prose / a readme (no directives)', () => {
      expect(parseLoader('Thanks for downloading!\nKEEP THIS FILE INSIDE MODLOADER')).toEqual({
        col: [],
        ide: [],
        ipl: [],
      });
    });
  });

  describe('positive cases', () => {
    it('parses IDE / IPL / COLFILE, dropping the COLFILE level and a leading prose/comment line', () => {
      const refs = parseLoader(
        'LOD Vegetation by Junior_Djjr\n# comment\nCOLFILE 0 DATA\\MAPS\\LODvegetation.COL\nIDE DATA\\MAPS\\LODvegetation.IDE\nIPL data/maps/x.ipl',
      );

      expect(refs.ide).toEqual(['DATA\\MAPS\\LODvegetation.IDE']);
      expect(refs.ipl).toEqual(['data/maps/x.ipl']);
      expect(refs.col).toEqual(['DATA\\MAPS\\LODvegetation.COL']);
    });

    it('keeps a COLFILE path that has no level index and one that contains spaces', () => {
      const refs = parseLoader('COLFILE data/models/a.col\nCOLFILE 0 data/maps/Some Col.col');

      expect(refs.col).toEqual(['data/models/a.col', 'data/maps/Some Col.col']);
    });
  });
});
