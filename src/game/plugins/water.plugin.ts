import { Color, DoubleSide, type Mesh, type MeshBasicMaterial, ShaderMaterial, type Vector3 } from 'three';

import type { Plugin, PluginContext } from './plugin';

/** The timecyc colours the water shader reflects/tints with (RGB 0–255). */
export interface WaterSample {
  /** Sky-horizon colour the water reflects at grazing angles. */
  horizon: Rgb;
  /** Sun-disc colour — the specular glint. */
  sun: Rgb;
  /** Deep-water tint seen looking straight down. */
  water: Rgb;
}

type Rgb = readonly [number, number, number];

const VERTEX = `
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uWaterColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform sampler2D uMap;
  uniform float uGlint;
  uniform float uReflection;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  const float RIPPLE_AMP = 0.28;
  const float SWELL_SLOPE = 6.0;
  const float SHININESS = 120.0;
  const float BASE_ALPHA = 0.72;

  // Surface normal: fine fast sparkle waves (break the sun glint into a shimmering path) plus the
  // slope of a slow swell (visible drifting highlights so the water isn't dead-flat).
  vec3 waterNormal(vec2 p, float t) {
    vec2 grad = vec2(0.0);
    vec2 d0 = normalize(vec2( 0.8,  0.6)); grad += d0 * sin(dot(p, d0) * 0.08 + t * 1.1);
    vec2 d1 = normalize(vec2(-0.5,  0.9)); grad += d1 * sin(dot(p, d1) * 0.14 + t * 1.5) * 0.7;
    vec2 d2 = normalize(vec2( 0.9, -0.4)); grad += d2 * sin(dot(p, d2) * 0.24 + t * 0.9) * 0.5;
    vec2 d3 = normalize(vec2( 0.2,  1.0)); grad += d3 * sin(dot(p, d3) * 0.37 + t * 1.8) * 0.35;
    grad *= RIPPLE_AMP;
    float c = 0.5 * 0.022 * cos((p.x + p.y) * 0.022 + t * 0.9); // shared cross-swell term
    grad.x += (0.015 * cos(p.x * 0.015 + t * 0.7) + c) * SWELL_SLOPE;
    grad.y += (0.8 * 0.011 * cos(p.y * 0.011 - t * 0.6) + c) * SWELL_SLOPE;
    return normalize(vec3(-grad.x, 1.0, -grad.y));
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 n = waterNormal(vWorldPos.xz, uTime);

    // Fresnel: grazing angles reflect the sky horizon, top-down shows the water tint.
    float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 5.0);
    vec3 base = mix(uWaterColor, uHorizonColor, clamp(fres * uReflection, 0.0, 1.0));
    float tex = texture2D(uMap, vUv).r; // a hint of the original water texture (caustic detail)
    base *= 0.75 + 0.5 * tex;

    // Sun specular glint (reflected sun toward the eye); the ripples shatter it into sparkles.
    vec3 refl = reflect(-uSunDir, n);
    float spec = pow(max(dot(refl, viewDir), 0.0), SHININESS);
    vec3 col = base + uSunColor * spec * uGlint;

    gl_FragColor = vec4(col, mix(BASE_ALPHA, 1.0, fres));
  }
`;

/**
 * Water surface upgrade: swaps the flat textured water mesh's material for a
 * `ShaderMaterial` with animated ripple normals + a slow swell (drifting highlights),
 * a fresnel sky reflection (deep water → horizon colour at grazing angles) and a
 * specular **sun glint** along the sun direction. Colours come from timecyc each frame;
 * the glint pairs with bloom. Renderware-free (the mesh/geometry is built in the adapter
 * and passed in).
 */
export class WaterPlugin implements Plugin {
  readonly name = 'water';

  private readonly getHour: () => number;
  private readonly getSunDir: () => Vector3;
  private material: null | ShaderMaterial = null;
  private readonly mesh: Mesh;
  private readonly sample: (hour: number) => WaterSample;

  constructor(mesh: Mesh, sample: (hour: number) => WaterSample, getHour: () => number, getSunDir: () => Vector3) {
    this.mesh = mesh;
    this.sample = sample;
    this.getHour = getHour;
    this.getSunDir = getSunDir;
  }

  dispose(): void {
    this.material?.dispose();
  }

  install(context: PluginContext): void {
    const previous = this.mesh.material as MeshBasicMaterial;
    const map = previous.map;
    this.material = new ShaderMaterial({
      depthWrite: false,
      fragmentShader: FRAGMENT,
      side: DoubleSide,
      transparent: true,
      uniforms: {
        uGlint: { value: context.config.graphics.water.glint },
        uHorizonColor: { value: new Color() },
        uMap: { value: map },
        uReflection: { value: context.config.graphics.water.reflection },
        uSunColor: { value: new Color() },
        uSunDir: { value: this.getSunDir().clone() },
        uTime: { value: 0 },
        uWaterColor: { value: new Color() },
      },
      vertexShader: VERTEX,
    });
    this.mesh.material = this.material;
    previous.dispose();
  }

  update(context: PluginContext): void {
    if (!this.material) {
      return;
    }
    const sky = this.sample(this.getHour());
    const u = this.material.uniforms;
    u.uTime.value = context.clock.elapsed;
    u.uGlint.value = context.config.graphics.water.glint;
    u.uReflection.value = context.config.graphics.water.reflection;
    (u.uSunDir.value as Vector3).copy(this.getSunDir());
    // Raw sRGB (ShaderMaterial output isn't colorspace-converted) so the water matches the sky dome.
    (u.uWaterColor.value as Color).setRGB(sky.water[0] / 255, sky.water[1] / 255, sky.water[2] / 255);
    (u.uHorizonColor.value as Color).setRGB(sky.horizon[0] / 255, sky.horizon[1] / 255, sky.horizon[2] / 255);
    (u.uSunColor.value as Color).setRGB(sky.sun[0] / 255, sky.sun[1] / 255, sky.sun[2] / 255);
  }
}
