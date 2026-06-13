import type { Matrix4, Object3D, Texture } from 'three';

import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, Mesh, ShaderMaterial, Vector3 } from 'three';

import type { RWBreakable } from '../parsers/binary/types';

import { GLOW_LAYER } from './corona';

/**
 * Breakable-prop debris (plan 045): when a prop smashes, its Breakable shatter mesh becomes one
 * Mesh of flying per-triangle shards. All motion is analytic in the vertex shader (the particles
 * pattern — zero per-frame CPU): each shard gets a velocity, a spin and a precomputed landing
 * time; it flies a ballistic arc, spins around its centroid, freezes where it lands and fades
 * out at the end of the lifetime. The whole mesh despawns afterwards.
 *
 * Geometry is baked in world space (GTA Z-up, the streaming-root space) at break time — gravity
 * runs along −Z, so the mesh itself sits at identity like the roadsigns/particles.
 */

/** Parameters of one break: where the shards land and what flung them. */
export interface DebrisImpact {
  /**
   * Ground height (GTA Z) the shards rest on. **MVP (plan 045): omitted in the game** — without a
   * real ground probe the shards instead fall straight through and sink underground as they fade
   * (the placement Z is the prop base for some props but its centre for others, which froze tall
   * props' shards in mid-air). TODO: replace the analytic landing with real per-shard physics +
   * ground contact, then probe and pass a real `groundZ`. Tests still pass one for the landing path.
   */
  groundZ?: number;
  /** Impact velocity seed (world Z-up, m/s) — shards inherit a share, flying away from the hit. */
  impact?: [number, number, number];
  /** RNG seed for deterministic shards (tests / replays). Defaults to a transform-derived seed. */
  seed?: number;
}

/** Wall-clock seconds driving every debris lifecycle (set per frame by the game). */
export const debrisTimeUniform = { value: 0 };

/** Seconds a break lives before the mesh despawns (fade occupies the tail). */
export const DEBRIS_LIFETIME = 5;
const DEBRIS_FADE = 1.4;
const GRAVITY = 9.81;
/** Simultaneous break budget — the oldest break expires early when exceeded. */
const MAX_ACTIVE_DEBRIS = 8;

/** Plain white stand-in for shards whose texture is missing from the model's TXD. */
const WHITE_TEXTURE = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE_TEXTURE.needsUpdate = true;

const VERTEX = `
  attribute vec3 aCenter;
  attribute vec3 aVelocity;
  attribute vec3 aAngular;
  attribute float aLandTime;
  uniform float uTime;
  uniform float uSpawn;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFade;

  vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);

    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }

  void main() {
    float age = max(uTime - uSpawn, 0.0);
    // Shards freeze (translation AND spin) the moment they land.
    float t = min(age, aLandTime);
    float speed = length(aAngular);
    vec3 axis = speed > 1e-5 ? aAngular / speed : vec3(0.0, 0.0, 1.0);
    vec3 offset = rotateAxis(position - aCenter, axis, speed * t);
    vec3 center = aCenter + aVelocity * t + vec3(0.0, 0.0, -0.5 * ${GRAVITY.toFixed(2)}) * t * t;
    vUv = uv;
    vColor = color;
    vFade = 1.0 - smoothstep(${(DEBRIS_LIFETIME - DEBRIS_FADE).toFixed(2)}, ${DEBRIS_LIFETIME.toFixed(2)}, age);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(center + offset, 1.0);
  }
`;

const FRAGMENT = `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFade;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float a = tex.a * vColor.a * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(tex.rgb * vColor.rgb, a);
  }
`;

interface ActiveDebris {
  mesh: Mesh;
  spawnedAt: number;
}

const active: ActiveDebris[] = [];

/**
 * Build the shard mesh for one break: the Breakable mesh placed by the prop's world transform,
 * de-indexed into per-triangle pieces with baked flight attributes. One geometry group (and one
 * draw) per distinct shard texture; per-material ambient is baked into the vertex colours.
 */
