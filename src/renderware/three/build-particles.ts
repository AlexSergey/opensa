import type { Texture } from 'three';

import { AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial } from 'three';

import type { FxEmitter, FxSystem } from '../parsers/text/fxp.parser';

import { sampleFxTrack } from '../parsers/text/fxp.parser';
import { GLOW_LAYER } from './corona';

/**
 * Data-driven 2dfx particle emitters (plan 044): each map emitter entry references a system in
 * `effects.fxp`; we bake the system's keyframed tracks into per-particle attributes + a few
 * uniforms and loop the lifecycle entirely in the vertex shader — zero per-frame CPU work, one
 * draw call per (cell, system, emitter layer). Heat-haze layers (screen distortion) are skipped.
 *
 * All particle Points live on {@link GLOW_LAYER}: SSAO's normal prepass never rasterizes point
 * sprites safely (the flickering-squares bug), and the main camera has the layer enabled.
 */

/** A placed emitter: a 2dfx type-1 entry transformed to world space (GTA Z-up). */
export interface ParticleEmitterEntry {
  effectName: string;
  position: [number, number, number];
}

/** Wall-clock seconds driving every particle lifecycle (set per frame by the game). */
export const particleTimeUniform = { value: 0 };

/** Viewport height in pixels for perspective point sizing (set per frame, like the coronas). */
export const particleViewportUniform = { value: 1080 };

/** Config draw distance (world units; replaces the systems' authored CULLDIST — set per frame). */
export const particleDrawDistanceUniform = { value: 300 };

/** Live tuning applied by {@link updateParticleEffects} (mirrors the game's `graphics.effects`). */
export interface ParticleEffectsSettings {
  drawDistance: number;
  enabled: boolean;
}

/** The FX library: systems from effects.fxp + sprites from effectsPC.txd. Set once at startup;
 *  while unset, emitters simply don't build (the map renders without particles). */
let fxSystems: Map<string, FxSystem> | null = null;
let fxTextures: Map<string, Texture> | null = null;

export function setFxLibrary(systems: Map<string, FxSystem>, textures: Map<string, Texture>): void {
  fxSystems = systems;
  fxTextures = textures;
}

/** Registered emitter layers for the per-frame gating (mirrors the procobj mesh registry). */
const layers: Points[] = [];

/** Test hook: drop all registered layers (the registry is module-level shared state). */
export function resetParticleEffects(): void {
  layers.length = 0;
}

/**
 * Apply the live effects config to every attached emitter layer: `enabled` toggles visibility,
 * `drawDistance` hides layers whose whole cloud is beyond it — the shader fade uses the same
 * distance, so the CPU cutoff lands where the GPU fade hits zero. The distance REPLACES the
 * systems' authored CULLDIST (vanilla fire culls at 35 m — felt way too close), so the slider
 * has full authority. `view` is the player/camera position in GTA Z-up world space.
 */
export function updateParticleEffects(
  view: readonly [number, number, number],
  settings: ParticleEffectsSettings,
): void {
  particleDrawDistanceUniform.value = settings.drawDistance;
  for (const points of layers) {
    if (!points.parent) {
      continue; // streamed out — cached, not in the scene
    }
    if (!settings.enabled) {
      points.visible = false;
      continue;
    }
    const sphere = points.geometry.boundingSphere;
    points.visible =
      sphere === null ||
      Math.hypot(view[0] - sphere.center.x, view[1] - sphere.center.y, view[2] - sphere.center.z) - sphere.radius <=
        settings.drawDistance;
  }
}

const MAX_PARTICLES_PER_EMITTER = 48;

const VERTEX = `
  attribute vec3 aVelocity;
  attribute float aLife;
  attribute float aPhase;
  uniform float uTime;
  uniform float uViewportHeight;
  uniform vec3 uForce;
  uniform vec3 uSize; // size at age 0 / 0.5 / 1 (piecewise-linear envelope)
  uniform float uDrawDistance;
  varying float vAge;
  varying float vFade;
  void main() {
    float age = fract(uTime / aLife + aPhase);
    float t = age * aLife;
    vec3 pos = position + aVelocity * t + 0.5 * uForce * t * t;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float dist = max(-mv.z, 0.001);
    float size = age < 0.5 ? mix(uSize.x, uSize.y, age * 2.0) : mix(uSize.y, uSize.z, age * 2.0 - 1.0);
    float px = size * projectionMatrix[1][1] * uViewportHeight / (2.0 * dist);
    gl_PointSize = clamp(px, 0.0, 128.0);
    vAge = age;
    // Fade out approaching the configured draw distance. It REPLACES each system's authored
    // CULLDIST (fire culls at 35 m in vanilla — felt way too close), so the slider has full
    // authority in both directions.
    vFade = 1.0 - smoothstep(uDrawDistance * 0.8, uDrawDistance, dist);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = `
  uniform sampler2D uMap;
  uniform vec3 uColor0; // colour at age 0 / 0.5 / 1 (piecewise-linear envelope)
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uAlpha;  // alpha at age 0 / 0.5 / 1
  varying float vAge;
  varying float vFade;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float seg = clamp(vAge * 2.0, 0.0, 2.0);
    vec3 color = seg < 1.0 ? mix(uColor0, uColor1, seg) : mix(uColor1, uColor2, seg - 1.0);
    float alpha = seg < 1.0 ? mix(uAlpha.x, uAlpha.y, seg) : mix(uAlpha.y, uAlpha.z, seg - 1.0);
    float a = tex.a * alpha * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(color * tex.rgb, a);
  }
