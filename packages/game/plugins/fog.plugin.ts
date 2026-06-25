import { Color, FogExp2, SRGBColorSpace } from 'three';

import type { Config } from '../interfaces/config.interface';
import type { Plugin, PluginContext } from './plugin';

/** Fallback horizon colour before a `horizon` sampler is supplied. */
const FOG_COLOR = 0x9fb4c8;
/**
 * Exponential-fog steepness: `density = FOG_K / config.fog.distance`. With `FOG_K = 2`,
 * geometry is ~63% fogged at 0.5×distance, ~90% at 0.75×, ~98% at the configured distance —
 * a natural haze that actually dissolves the far world (vs linear fog only tinting it).
 */
const FOG_K = 2;

/**
 * Distance fog (exponential): fades the far map into the **horizon colour** (hiding the
 * streaming / LOD edge and pop-in). The colour tracks the sky horizon each frame (via the
 * `horizon` sampler) so fully-fogged geometry blends seamlessly into the sky dome; the
 * background matches it too. The fade is driven by `config.fog.distance` (live via
 * {@link Config.fog}); fog is removed while `config.mapViewer` is on.
 */
export class FogPlugin implements Plugin {
  readonly name = 'fog';

  private readonly background = new Color(FOG_COLOR);
  private readonly fog = new FogExp2(FOG_COLOR);
  private readonly horizon?: () => readonly [number, number, number];
  private scene: null | PluginContext['scene'] = null;

  /** `horizon` returns the current sky-horizon RGB (0–255) the fog/background fade into. */
  constructor(horizon?: () => readonly [number, number, number]) {
    this.horizon = horizon;
  }

  configChanged(config: Readonly<Config>): void {
    this.apply(config);
  }

  dispose(): void {
    if (this.scene) {
      this.scene.fog = null;
    }
  }

  install(context: PluginContext): void {
    this.scene = context.scene;
    context.scene.background = this.background;
    this.apply(context.config);
  }

  update(): void {
    if (!this.horizon) {
      return;
    }
    const [r, g, b] = this.horizon();
    // sRGB → linear (fog is mixed in linear space) so fully-fogged geometry matches the sky's sRGB output.
    this.fog.color.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
    this.background.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
  }

  /** Set the fog density from the config, and drop it entirely while in map-viewer mode. */
  private apply(config: Readonly<Config>): void {
    if (!this.scene) {
      return;
    }
    this.fog.density = FOG_K / config.fog.distance;
    this.scene.fog = config.mapViewer ? null : this.fog;
  }
}
