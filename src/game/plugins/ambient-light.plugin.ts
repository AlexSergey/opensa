import { AmbientLight } from 'three';

import type { Plugin, PluginContext } from './plugin';

export class AmbientLightPlugin implements Plugin {
  readonly name = 'ambient-light';

  private readonly light: AmbientLight;

  constructor(color = 0xffffff, intensity = 1.5) {
    this.light = new AmbientLight(color, intensity);
  }

  dispose(): void {
    this.light.removeFromParent();
  }

  install(context: PluginContext): void {
    context.scene.add(this.light);
  }
}
