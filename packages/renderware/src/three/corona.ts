import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';

/**
 * Render layer for glow point clouds (coronas). They are excluded from AO's normal prepass: its
 * override material never writes `gl_PointSize`, so point sprites would smear undefined-size phantom
 * quads into the normal buffer (large flickering dark squares on facades behind street lamps). The
 * main camera must have this layer enabled; the AO normal pass disables it while it renders.
 */
export const GLOW_LAYER = 2;

/** A placed corona: a world-space (GTA Z-up) glow point from a 2d-effect light. */
export interface CoronaEntry {
  /** RGB 0–255. */
  color: [number, number, number];
  /** Distance (world units) past which the corona fades out. */
  farClip: number;
  /** World position (GTA Z-up, under the streaming root). */
  position: [number, number, number];
  /** Corona base size (SA units). */
  size: number;
}

const VERTEX = `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aFar;
  uniform float uViewportHeight;
  uniform float uScale;
  uniform float uDrawDistance; // global near-field cap: coronas fade out by this distance
  uniform float uBias; // view-space metres to pull the corona's DEPTH toward the camera (clears its own housing)
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.001);
    gl_Position = projectionMatrix * mv;
    // Depth bias — DEPTH ONLY (screen position untouched): test as if the bulb sat uBias metres nearer, so
    // the corona escapes the thin lamp housing it sits in, while geometry more than uBias metres in front
    // (buildings, bridge decks) still occludes it. A linear view-space bias stays consistent with distance: a
    // fixed clip-space offset blew up near the far plane and punched through far walls; an mv.z bias before
    // projection shifted x/y. Camera looks down -z, so +uBias moves the depth toward the camera.
    vec4 biased = projectionMatrix * vec4(mv.xy, mv.z + uBias, 1.0);
    gl_Position.z = biased.z / biased.w * gl_Position.w;
    // World size → screen pixels: proj[1][1] = 1/tan(fov/2); NDC height = viewport pixels / 2.
    float px = aSize * uScale * projectionMatrix[1][1] * uViewportHeight / (2.0 * dist);
    gl_PointSize = clamp(px, 0.0, 256.0);
    // Fade toward the per-lamp far-clip AND the configurable global draw distance (whichever is nearer).
    float farFade = 1.0 - smoothstep(aFar * 0.75, aFar, dist);
    float distFade = 1.0 - smoothstep(uDrawDistance * 0.8, uDrawDistance, dist);
    vFade = farFade * distFade;
  }
`;

const FRAGMENT = `
  uniform float uOn;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float glow = smoothstep(1.0, 0.0, length(gl_PointCoord * 2.0 - 1.0));
    glow *= glow; // tighter, brighter core
    float a = glow * uOn * vFade;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/**
 * Shared additive material for all corona point clouds. Its `uOn` (night/lights-on factor) and
 * `uViewportHeight` (for perspective-correct point sizing) are driven each frame by the game layer;
 * every streamed cell's corona `Points` reuses this one material so a single update covers them all.
 */
export const coronaMaterial = new ShaderMaterial({
  blending: AdditiveBlending,
  // Depth-tested so world geometry (buildings, bridge decks) occludes coronas; never writes depth (it's a glow).
  depthWrite: false,
  fragmentShader: FRAGMENT,
  transparent: true,
  uniforms: {
    uBias: { value: 1 }, // metres the corona's depth is pulled toward the camera (escape its own housing)
    uDrawDistance: { value: 120 },
    uOn: { value: 0 },
    uScale: { value: 1 },
    uViewportHeight: { value: 1080 },
  },
  vertexShader: VERTEX,
});

/** Build a `Points` glow cloud for a cell's coronas (or null if there are none), using {@link coronaMaterial}. */
export function buildCoronaPoints(entries: readonly CoronaEntry[]): null | Points {
  if (entries.length === 0) {
    return null;
  }
  const count = entries.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const fars = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const e = entries[i];
    positions[i * 3] = e.position[0];
    positions[i * 3 + 1] = e.position[1];
    positions[i * 3 + 2] = e.position[2];
    colors[i * 3] = e.color[0] / 255;
    colors[i * 3 + 1] = e.color[1] / 255;
    colors[i * 3 + 2] = e.color[2] / 255;
    sizes[i] = e.size;
    fars[i] = e.farClip;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aFar', new BufferAttribute(fars, 1));
  geometry.computeBoundingSphere();
  const points = new Points(geometry, coronaMaterial);
  points.renderOrder = 2; // after opaque + transparent geometry
  points.name = 'Coronas';
  points.layers.set(GLOW_LAYER); // excluded from the AO normal prepass (see GLOW_LAYER)

  return points;
}
