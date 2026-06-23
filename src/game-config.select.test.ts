import { describe, expect, it } from 'vitest';

import { selectGameIds } from './game-config.select';

// Mirrors the real catalogue's relevant shape: one fetch demo flagged dev-only (gostown), one always-on
// bring-your-own title (original / San Andreas).
const config = {
  gostown: { devOnly: true },
  original: {},
};

describe('selectGameIds', () => {
  describe('production build (isDev = false)', () => {
    it('drops dev-only games — only the always-on titles ship', () => {
      expect(selectGameIds(config, false)).toEqual(['original']);
    });

    it('never exposes gostown in a production build', () => {
      expect(selectGameIds(config, false)).not.toContain('gostown');
    });
  });

  describe('development (isDev = true)', () => {
    it('keeps dev-only games alongside the always-on titles', () => {
      expect(selectGameIds(config, true)).toEqual(['gostown', 'original']);
    });
  });
});
