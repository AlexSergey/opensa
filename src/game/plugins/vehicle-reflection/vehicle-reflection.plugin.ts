import {
  CubeCamera,
  LinearMipmapLinearFilter,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  type Scene,
  SRGBColorSpace,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';

import type { VehicleReflectionConfig } from '../../interfaces/config.interface';
import type { Plugin, PluginContext } from '../plugin';

import { SKY_PROBE_LAYER } from '../sky.plugin';
import { PRESETS } from './presets';

/** The SA reflection-plugin data `buildMaterial` tags onto a reflective vehicle material's `userData`. */
export interface VehicleReflectionData {
  /** MatFX env-map coefficient (per-material reflection strength). */
  coefficient: number;
  /** Env-map texture name (resolved against the merged vehicle texture map; may be custom per car). */
  envTexture: null | string;
  /** SA reflection-material intensity. */
  intensity: number;
  /** Env-map UV offset (for the SA sphere-map shader, later). */
  offset: [number, number];
  /** Env-map UV scale (for the SA sphere-map shader, later). */
  scale: [number, number];
  /** SA specular level. */
  specularLevel: number;
}

const OFF: VehicleReflectionConfig = { intensity: 1, preset: 'off' };

/** Cube probe resolution and how much game-time must pass before it re-renders the sky. */
const PROBE_SIZE = 128;
const PROBE_REFRESH_HOURS = 0.25; // ~15 game-minutes

/**
 * Applies the active reflection **preset** to spawned vehicles' env-map-reflective materials (plan 030).
 * Renderware-free — vehicles register their `reflectiveMaterials` (tagged by `buildMaterial`) on spawn.
 *
 * For the `sky-probe` source (the `enhanced` preset) it owns a small **CubeCamera** that renders the sky
 * **dome + sun only** (via {@link SKY_PROBE_LAYER}) into a cube render target, **re-rendered only when the
 * time of day moved** (~15 game-min) — so cars reflect the real timecyc sky cheaply. That cube is the
 * materials' `envMap`; metalness then kicks in. `sa-envmap` presets (PC/PS2) get no env map yet (phase 4).
 */
export class VehicleReflectionPlugin implements Plugin {
  readonly name = 'vehicle-reflection';

  private camera: null | PerspectiveCamera = null;
  private config: VehicleReflectionConfig = OFF;
  private cubeCamera: CubeCamera | null = null;
  private readonly getHours: () => number;
  private readonly materials = new Set<MeshStandardMaterial>();
  private probe: null | WebGLCubeRenderTarget = null;
  private probeHour = Number.NaN;

  private renderer: null | WebGLRenderer = null;
  private scene: null | Scene = null;

  constructor(getHours: () => number) {
    this.getHours = getHours;
  }

  configChanged(config: PluginContext['config']): void {
    this.config = config.graphics.vehicleReflection;
    this.applyAll();
  }

  dispose(): void {
    this.probe?.dispose();
    this.materials.clear();
  }

  install(context: PluginContext): void {
    this.renderer = context.renderer;
    this.scene = context.scene;
    this.camera = context.camera;
    this.probe = new WebGLCubeRenderTarget(PROBE_SIZE, {
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    });
    // The sky dome outputs raw (already-sRGB) colours; tag the probe sRGB so the PBR shader does the
    // sRGB→linear on sample — otherwise the reflection radiance is ~1.5× too bright (overexposed cars).
    this.probe.texture.colorSpace = SRGBColorSpace;
    this.cubeCamera = new CubeCamera(1, 12000, this.probe);
    this.cubeCamera.layers.set(SKY_PROBE_LAYER); // shared by all 6 faces → render sky only
    this.config = context.config.graphics.vehicleReflection;
    this.applyAll();
  }

  /** Register a spawned vehicle's reflective materials and apply the current preset to them. */
  register(materials: readonly MeshStandardMaterial[]): void {
    for (const material of materials) {
      this.materials.add(material);
      this.applyTo(material);
    }
  }

  /** Drop a despawned vehicle's materials from the registry. */
  unregister(materials: readonly MeshStandardMaterial[]): void {
    for (const material of materials) {
      this.materials.delete(material);
    }
  }

  update(): void {
    if (PRESETS[this.config.preset]?.source !== 'sky-probe') {
      return; // probe only needed for the sky-probe presets
    }
    const hours = this.getHours();
    if (Number.isNaN(this.probeHour) || Math.abs(hours - this.probeHour) >= PROBE_REFRESH_HOURS) {
      this.renderProbe();
      this.probeHour = hours;
    }
  }

  private applyAll(): void {
    for (const material of this.materials) {
      this.applyTo(material);
    }
  }

  private applyTo(material: MeshStandardMaterial): void {
    const preset = PRESETS[this.config.preset];
    const data = material.userData.reflection as undefined | VehicleReflectionData;
    const physical = material as MeshPhysicalMaterial; // reflective materials are built as MeshPhysicalMaterial
    const sa = material.userData.saReflect as undefined | { saStrength: { value: number } };
    const previousEnvMap = material.envMap;
    let saStrength = 0;

    if (!preset || !data) {
      material.envMap = null; // 'off' / unknown preset → matte (today's look)
      material.envMapIntensity = 1;
      material.metalness = 0;
      material.roughness = 1;
      physical.clearcoat = 0;
    } else if (preset.source === 'sky-probe' && this.probe) {
      // Enhanced: a glossy clearcoat reflecting the sky probe; the saturated paint shows through.
      // `envMapIntensity` (× REFLECT INTENSITY) dials the whole sky contribution — the env map also adds
      // diffuse IBL (sky ambient), so keep it modest or upward faces wash out.
      material.envMap = this.probe.texture;
      material.envMapIntensity = preset.reflectivity * this.config.intensity;
      material.metalness = preset.metalness; // ~0 → diffuse paint stays saturated
      material.roughness = preset.roughness;
      physical.clearcoat = preset.clearcoat; // the sun still highlights the coat even at low env intensity
      physical.clearcoatRoughness = preset.clearcoatRoughness;
    } else {
      // PC / PS2: the authentic additive SA sphere-map reflection (driven by the injected `saStrength`).
      material.envMap = null;
      material.envMapIntensity = 1;
      material.metalness = 0;
      material.roughness = 1;
      physical.clearcoat = 0;
      saStrength = data.coefficient * this.config.intensity * preset.reflectivity;
    }

    if (sa) {
      sa.saStrength.value = saStrength; // uniform → no recompile needed
    }
    if (material.envMap !== previousEnvMap) {
      material.needsUpdate = true; // toggling the env-map slot changes a shader define → recompile (rare)
    }
  }

  /** Render the sky (dome + sun, via the probe layer) into the cube probe, at the camera position. */
  private renderProbe(): void {
    if (!this.renderer || !this.scene || !this.camera || !this.cubeCamera) {
      return;
    }
    this.cubeCamera.position.copy(this.camera.position); // sky is camera-centred; sit inside the dome
    this.cubeCamera.updateMatrixWorld(true);
    this.cubeCamera.update(this.renderer, this.scene);
  }
}
