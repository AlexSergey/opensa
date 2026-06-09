import { AdditiveBlending, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial } from 'three';

/** A placed light pool: a flat additive splat laid on the ground under a 2d-effect lamp (SA's "light shadow"). */
export interface LightPoolEntry {
  /** RGB 0–255 (the lamp colour). */
  color: [number, number, number];
  /** Ground centre (GTA Z-up, under the streaming root) — bulb X/Y + an initial ground-Z estimate (the model
   *  foot). A runtime system refines the Z by raycasting the real terrain in a small window around it. */
  position: [number, number, number];
}

/** Stashed on a pool `Mesh`'s `userData.lightPools` so the game's ground-projection system can drop each pool
 *  onto the real terrain without reaching into renderware: the source entries + a closure that re-seats a
 *  pool's quad at a ground Z (keeps the vertex layout private to this module). */
export interface PendingLightPools {
  /** Re-seat pool `index`'s quad at `groundZ` (its 4 vertices) and flag the buffer for re-upload. */
  drop(index: number, groundZ: number): void;
  /** The placed pools, in build order (pool `i` ↔ vertices `4i…4i+3`). */
  readonly entries: readonly LightPoolEntry[];
}

/** Small lift off the ground so the (depth-tested, non-writing) splat sits on top of the road, not under it. */
const LIFT = 0.1;

const VERTEX = `
  attribute vec3 aColor;
  attribute vec2 aCorner; // unit quad corner (±1, ±1) on the GTA XY plane
  uniform float uDrawDistance; // the only distance cap for pools — they fade out by this (configurable)
  uniform float uRadius; // pool radius (world units) — live, so it's tunable without rebuilding cells
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vColor = aColor;
    vUv = aCorner * 0.5 + 0.5;
    vec3 world = position; // the pool centre (ground); expand to the quad on the flat XY plane by uRadius
    world.xy += aCorner * uRadius;
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    float dist = max(-mv.z, 0.001);
    gl_Position = projectionMatrix * mv;
    // Only a global distance fade — NOT the per-lamp corona far-clip (it's authored short for the bright
    // point sprite, so it made some lamps' ground pools vanish early while others persisted).
    vFade = 1.0 - smoothstep(uDrawDistance * 0.8, uDrawDistance, dist);
  }
`;

const FRAGMENT = `
  uniform float uOn;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float d = length(vUv * 2.0 - 1.0);
    float glow = smoothstep(1.0, 0.0, d);
    glow *= glow; // soft, concentrated centre
    float a = glow * uOn * vFade;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/**
 * Shared additive material for all ground light pools. `uOn` (night × the lamp-pool strength) and
 * `uDrawDistance` are driven each frame by the game layer; every cell's pool `Mesh` reuses this one
 * material. Depth-tested (the road/world occludes a pool behind a wall) but never writes depth (it's a glow).
 */
export const lightPoolMaterial = new ShaderMaterial({
  blending: AdditiveBlending,
  depthWrite: false,
  fragmentShader: FRAGMENT,
  transparent: true,
  uniforms: {
    uDrawDistance: { value: 120 },
    uOn: { value: 0 },
    uRadius: { value: 4.5 },
  },
  vertexShader: VERTEX,
});

/** Build a flat-quad `Mesh` of ground light pools for a cell (or null if there are none), using
 *  {@link lightPoolMaterial}. Each entry is a horizontal (GTA XY) quad centred under its lamp. */
export function buildLightPools(entries: readonly LightPoolEntry[]): Mesh | null {
  if (entries.length === 0) {
    return null;
  }
  const count = entries.length;
  const positions = new Float32Array(count * 4 * 3); // the pool centre, repeated per vertex (radius is a uniform)
  const corners = new Float32Array(count * 4 * 2);
  const colors = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  // Unit quad corners on the XY plane: (−1,−1) (+1,−1) (+1,+1) (−1,+1); the shader scales them by uRadius.
  const cornerX = [-1, 1, 1, -1];
  const cornerY = [-1, -1, 1, 1];
  for (let i = 0; i < count; i += 1) {
    const e = entries[i];
    const z = e.position[2] + LIFT;
    const base = i * 4;
    for (let v = 0; v < 4; v += 1) {
      const vi = base + v;
      positions[vi * 3] = e.position[0];
      positions[vi * 3 + 1] = e.position[1];
      positions[vi * 3 + 2] = z;
      corners[vi * 2] = cornerX[v];
      corners[vi * 2 + 1] = cornerY[v];
      colors[vi * 3] = e.color[0] / 255;
      colors[vi * 3 + 1] = e.color[1] / 255;
      colors[vi * 3 + 2] = e.color[2] / 255;
    }
    const idx = i * 6;
    indices[idx] = base;
    indices[idx + 1] = base + 1;
    indices[idx + 2] = base + 2;
    indices[idx + 3] = base;
    indices[idx + 4] = base + 2;
    indices[idx + 5] = base + 3;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aCorner', new BufferAttribute(corners, 2));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, lightPoolMaterial);
  mesh.renderOrder = 1; // after opaque geometry, before the coronas (renderOrder 2)
  mesh.name = 'LightPools';
  mesh.frustumCulled = false; // bounds shift as the pools are dropped onto the terrain at runtime
  const positionAttr = geometry.getAttribute('position') as BufferAttribute;
  // A runtime system rays each pool down onto the real ground and calls `drop` to re-seat it.
  const pending: PendingLightPools = {
    drop(index, groundZ): void {
      const z = groundZ + LIFT;
      const vbase = index * 4;
      for (let v = 0; v < 4; v += 1) {
        positionAttr.setZ(vbase + v, z);
      }
      positionAttr.needsUpdate = true;
    },
    entries,
  };
  mesh.userData.lightPools = pending;

  return mesh;
}