`;

/**
 * Build the particle `Points` for one cell's emitter entries. One Points per (system, emitter
 * layer) covering every entry of that system in the cell. Unknown effect names and layers whose
 * sprite is missing produce nothing (data-tolerant).
 */
export function buildParticleEmitters(entries: readonly ParticleEmitterEntry[]): Points[] {
  if (!fxSystems || !fxTextures || entries.length === 0) {
    return [];
  }
  const byEffect = new Map<string, ParticleEmitterEntry[]>();
  for (const entry of entries) {
    const list = byEffect.get(entry.effectName) ?? [];
    list.push(entry);
    byEffect.set(entry.effectName, list);
  }

  const points: Points[] = [];
  for (const [effectName, placed] of byEffect) {
    const system = fxSystems.get(effectName);
    if (!system) {
      continue;
    }
    for (const emitter of system.emitters) {
      if (emitter.name.toLowerCase().includes('heathaze')) {
        continue; // screen-distortion layer — out of scope (needs a refraction pass)
      }
      const texture = fxTextures.get(emitter.texture);
      if (!texture) {
        continue;
      }
      const built = buildLayer(system, emitter, texture, placed);
      if (built) {
        points.push(built);
      }
    }
  }

  return points;
}

function buildLayer(
  system: FxSystem,
  emitter: FxEmitter,
  texture: Texture,
  placed: readonly ParticleEmitterEntry[],
): null | Points {
  const track = (name: string, t: number, fallback: number): number => {
    const keys = emitter.tracks.get(name);

    return keys && keys.length > 0 ? sampleFxTrack(keys, t) : fallback;
  };
  // Colour rides either the COLOUR or the COLOURBRIGHT info block (fire/explosions use the
  // latter); envelopes are sampled at age 0 / 0.5 / 1 — enough for the 0→peak→0 shapes.
  const colour = (channel: string, t: number, fallback: number): number => {
    const keys = emitter.tracks.get(`colour.${channel}`) ?? emitter.tracks.get(`colourbright.${channel}`);

    return keys && keys.length > 0 ? sampleFxTrack(keys, t) : fallback;
  };
  const colourAt = (t: number): [number, number, number] => [
    colour('red', t, 255) / 255,
    colour('green', t, 255) / 255,
    colour('blue', t, 255) / 255,
  ];

  const rate = track('emrate.rate', 0, 0);
  const life = Math.max(0.15, track('emlife.life', 0, 1));
  const lifeBias = track('emlife.bias', 0, 0);
  if (rate <= 0) {
    return null;
  }
  const speed = track('emspeed.speed', 0, 1);
  const speedBias = track('emspeed.bias', 0, 0);
  const angle = (track('emangle.max', 0, 15) * Math.PI) / 180;
  const dir = [track('emdir.dirx', 0, 0), track('emdir.diry', 0, 0), track('emdir.dirz', 0, 1)];
  const perEmitter = Math.min(MAX_PARTICLES_PER_EMITTER, Math.max(2, Math.ceil(rate * (life + lifeBias))));

  const count = placed.length * perEmitter;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const lives = new Float32Array(count);
  const phases = new Float32Array(count);
  const random = mulberry32(0x9e3779b9 ^ count);

  let cursor = 0;
  for (const entry of placed) {
    for (let i = 0; i < perEmitter; i += 1) {
      positions.set(entry.position, cursor * 3);
      // Velocity: the authored direction tilted by a random angle within the emission cone.
      const tilt = angle * Math.sqrt(random());
      const azimuth = random() * Math.PI * 2;
      const sin = Math.sin(tilt);
      const v = [dir[0] + Math.cos(azimuth) * sin, dir[1] + Math.sin(azimuth) * sin, dir[2] * Math.cos(tilt)];
      const len = Math.hypot(v[0], v[1], v[2]) || 1;
      const magnitude = speed + (random() * 2 - 1) * speedBias;
      velocities[cursor * 3] = (v[0] / len) * magnitude;
      velocities[cursor * 3 + 1] = (v[1] / len) * magnitude;
      velocities[cursor * 3 + 2] = (v[2] / len) * magnitude;
      lives[cursor] = Math.max(0.15, life + (random() * 2 - 1) * lifeBias);
      phases[cursor] = random();
      cursor += 1;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aVelocity', new BufferAttribute(velocities, 3));
  geometry.setAttribute('aLife', new BufferAttribute(lives, 1));
  geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius += speed * (life + lifeBias) + 1; // particles drift past the origins
  }

  const material = new ShaderMaterial({
    blending: emitter.dstBlendId === 1 ? AdditiveBlending : NormalBlending,
    depthWrite: false,
    fragmentShader: FRAGMENT,
    transparent: true,
    uniforms: {
      uAlpha: {
        value: [colour('alpha', 0, 255) / 255, colour('alpha', 0.5, 128) / 255, colour('alpha', 1, 0) / 255],
      },
      uColor0: { value: colourAt(0) },
      uColor1: { value: colourAt(0.5) },
      uColor2: { value: colourAt(1) },
      uDrawDistance: particleDrawDistanceUniform,
      uForce: { value: [track('force.forcex', 0, 0), track('force.forcey', 0, 0), track('force.forcez', 0, 0)] },
      uMap: { value: texture },
      uSize: {
        value: [
          Math.max(0.05, track('size.sizex', 0, 0.5)),
          Math.max(0.05, track('size.sizex', 0.5, 0.75)),
          Math.max(0.05, track('size.sizex', 1, 1)),
        ],
      },
      uTime: particleTimeUniform,
      uViewportHeight: particleViewportUniform,
    },
    vertexShader: VERTEX,
  });

  const points = new Points(geometry, material);
  points.name = `fx:${system.name}:${emitter.name}`;
  points.layers.set(GLOW_LAYER);
  points.frustumCulled = true;
  layers.push(points);

  return points;
}

/** Deterministic per-layer RNG (mulberry32) so rebuilt cells emit identical particle clouds. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
