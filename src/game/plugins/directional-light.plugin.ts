import { DirectionalLight } from 'three';

import type { Plugin, PluginContext } from './plugin';

export class DirectionalLightPlugin implements Plugin {
  readonly name = 'directional-light';

  private readonly light: DirectionalLight;

  constructor(color = 0xffffff, intensity = 1.5) {
    this.light = new DirectionalLight(color, intensity);
    this.light.position.set(50, 100, 50);
  }

  dispose(): void {
    this.light.removeFromParent();
  }

  install(context: PluginContext): void {
    context.scene.add(this.light);
  }
}
