import { Color, FogExp2, Scene } from 'three';
import { describe, expect, it } from 'vitest';

import type { Config } from '../interfaces/config.interface';
import type { PluginContext } from './plugin';

import { FogPlugin } from './fog.plugin';

function config(distance: number, mapViewer = false): Config {
  return { fog: { distance }, mapViewer } as unknown as Config;
}

function context(scene: Scene, cfg: Config): PluginContext {
  return { config: cfg, scene } as unknown as PluginContext;
}

describe('FogPlugin', () => {
  describe('negative cases', () => {
    it('drops fog entirely while in map-viewer mode', () => {
      const scene = new Scene();
      const plugin = new FogPlugin();
      plugin.install(context(scene, config(100, true)));
      expect(scene.fog).toBeNull();
    });

    it('clears the scene fog on dispose', () => {
      const scene = new Scene();
      const plugin = new FogPlugin();
      plugin.install(context(scene, config(100)));
      plugin.dispose();
      expect(scene.fog).toBeNull();
    });

    it('does nothing on update without a horizon sampler', () => {
      const scene = new Scene();
      const plugin = new FogPlugin(); // no horizon
      plugin.install(context(scene, config(100)));
      expect(() => plugin.update()).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('installs exponential fog with density = FOG_K / distance', () => {
      const scene = new Scene();
      const plugin = new FogPlugin();
      plugin.install(context(scene, config(100)));
      expect(scene.fog).toBeInstanceOf(FogExp2);
      expect((scene.fog as FogExp2).density).toBeCloseTo(2 / 100, 6);
      expect(scene.background).toBeInstanceOf(Color);
    });

    it('rescales the density when the config distance changes', () => {
      const scene = new Scene();
      const plugin = new FogPlugin();
      plugin.install(context(scene, config(100)));
      plugin.configChanged(config(50));
      expect((scene.fog as FogExp2).density).toBeCloseTo(2 / 50, 6);
    });

    it('tracks the horizon colour into the fog and background each update', () => {
      const scene = new Scene();
      const plugin = new FogPlugin(() => [255, 255, 255]); // full white → linear 1
      plugin.install(context(scene, config(100)));
      plugin.update();
      const fog = scene.fog as FogExp2;
      expect(fog.color.r).toBeCloseTo(1, 5);
      expect((scene.background as Color).r).toBeCloseTo(1, 5);
    });
  });
});
