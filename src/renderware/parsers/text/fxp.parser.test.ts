import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFxp, sampleFxTrack } from './fxp.parser';

const FXP_PATH = join(process.cwd(), 'static', 'models', 'effects.fxp');
const fxpExists = existsSync(FXP_PATH);

describe('sampleFxTrack', () => {
  describe('negative cases', () => {
    it('returns 0 for an empty track', () => {
      expect(sampleFxTrack([], 0.5)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('clamps before the first and after the last key', () => {
      const keys = [
        { time: 0.2, value: 10 },
        { time: 0.8, value: 20 },
      ];
      expect(sampleFxTrack(keys, 0)).toBe(10);
      expect(sampleFxTrack(keys, 1)).toBe(20);
    });

    it('interpolates linearly between keys', () => {
      const keys = [
        { time: 0, value: 0 },
        { time: 1, value: 100 },
      ];
      expect(sampleFxTrack(keys, 0.25)).toBeCloseTo(25, 5);
    });
  });
});

describe('parseFxp', () => {
  describe('negative cases', () => {
    it('returns an empty map for empty input', () => {
      expect(parseFxp('').size).toBe(0);
    });

    it('tolerates garbage lines', () => {
      expect(parseFxp('hello\nworld: 1\n123\n').size).toBe(0);
    });
  });

  describe.skipIf(!fxpExists)('positive cases (real effects.fxp)', () => {
    const systems = parseFxp(readFileSync(FXP_PATH, 'utf8'));

    it('parses the full project (80+ systems, all named)', () => {
      expect(systems.size).toBeGreaterThan(80);
      for (const [name, system] of systems) {
        expect(name.length).toBeGreaterThan(0);
        expect(system.name).toBe(name);
      }
    });

    it('parses the fire system the skull torches reference (plan 044 target)', () => {
      const fire = systems.get('fire');
      expect(fire).toBeDefined();
      expect(fire?.cullDist).toBeCloseTo(35, 3);
      expect(fire?.boundingSphere[3]).toBeCloseTo(2.5, 3); // radius
      expect(fire?.emitters).toHaveLength(3); // heat haze + flame + smoke layers
      const flame = fire?.emitters.find((emitter) => emitter.texture === 'wjet6');
      expect(flame).toBeDefined();
      expect(flame?.dstBlendId).toBe(1); // additive
      expect(flame?.tracks.get('emrate.rate')?.length).toBeGreaterThan(0);
    });

    it('captures keyframed colour/life tracks (prt_blood reference values)', () => {
      const blood = systems.get('prt_blood');
      expect(blood).toBeDefined();
      const emitter = blood!.emitters[0];
      expect(emitter.texture).toBe('sphere');
      expect(sampleFxTrack(emitter.tracks.get('colour.red') ?? [], 0)).toBeCloseTo(255, 3);
      expect(sampleFxTrack(emitter.tracks.get('colour.alpha') ?? [], 0)).toBeCloseTo(255, 3);
      expect(sampleFxTrack(emitter.tracks.get('colour.alpha') ?? [], 1)).toBeCloseTo(0, 3); // fades out
      expect(sampleFxTrack(emitter.tracks.get('emrate.rate') ?? [], 0)).toBeCloseTo(150, 3);
      expect(sampleFxTrack(emitter.tracks.get('emlife.life') ?? [], 0)).toBeCloseTo(0.7, 3);
      expect(sampleFxTrack(emitter.tracks.get('emdir.dirz') ?? [], 0)).toBeCloseTo(1, 3); // upward
    });

    it('covers every effect name referenced by the map 2dfx entries', () => {
      // The full type-1 survey set (scripts/find-2dfx.ts) — each must resolve to a system.
      const referenced = [
        'ws_factorysmoke',
        'smoke30lit',
        'insects',
        'cigarette_smoke',
        'vent',
        'vent2',
        'waterfall_end',
        'fire',
        'smoke30m',
        'water_fountain',
        'smoke50lit',
        'cloudfast',
        'water_fnt_tme',
        'prt_spark',
        'prt_spark_2',
      ];
      for (const name of referenced) {
        expect(systems.has(name), `system ${name}`).toBe(true);
      }
    });
  });
});
