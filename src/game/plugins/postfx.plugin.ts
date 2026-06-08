import type { Mesh } from 'three';

import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  RenderPass as PpRenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';

import type { BloomConfig, SkyConfig } from '../interfaces/config.interface';
import type { Plugin, PluginContext, RenderPass, RenderPipeline } from './plugin';

/** Bloom blur radius (mipmap blur) and luminance smoothing — fixed; intensity/threshold are config. */
const BLOOM_RADIUS = 0.7;
const BLOOM_SMOOTHING = 0.3;

/**
 * Post-processing host (pmndrs `postprocessing`): owns the single off-screen
 * `EffectComposer` and the effects that share it — **god rays** (from the sun mesh),
 * **bloom** and **ACES tone mapping**. Effects are separate `EffectPass`es toggled by
 * config (`.enabled`; a disabled pass is skipped, so it costs nothing). The composer is
 * the pipeline's render pass except in map-viewer mode, which falls back to a plain
 * (cheaper, natively-antialiased) render for the debug inspector.
 */
export class PostFxPlugin implements Plugin {
  readonly name = 'postfx';

  private bloom: BloomEffect | null = null;
  private bloomPass: EffectPass | null = null;
  private composer: EffectComposer | null = null;
  private godRays: GodRaysEffect | null = null;
  private godraysPass: EffectPass | null = null;
  private pass: null | RenderPass = null;
  private pipeline: null | RenderPipeline = null;
  private present = false;
  private readonly sunSource: Mesh;
  private tonePass: EffectPass | null = null;

  constructor(sunSource: Mesh) {
    this.sunSource = sunSource;
  }

  configChanged(config: PluginContext['config']): void {
    this.applyParams(config.graphics.sky, config.graphics.bloom);
  }

  dispose(): void {
    this.ensurePass(false);
    this.composer?.dispose();
  }

  install(context: PluginContext): void {
    const { bloom: bloomCfg, sky } = context.config.graphics;
    // No MSAA on the composer: a multisampled depth/stencil resolve can't be blitted alongside the
    // god-rays depth texture (GL_INVALID_OPERATION). Antialiasing is done by an SMAAEffect instead.
    const composer = new EffectComposer(context.renderer);
    composer.addPass(new PpRenderPass(context.scene, context.camera));

    const godRays = new GodRaysEffect(context.camera, this.sunSource, {
      blendFunction: BlendFunction.SCREEN,
      decay: 0.92,
      density: sky.density,
      exposure: sky.exposure,
      resolutionScale: 0.5, // half-res — the dominant cost saver
      samples: 60,
      weight: sky.weight,
    });
    const bloom = new BloomEffect({
      intensity: bloomCfg.intensity,
      luminanceSmoothing: BLOOM_SMOOTHING,
      luminanceThreshold: bloomCfg.threshold,
      mipmapBlur: true,
      radius: BLOOM_RADIUS,
    });
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });

    // Order: light-emitting effects (god rays, bloom) → tone mapping → SMAA (antialias the final image).
    const godraysPass = new EffectPass(context.camera, godRays);
    const bloomPass = new EffectPass(context.camera, bloom);
    const tonePass = new EffectPass(context.camera, toneMapping);
    composer.addPass(godraysPass);
    composer.addPass(bloomPass);
    composer.addPass(tonePass);
    composer.addPass(new EffectPass(context.camera, new SMAAEffect()));

    this.composer = composer;
    this.godRays = godRays;
    this.godraysPass = godraysPass;
    this.bloom = bloom;
    this.bloomPass = bloomPass;
    this.tonePass = tonePass;
    this.pipeline = context.pipeline;
    this.pass = { render: (): void => composer.render() };
    this.ensurePass(!context.config.mapViewer);
  }

  resize(width: number, height: number): void {
    this.composer?.setSize(width, height);
  }

  update(context: PluginContext): void {
    const { bloom, sun, toneMapping } = context.config.graphics;
    if (this.godraysPass) {
      this.godraysPass.enabled = sun.godrays && this.sunSource.visible; // shafts only when sun is up
    }
    if (this.bloomPass) {
      this.bloomPass.enabled = bloom.enabled;
    }
    if (this.tonePass) {
      this.tonePass.enabled = toneMapping;
    }
    this.ensurePass(!context.config.mapViewer); // plain render in the map inspector
  }

  /** Push the configurable tuning into the live god-rays + bloom materials. */
  private applyParams(sky: SkyConfig, bloom: BloomConfig): void {
    if (this.godRays) {
      const material = this.godRays.godRaysMaterial;
      material.density = sky.density;
      material.exposure = sky.exposure;
      material.weight = sky.weight;
    }
    if (this.bloom) {
      this.bloom.intensity = bloom.intensity;
      this.bloom.luminanceMaterial.threshold = bloom.threshold;
    }
  }

  /** Keep the composer in the pipeline iff post-FX should render (else a plain render). */
  private ensurePass(enabled: boolean): void {
    if (!this.pipeline || !this.pass || enabled === this.present) {
      return;
    }
    if (enabled) {
      this.pipeline.addPass(this.pass);
    } else {
      this.pipeline.removePass(this.pass);
    }
    this.present = enabled;
  }
}