export function buildDebrisMesh(
  breakable: RWBreakable,
  transform: Matrix4,
  options: DebrisImpact,
  textures?: Map<string, Texture>,
): Mesh {
  const triangleCount = breakable.triangleMaterials.length;
  const random = mulberry32(options.seed ?? transformSeed(transform));
  const impact = options.impact ?? [0, 0, 0];

  // Group the draws by shard texture (bins author 7 identical materials — one group suffices).
  const textureKeys: string[] = [];
  const keyOf = new Map<string, number>();
  const trianglesByKey: number[][] = [];
  for (let tri = 0; tri < triangleCount; tri += 1) {
    const material = breakable.materials[breakable.triangleMaterials[tri]];
    const key = material ? material.texture : '';
    let slot = keyOf.get(key);
    if (slot === undefined) {
      slot = textureKeys.length;
      textureKeys.push(key);
      keyOf.set(key, slot);
      trianglesByKey.push([]);
    }
    trianglesByKey[slot].push(tri);
  }

  const vertexCount = triangleCount * 3;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);
  const uvs = new Float32Array(vertexCount * 2);
  const centers = new Float32Array(vertexCount * 3);
  const velocities = new Float32Array(vertexCount * 3);
  const angulars = new Float32Array(vertexCount * 3);
  const landTimes = new Float32Array(vertexCount);

  const corner = new Vector3();
  const world: Vector3[] = [new Vector3(), new Vector3(), new Vector3()];
  let cursor = 0;
  for (const triangles of trianglesByKey) {
    for (const tri of triangles) {
      const material = breakable.materials[breakable.triangleMaterials[tri]];
      const ambient = material?.ambient ?? [1, 1, 1];
      for (let i = 0; i < 3; i += 1) {
        const vertex = breakable.triangles[tri * 3 + i];
        corner.fromArray(breakable.positions, vertex * 3).applyMatrix4(transform);
        world[i].copy(corner);
      }
      const cx = (world[0].x + world[1].x + world[2].x) / 3;
      const cy = (world[0].y + world[1].y + world[2].y) / 3;
      const cz = (world[0].z + world[1].z + world[2].z) / 3;

      // Fling: a share of the impact velocity + a random horizontal scatter + an upward pop.
      const azimuth = random() * Math.PI * 2;
      const scatter = 1 + random() * 2.5;
      const vx = impact[0] * 0.6 + Math.cos(azimuth) * scatter;
      const vy = impact[1] * 0.6 + Math.sin(azimuth) * scatter;
      const vz = impact[2] * 0.3 + 2 + random() * 3;
      // Spin: random axis (uniform on the sphere), 3–12 rad/s.
      const axisZ = random() * 2 - 1;
      const axisAzimuth = random() * Math.PI * 2;
      const axisPlanar = Math.sqrt(Math.max(0, 1 - axisZ * axisZ));
      const spinSpeed = 3 + random() * 9;
      const spin = {
        x: Math.cos(axisAzimuth) * axisPlanar * spinSpeed,
        y: Math.sin(axisAzimuth) * axisPlanar * spinSpeed,
        z: axisZ * spinSpeed,
      };
      // Analytic landing time of the centroid on the probed ground plane. MVP: with no ground plane
      // the shards never land — they fall through and sink underground over the lifetime, fading out.
      const landTime =
        options.groundZ === undefined
          ? DEBRIS_LIFETIME + 1
          : (vz + Math.sqrt(vz * vz + 2 * GRAVITY * Math.max(0, cz - options.groundZ))) / GRAVITY;

      for (let i = 0; i < 3; i += 1) {
        const slot = cursor + i;
        positions.set([world[i].x, world[i].y, world[i].z], slot * 3);
        const vertex = breakable.triangles[tri * 3 + i];
        colors[slot * 4] = (breakable.colours[vertex * 4] / 255) * ambient[0];
        colors[slot * 4 + 1] = (breakable.colours[vertex * 4 + 1] / 255) * ambient[1];
        colors[slot * 4 + 2] = (breakable.colours[vertex * 4 + 2] / 255) * ambient[2];
        colors[slot * 4 + 3] = breakable.colours[vertex * 4 + 3] / 255;
        uvs.set([breakable.uvs[vertex * 2], breakable.uvs[vertex * 2 + 1]], slot * 2);
        centers.set([cx, cy, cz], slot * 3);
        velocities.set([vx, vy, vz], slot * 3);
        angulars.set([spin.x, spin.y, spin.z], slot * 3);
        landTimes[slot] = landTime;
      }
      cursor += 3;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('aCenter', new BufferAttribute(centers, 3));
  geometry.setAttribute('aVelocity', new BufferAttribute(velocities, 3));
  geometry.setAttribute('aAngular', new BufferAttribute(angulars, 3));
  geometry.setAttribute('aLandTime', new BufferAttribute(landTimes, 1));

  const spawnUniform = { value: debrisTimeUniform.value };
  const materials: ShaderMaterial[] = [];
  let start = 0;
  for (let slot = 0; slot < textureKeys.length; slot += 1) {
    const count = trianglesByKey[slot].length * 3;
    geometry.addGroup(start, count, slot);
    start += count;
    materials.push(
      new ShaderMaterial({
        depthWrite: false,
        fragmentShader: FRAGMENT,
        side: DoubleSide, // shards are single-sided triangles — both faces must draw
        transparent: true,
        uniforms: {
          uMap: { value: textures?.get(textureKeys[slot]) ?? WHITE_TEXTURE },
          uSpawn: spawnUniform,
          uTime: debrisTimeUniform,
        },
        vertexColors: true,
        vertexShader: VERTEX,
      }),
    );
  }

  const mesh = new Mesh(geometry, materials);
  mesh.name = 'debris';
  mesh.frustumCulled = false; // shards spread far past the static bounds; ≤ MAX_ACTIVE meshes
  // Shader-animated transparency: keep it out of the SSAO normal prepass (which would
  // rasterize the shards un-animated at their static bake positions — ghost AO).
  mesh.layers.set(GLOW_LAYER);

  return mesh;
}

/** Test hook: drop all active debris (the registry is module-level shared state). */
export function resetDebris(): void {
  active.length = 0;
}

/**
 * Break a prop: build its shard mesh, add it under `parent` (the streaming root / cell space)
 * and register it for expiry. Exceeding the simultaneous-break budget expires the oldest break
 * immediately.
 */
export function spawnDebris(
  parent: Object3D,
  breakable: RWBreakable,
  transform: Matrix4,
  options: DebrisImpact,
  textures?: Map<string, Texture>,
): Mesh {
  const mesh = buildDebrisMesh(breakable, transform, options, textures);
  parent.add(mesh);
  active.push({ mesh, spawnedAt: debrisTimeUniform.value });
  while (active.length > MAX_ACTIVE_DEBRIS) {
    expire(active.shift());
  }

  return mesh;
}

/** Advance the debris clock and despawn breaks past their lifetime. */
export function updateDebris(time: number): void {
  debrisTimeUniform.value = time;
  while (active.length > 0 && time - active[0].spawnedAt >= DEBRIS_LIFETIME) {
    expire(active.shift());
  }
}

function expire(entry: ActiveDebris | undefined): void {
  if (!entry) {
    return;
  }
  entry.mesh.removeFromParent();
  entry.mesh.geometry.dispose();
  for (const material of Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material]) {
    material.dispose();
  }
}

/** Deterministic 32-bit PRNG (mulberry32) — same seed, same shards. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed from the instance placement (same prop, same shards across sessions). */
function transformSeed(transform: Matrix4): number {
  const e = transform.elements;

  return (Math.imul(Math.round(e[12] * 100), 73856093) ^ Math.imul(Math.round(e[13] * 100), 19349663)) >>> 0;
}
