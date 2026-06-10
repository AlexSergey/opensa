import { describe, expect, it } from 'vitest';

import { weatherForCity } from './weather-zones';

// A slice of the real WEATHER_NAMES (order/indices match the timecyc table).
const NAMES = [
  'EXTRASUNNY_LA', // 0
  'SUNNY_LA', // 1
  'EXTRASUNNY_SMOG_LA', // 2
  'SUNNY_SMOG_LA', // 3
  'CLOUDY_LA', // 4
  'SUNNY_SF', // 5
  'EXTRASUNNY_SF', // 6
  'CLOUDY_SF', // 7
  'RAINY_SF', // 8
  'FOGGY_SF', // 9
  'SUNNY_VEGAS', // 10
  'EXTRASUNNY_VEGAS', // 11
  'CLOUDY_VEGAS', // 12
  'EXTRASUNNY_COUNTRYSIDE', // 13
  'SUNNY_COUNTRYSIDE', // 14
  'CLOUDY_COUNTRYSIDE', // 15
  'RAINY_COUNTRYSIDE', // 16
  'EXTRASUNNY_DESERT', // 17
  'SUNNY_DESERT', // 18
  'SANDSTORM_DESERT', // 19
  'UNDERWATER', // 20
];
const at = (name: string): number => NAMES.indexOf(name);

describe('weatherForCity', () => {
  describe('negative cases (no city analog → fall back)', () => {
    it('SMOG (only LA) → SUNNY of the new city', () => {
      expect(weatherForCity(NAMES, at('EXTRASUNNY_SMOG_LA'), 'SF')).toBe(at('SUNNY_SF'));
      expect(weatherForCity(NAMES, at('SUNNY_SMOG_LA'), 'VEGAS')).toBe(at('SUNNY_VEGAS'));
    });

    it('FOGGY (only SF) → SUNNY of the new city', () => {
      expect(weatherForCity(NAMES, at('FOGGY_SF'), 'LA')).toBe(at('SUNNY_LA'));
    });

    it('RAINY (no LA/Vegas variant) → RAINY_COUNTRYSIDE (rain anywhere, keeps the type)', () => {
      expect(weatherForCity(NAMES, at('RAINY_SF'), 'LA')).toBe(at('RAINY_COUNTRYSIDE'));
      expect(weatherForCity(NAMES, at('RAINY_SF'), 'VEGAS')).toBe(at('RAINY_COUNTRYSIDE'));
    });

    it('SANDSTORM (DESERT only) → SUNNY in any city', () => {
      expect(weatherForCity(NAMES, at('SANDSTORM_DESERT'), 'LA')).toBe(at('SUNNY_LA'));
      expect(weatherForCity(NAMES, at('SANDSTORM_DESERT'), 'COUNTRYSIDE')).toBe(at('SUNNY_COUNTRYSIDE'));
    });

    it('DESERT runs only clear weather — never SANDSTORM (it is script-triggered)', () => {
      expect(weatherForCity(NAMES, at('EXTRASUNNY_LA'), 'DESERT')).toBe(at('EXTRASUNNY_DESERT'));
      expect(weatherForCity(NAMES, at('CLOUDY_LA'), 'DESERT')).toBe(at('SUNNY_DESERT'));
      expect(weatherForCity(NAMES, at('RAINY_SF'), 'DESERT')).toBe(at('SUNNY_DESERT'));
      expect(weatherForCity(NAMES, at('EXTRASUNNY_SMOG_LA'), 'DESERT')).toBe(at('SUNNY_DESERT'));
    });
  });

  describe('positive cases (city has the type)', () => {
    it('keeps the type when the city has its own variant', () => {
      expect(weatherForCity(NAMES, at('EXTRASUNNY_LA'), 'SF')).toBe(at('EXTRASUNNY_SF'));
      expect(weatherForCity(NAMES, at('CLOUDY_LA'), 'VEGAS')).toBe(at('CLOUDY_VEGAS'));
      expect(weatherForCity(NAMES, at('EXTRASUNNY_LA'), 'COUNTRYSIDE')).toBe(at('EXTRASUNNY_COUNTRYSIDE'));
    });

    it('RAINY keeps its own variant in San Fierro / Countryside', () => {
      expect(weatherForCity(NAMES, at('RAINY_SF'), 'SF')).toBe(at('RAINY_SF'));
      expect(weatherForCity(NAMES, at('RAINY_SF'), 'COUNTRYSIDE')).toBe(at('RAINY_COUNTRYSIDE'));
    });

    it('no-op when the current weather already fits the city', () => {
      expect(weatherForCity(NAMES, at('EXTRASUNNY_SMOG_LA'), 'LA')).toBe(at('EXTRASUNNY_SMOG_LA'));
    });
  });
});
