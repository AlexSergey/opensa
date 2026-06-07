import { Color, Fog } from 'three';

import type { Config } from '../interfaces/config.interface';
import type { Plugin, PluginContext } from './plugin';

/** Horizon colour the world fades into (also the scene background, since there's no sky yet). */
const FOG_COLOR = 0x9fb4c8;
/** Fog starts ramping in at this fraction of the configured distance (full at the distance). */
const NEAR_RATIO = 0.4;

/**
 * Distance fog: fades the far map into the horizon colour (hiding the streaming /
 * LOD edge and pop-in). The fully-fogged distance is `config.fog.distance`
 * (changed live via {@link Config.fog}); fog is removed while `config.mapViewer`
 * is on so the whole district is visible in the inspector.
 */
export class FogPlugin implements Plugin {
  readonly name = 'fog';

  private readonly fog = new Fog(FOG_COLOR);
  private scene: null | PluginContext['scene'] = null;

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
    context.scene.background = new Color(FOG_COLOR);
    this.apply(context.config);
  }

  /** Set the fog range from the config, and drop it entirely while in map-viewer mode. */
  private apply(config: Readonly<Config>): void {
    if (!this.scene) {
      return;
    }
    this.fog.far = config.fog.distance;
    this.fog.near = config.fog.distance * NEAR_RATIO;
    this.scene.fog = config.mapViewer ? null : this.fog;
  }
}
