import { describe, expect, it } from 'vitest';

import { PRESETS } from './presets';

const SOURCES = ['sa-envmap', 'sky-probe'];
const SPECULARS = ['off', 'pbr', 'sa-dot'];
const TECHNIQUES = ['pbr-envmap', 'sa-spheremap'];

describe('PRESETS', () => {
  describe('positive cases', () => {
    it('exposes the built-in looks (PC / PS2 / enhanced)', () => {
      expect(Object.keys(PRESETS).sort()).toEqual(['PC', 'PS2', 'enhanced']);
    });

    it('keeps every preset field inside its valid range / enum (the plugin branches on fields)', () => {
      for (const [key, preset] of Object.entries(PRESETS)) {
        for (const ratio of [preset.clearcoat, preset.clearcoatRoughness, preset.metalness, preset.roughness]) {
          expect(ratio, key).toBeGreaterThanOrEqual(0);
          expect(ratio, key).toBeLessThanOrEqual(1);
        }
        expect(preset.reflectivity, key).toBeGreaterThan(0);
        expect(SOURCES, key).toContain(preset.source);
        expect(SPECULARS, key).toContain(preset.specular);
        expect(TECHNIQUES, key).toContain(preset.technique);
        expect(preset.label.length, key).toBeGreaterThan(0);
      }
    });

    it('routes the enhanced look through a live sky probe + PBR', () => {
      expect(PRESETS.enhanced.source).toBe('sky-probe');
      expect(PRESETS.enhanced.technique).toBe('pbr-envmap');
    });

    it('routes the faithful PC/PS2 looks through the static SA sphere map', () => {
      for (const key of ['PC', 'PS2'] as const) {
        expect(PRESETS[key].source).toBe('sa-envmap');
        expect(PRESETS[key].technique).toBe('sa-spheremap');
      }
    });
  });
});
