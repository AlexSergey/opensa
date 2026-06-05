import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

import type { RenderPass, RenderPipeline } from './plugin';

/**
 * Minimal pipeline: renders the scene directly, or runs registered passes when
 * present. EffectComposer integration is a later phase — the interface is the
 * stable part plugins target.
 */
export class BasicRenderPipeline implements RenderPipeline {
  private readonly camera: PerspectiveCamera;
  private readonly passes: RenderPass[] = [];
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
  }

  addPass(pass: RenderPass): void {
    this.passes.push(pass);
  }

  render(): void {
    if (this.passes.length === 0) {
      this.renderer.render(this.scene, this.camera);

      return;
    }
    for (const pass of this.passes) {
      pass.render();
    }
  }
}
