import type { Mesh } from 'three';

import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  NormalPass,
  RenderPass as PpRenderPass,
  SMAAEffect,
  SSAOEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';

import type { BloomConfig, SkyConfig, SsaoConfig } from '../interfaces/config.interface';
import type { Plugin, PluginContext, RenderPass, RenderPipeline } from './plugin';

import { clockNightFactor } from '../time/hour-window';
import { NightGradeEffect } from './night-grade.effect';

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
  private readonly hours: () => number;
  private nightGrade: NightGradeEffect | null = null;
  private nightPass: EffectPass | null = null;
  private normalPass: NormalPass | null = null;
  private pass: null | RenderPass = null;
  private pipeline: null | RenderPipeline = null;
  private present = false;
  private ssao: null | SSAOEffect = null;
  private ssaoPass: EffectPass | null = null;
  private readonly sunSource: Mesh;
  private toneMapping: null | ToneMappingEffect = null;
  private tonePass: EffectPass | null = null;

  constructor(sunSource: Mesh, hours: () => number) {
    this.sunSource = sunSource;
    this.hours = hours;
  }

  configChanged(config: PluginContext['config']): void {
    this.applyParams(config.graphics.sky, config.graphics.bloom, config.graphics.ssao);
  }

  dispose(): void {
    this.ensurePass(false);
    this.composer?.dispose();
  }

  install(context: PluginContext): void {
    const { bloom: bloomCfg, sky, ssao: ssaoCfg } = context.config.graphics;
    // No MSAA on the composer: a multisampled depth/stencil resolve can't be blitted alongside the
    // god-rays depth texture (GL_INVALID_OPERATION). Antialiasing is done by an SMAAEffect instead.
    const composer = new EffectComposer(context.renderer);
    composer.addPass(new PpRenderPass(context.scene, context.camera));

    // Ambient occlusion: a scene-normals pass feeds an SSAO effect that multiply-darkens corners/contacts.
    const normalPass = new NormalPass(context.scene, context.camera);
    const ssao = new SSAOEffect(context.camera, normalPass.texture, {
      blendFunction: BlendFunction.MULTIPLY,
      fade: 0.02,
      intensity: ssaoCfg.intensity,
      luminanceInfluence: 0.6,
      radius: ssaoCfg.radius,
      resolutionScale: 0.5, // half-res AO — the cost saver
      samples: 9,
      worldDistanceFalloff: 100,
      worldDistanceThreshold: 300,
      worldProximityFalloff: 2,
      worldProximityThreshold: 6,
    });
    const ssaoPass = new EffectPass(context.camera, ssao);
    composer.addPass(normalPass);
    composer.addPass(ssaoPass);

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
    // NORMAL (not the effect's default SRC, which *ignores* opacity) so the blend opacity actually fades ACES
    // in/out over the clock window — at opacity 1 it's identical to SRC, so the full-night look is unchanged.
    const toneMapping = new ToneMappingEffect({
      blendFunction: BlendFunction.NORMAL,
      mode: ToneMappingMode.ACES_FILMIC,
    });
    const nightGrade = new NightGradeEffect();

    // Order: light-emitting effects (god rays, bloom) → tone mapping → night grade → SMAA (antialias the
    // final image). The night grade goes last (on the final look) so it tints the whole frame at night.
    const godraysPass = new EffectPass(context.camera, godRays);
    const bloomPass = new EffectPass(context.camera, bloom);
    const tonePass = new EffectPass(context.camera, toneMapping);
    const nightPass = new EffectPass(context.camera, nightGrade);
    composer.addPass(godraysPass);
    composer.addPass(bloomPass);
    composer.addPass(tonePass);
    composer.addPass(nightPass);
    composer.addPass(new EffectPass(context.camera, new SMAAEffect()));

    this.composer = composer;
    this.godRays = godRays;
    this.godraysPass = godraysPass;
    this.bloom = bloom;
    this.bloomPass = bloomPass;
    this.toneMapping = toneMapping;
    this.tonePass = tonePass;
    this.nightGrade = nightGrade;
    this.nightPass = nightPass;
    this.normalPass = normalPass;
    this.ssao = ssao;
    this.ssaoPass = ssaoPass;
    this.pipeline = context.pipeline;
    this.pass = { render: (): void => composer.render() };
    this.ensurePass(!context.config.mapViewer);
  }

  resize(width: number, height: number): void {
    this.composer?.setSize(width, height);
  }

  update(context: PluginContext): void {
    const { bloom, night, ssao, sun, toneMapping } = context.config.graphics;
    if (this.godraysPass) {
      this.godraysPass.enabled = sun.godrays && this.sunSource.visible; // shafts only when sun is up
    }
    if (this.nightGrade && this.nightPass) {
      // Night factor (sun height) is stashed on the shared god-rays mesh by the SkyPlugin.
      const nightFactor = ((this.sunSource.userData.night as number | undefined) ?? 0) * night.grade;
      this.nightGrade.night = nightFactor;
      this.nightGrade.setTint(night.tint[0], night.tint[1], night.tint[2]);
      this.nightPass.enabled = nightFactor > 0.001; // skip the grade by day (zero cost)
    }
    if (this.bloomPass) {
      this.bloomPass.enabled = bloom.enabled;
    }
    if (this.normalPass && this.ssaoPass) {
      this.normalPass.enabled = ssao.enabled; // disabled = the extra normal render is skipped (zero cost)
      this.ssaoPass.enabled = ssao.enabled;
    }
    if (this.tonePass && this.toneMapping) {
      // ACES only at NIGHT (where it makes the bright emissive/bloom pop — the whole point); fade it out by DAY,
      // where it just greys/desaturates the midtones. Rides the same fixed CLOCK schedule as the night vertex
      // colours (dusk fade-in 20→21, dawn fade-out 06→07), not the sun height, so it cross-fades with the lit
      // windows. Blend by the effect's opacity (0 = passthrough, 1 = ACES); pass off by day = zero cost.
      const nightFactor = clockNightFactor(this.hours(), night.litFade);
      this.toneMapping.blendMode.opacity.value = nightFactor;
      this.tonePass.enabled = toneMapping && nightFactor > 0.001;
    }
    this.ensurePass(!context.config.mapViewer); // plain render in the map inspector
  }

  /** Push the configurable tuning into the live god-rays + bloom + SSAO materials. */
  private applyParams(sky: SkyConfig, bloom: BloomConfig, ssao: SsaoConfig): void {
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
    if (this.ssao) {
      this.ssao.ssaoMaterial.intensity = ssao.intensity;
      this.ssao.ssaoMaterial.radius = ssao.radius;
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
