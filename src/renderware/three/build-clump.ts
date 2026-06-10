import type { MeshBasicMaterial, Texture } from 'three';

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';

import type { RWClump, RWGeometry, RWMaterial, RWTriangle } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { buildWorldMaterial } from './world-material';

/**
 * Convert a parsed RWClump into a renderable three.js Group.
 *
 * One Mesh per atomic. Triangles are grouped by material index into geometry
 * groups so a single BufferGeometry can carry several materials. Missing
 * normals are computed. The root is rotated from RenderWare's Z-up space into
 * three.js Y-up.
 */
export interface BuildClumpOptions {
  /** Rotate the result from RenderWare Z-up into three.js Y-up. Default true.
   *  Set false when placing instances in shared GTA world (Z-up) space. */
  convertToYUp?: boolean;
}

/** Stand-in for the rare geometry slice whose material table is empty (renders plain white). */
const FALLBACK_RW_MATERIAL: RWMaterial = { color: [255, 255, 255, 255], texture: null, textured: false };

/** A model's 2d-effect light in clump-local space (frame transform applied; still native Z-up). */
export interface ClumpLight {
  color: [number, number, number];
  farClip: number;
  position: [number, number, number];
  size: number;
}

/** A single-material renderable slice of a clump (for InstancedMesh). */
export interface RenderPart {
  geometry: BufferGeometry;
  /** The unlit SA world material (plan 038) — the map is prelit, never dynamically lit. */
  material: MeshBasicMaterial;
  /** Minimum day-prelit ALPHA, present only when some vertex alpha < 255 — wind-adapted vegetation
   *  encodes per-vertex sway weight there (plan 039: 255 = rigid trunk, lower = swaying canopy).
   *  The geometry then also carries a `swayWeight` attribute (= (255 − a) / 255). */
  swayAlphaMin?: number;
}

export function buildClump(clump: RWClump, textures?: Map<string, Texture>, options: BuildClumpOptions = {}): Group {
  const root = new Group();
  root.name = 'RWClump';

  for (const atomic of clump.atomics) {
    const rwGeometry = clump.geometries[atomic.geometryIndex];
    const frame = clump.frames[atomic.frameIndex];
    if (!rwGeometry) {
      continue;
    }

    const geometry = buildGeometry(rwGeometry);
    const materials = rwGeometry.materials.map((m) => buildMaterial(m, rwGeometry, textures));
    const mesh = new Mesh(geometry, materials.length > 0 ? materials : undefined);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = frame?.name ?? `atomic_${atomic.geometryIndex}`;

    if (frame) {
      mesh.applyMatrix4(frameMatrix(frame.rotation, frame.position));
    }
    root.add(mesh);
  }

  if (options.convertToYUp ?? true) {
    root.rotateX(-Math.PI / 2); // RenderWare Z-up -> three.js Y-up
  }

  return root;
}

/**
 * Extract a clump's 2d-effect lights/coronas, each placed by its atomic's frame transform into
 * clump-local space (native Z-up — the streaming root applies the Z-up→Y-up rotation, like the parts).
 * Empty when the model has no lights. The caller multiplies these by each instance transform.
 */
export function buildClumpLights(clump: RWClump): ClumpLight[] {
  const lights: ClumpLight[] = [];
  const point = new Vector3();
  for (const atomic of clump.atomics) {
    const rw = clump.geometries[atomic.geometryIndex];
    if (!rw || rw.lights.length === 0) {
      continue;
    }
    const frame = clump.frames[atomic.frameIndex];
    const matrix = frame ? frameMatrix(frame.rotation, frame.position) : new Matrix4();
    for (const light of rw.lights) {
      point.set(light.position[0], light.position[1], light.position[2]).applyMatrix4(matrix);
      lights.push({
        color: [light.color[0], light.color[1], light.color[2]],
        farClip: light.coronaFarClip,
        position: [point.x, point.y, point.z],
        size: light.coronaSize,
      });
    }
  }

  return lights;
}

/**
 * Flatten a clump into single-material {@link RenderPart}s for instanced
 * rendering. Unlike {@link buildClump} (one multi-material Mesh per atomic),
 * each part carries exactly one geometry + one material so it can drive an
 * InstancedMesh. Parts stay in native Z-up — the caller (map scene root) does
 * the single Z-up→Y-up rotation. Shared vertex attributes are reused across a
 * model's parts so the GPU uploads them once.
 */
export function buildClumpParts(clump: RWClump, textures?: Map<string, Texture>): RenderPart[] {
  const parts: RenderPart[] = [];
  for (const atomic of clump.atomics) {
    const rw = clump.geometries[atomic.geometryIndex];
    if (!rw) {
      continue;
    }
    // NB the DFF's frame transform is deliberately IGNORED for map models, like SA: CFileLoader
    // re-frames atomic-model atomics onto a fresh identity frame, so map geometry lives in raw
    // model space (== its COL space). Vanilla frames are identity anyway; dirty re-exports
    // (gta3-pf CE_grndPALCST05 shipped a stray (12.9, 317, −28.5) frame translation) would
    // otherwise render ~300 m away from their collision.

    const position = new BufferAttribute(rw.positions, 3);
    const uv = rw.uvLayers.length > 0 ? new BufferAttribute(rw.uvLayers[0], 2) : null;
    const color = rw.prelitColors ? prelitColorAttribute(rw.prelitColors) : null;
    // SA night (extra) vertex colours — bright warm texels are lit windows; added as emissive at night.
    const nightColor = rw.nightColors ? prelitColorAttribute(rw.nightColors) : null;
    const normal = vertexNormalAttribute(position, rw);
    // Wind-adapted vegetation encodes per-vertex sway weight in the day-prelit ALPHA (plan 039).
    const sway = rw.prelitColors ? swayWeightAttribute(rw.prelitColors) : null;

    groupTrianglesByMaterial(rw.triangles, rw.materials.length).forEach((tris, materialIndex) => {
      if (tris.length === 0) {
        return;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', position);
      if (uv) {
        geometry.setAttribute('uv', uv);
      }
      if (color) {
        geometry.setAttribute('color', color);
      }
      if (nightColor) {
        geometry.setAttribute('nightColor', nightColor);
      }
      if (sway) {
        geometry.setAttribute('swayWeight', sway.attribute);
      }
      geometry.setAttribute('normal', normal);
      const index: number[] = [];
      for (const tri of tris) {
        index.push(tri.a, tri.b, tri.c);
      }
      geometry.setIndex(index);
      geometry.computeBoundingSphere();

      // Unlit SA prelit blend (plan 038) — the night set is consumed by the material's dnBalance mix.
      const rwMaterial = rw.materials[materialIndex] ?? rw.materials[0];
      const material = buildWorldMaterial(rwMaterial ?? FALLBACK_RW_MATERIAL, rw, textures);
      parts.push({ geometry, material, ...(sway ? { swayAlphaMin: sway.minAlpha } : {}) });
    });
  }

  return parts;
}

export function buildGeometry(rw: RWGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(rw.positions, 3));

  if (rw.uvLayers.length > 0) {
    geometry.setAttribute('uv', new BufferAttribute(rw.uvLayers[0], 2));
  }

  if (rw.prelitColors) {
    const colors = new Float32Array((rw.prelitColors.length / 4) * 3);
    for (let i = 0, j = 0; i < rw.prelitColors.length; i += 4, j += 3) {
      colors[j] = rw.prelitColors[i] / 255;
      colors[j + 1] = rw.prelitColors[i + 1] / 255;
      colors[j + 2] = rw.prelitColors[i + 2] / 255;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
  }

  // Build an index buffer ordered by material, adding one group per material so
  // each face is drawn with the right material.
  const byMaterial = groupTrianglesByMaterial(rw.triangles, rw.materials.length);
  const index: number[] = [];
  let start = 0;
  byMaterial.forEach((tris, materialIndex) => {
    for (const tri of tris) {
      index.push(tri.a, tri.b, tri.c);
    }
    const count = tris.length * 3;
    if (count > 0) {
      geometry.addGroup(start, count, materialIndex);
      start += count;
    }
  });
  geometry.setIndex(index);

  if (rw.normals) {
    // Stored normals can be exporter garbage too (PF re-exports ship all-zero blocks — black faces);
    // repair is in-place and idempotent, so mutating the cached parse is safe. See plan 037.
    sanitizeDegenerateNormals(rw.normals, rw.positions, rw.triangles);
    geometry.setAttribute('normal', new BufferAttribute(rw.normals, 3));
  } else {
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal') as BufferAttribute;
    sanitizeDegenerateNormals(normal.array as Float32Array, rw.positions, rw.triangles);
  }
  geometry.computeBoundingSphere();

  return geometry;
}

export function buildMaterial(
  rw: RWMaterial,
  geometry: RWGeometry,
  textures?: Map<string, Texture>,
): MeshStandardMaterial {
  const map = rw.texture && textures ? (textures.get(rw.texture.name.toLowerCase()) ?? null) : null;
  const hasVertexColors = (geometry.flags & GeometryFlag.PRELIT) !== 0;
  const transparent = map ? Boolean(map.userData.hasAlpha) : rw.color[3] < 255;

  const params = {
    alphaTest: transparent ? 0.5 : 0,
    color: map ? 0xffffff : (rw.color[0] << 16) | (rw.color[1] << 8) | rw.color[2],
    map,
    metalness: 0,
    roughness: 1,
    side: transparent ? DoubleSide : FrontSide,
    transparent,
    vertexColors: hasVertexColors,
  };

  // Env-map-reflective materials are built as MeshPhysicalMaterial so the vehicle-reflection plugin can
  // add a reflective **clearcoat** (glossy lacquer over the saturated paint) per the active preset.
  const env = rw.effects?.envMap;
  const reflective = env !== undefined && env.coefficient > 0;
  const material = reflective
    ? new MeshPhysicalMaterial({ ...params, clearcoat: 0 })
    : new MeshStandardMaterial(params);
  material.name = rw.texture?.name ?? 'material';

  // Carry the SA reflection-plugin data (preset-independent; shape matches `VehicleReflectionData` in
  // game/**) as plain userData so renderware stays free of game-layer types.
  if (env && env.coefficient > 0) {
    material.userData.reflection = {
      coefficient: env.coefficient,
      envTexture: env.texture,
      intensity: rw.effects?.reflection?.intensity ?? 0,
      offset: rw.effects?.reflection?.offset ?? [0, 0],
      scale: rw.effects?.reflection?.scale ?? [1, 1],
      specularLevel: rw.effects?.specular?.level ?? 0,
    };
    // Resolve the DFF-named env texture (vehicleenvmap128 / custom) and wire the SA sphere-map shader
    // so the PC/PS2 presets can reflect it the authentic way (toggled by a uniform from the game plugin).
    const saEnvMap = env.texture && textures ? (textures.get(env.texture.toLowerCase()) ?? null) : null;
    if (saEnvMap) {
      installSaReflection(material as MeshPhysicalMaterial, saEnvMap);
    }
  }

  return material;
}

export function frameMatrix(rotation: number[], position: [number, number, number]): Matrix4 {
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rotation;
  const matrix = new Matrix4();
  // RW stores right/up/at basis vectors; lay them into column-major Matrix4.
  matrix.set(r0, r3, r6, position[0], r1, r4, r7, position[1], r2, r5, r8, position[2], 0, 0, 0, 1);

  return matrix;
}

export function groupTrianglesByMaterial(triangles: RWTriangle[], materialCount: number): RWTriangle[][] {
  const groups: RWTriangle[][] = Array.from({ length: Math.max(1, materialCount) }, () => []);
  for (const tri of triangles) {
    const slot = tri.materialIndex < groups.length ? tri.materialIndex : 0;
    groups[slot].push(tri);
  }

  return groups;
}

/** Normalised geometric normal of a triangle from its vertex positions, or null when degenerate (zero area). */
function faceNormal(p: Float32Array, a: number, b: number, c: number): [number, number, number] | null {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) {
    return null;
  }

  return [nx / len, ny / len, nz / len];
}

/**
 * Wire the GTA-SA env-map reflection (PC/PS2) into a reflective material via `onBeforeCompile`: an additive
 * **sphere/matcap** reflection of `saEnvMap`, sampled by the **camera-space normal** (so it's screen-locked
 * like the original `CCustomCarEnvMapPipeline`). Gated by a `saStrength` uniform the vehicle-reflection plugin
 * drives per preset (0 for non-SA presets). The uniform holders live in `userData.saReflect`.
 */
function installSaReflection(material: MeshPhysicalMaterial, saEnvMap: Texture): void {
  const saReflect = { saEnvMap: { value: saEnvMap }, saStrength: { value: 0 } };
  material.userData.saReflect = saReflect;
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.saEnvMap = saReflect.saEnvMap;
    shader.uniforms.saStrength = saReflect.saStrength;
    shader.fragmentShader = `uniform sampler2D saEnvMap;\nuniform float saStrength;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec3 saV = normalize( vViewPosition );
        vec3 saXx = normalize( vec3( saV.z, 0.0, -saV.x ) );
        vec3 saYy = cross( saV, saXx );
        vec2 saUV = vec2( dot( saXx, normal ), dot( saYy, normal ) ) * 0.495 + 0.5;
        totalEmissiveRadiance += texture2D( saEnvMap, saUV ).rgb * saStrength;
      }`,
    );
  };
  material.needsUpdate = true;
}

function prelitColorAttribute(prelit: Uint8Array): BufferAttribute {
  const colors = new Float32Array((prelit.length / 4) * 3);
  for (let i = 0, j = 0; i < prelit.length; i += 4, j += 3) {
    colors[j] = prelit[i] / 255;
    colors[j + 1] = prelit[i + 1] / 255;
    colors[j + 2] = prelit[i + 2] / 255;
  }

  return new BufferAttribute(colors, 3);
}

/**
 * Repair zero-length (or NaN/Infinity) vertex normals — both ones left by `computeVertexNormals` and ones
 * **stored in the DFF**. Computed normals cancel to zero when a vertex is shared by triangles with opposite
 * winding (coincident double-sided panels — neon signs — or unclean world meshes like some SA roads); stored
 * normals arrive zeroed from dirty re-exports (gta3-pf.img casroyale02/04 — SA's prelit-only map pipeline never
 * reads them, so the mod shipped garbage; plan 037). A zero normal yields no diffuse term, so the face renders
 * **pure black** under any light. We give each such vertex the geometric face normal of an incident triangle
 * (the flat surface direction; `DoubleSide` materials still flip it per back-face), falling back to +Z up only
 * if every incident triangle is degenerate. Valid normals are left untouched, so smooth shading elsewhere is
 * unchanged, and the repair is idempotent (safe on the cached parse).
 */
function sanitizeDegenerateNormals(normals: Float32Array, positions: Float32Array, triangles: RWTriangle[]): void {
  const bad = new Set<number>();
  for (let v = 0; v < normals.length / 3; v += 1) {
    const x = normals[v * 3];
    const y = normals[v * 3 + 1];
    const z = normals[v * 3 + 2];
    const lengthSq = x * x + y * y + z * z;
    if (!Number.isFinite(lengthSq) || lengthSq < 1e-8) {
      bad.add(v); // zero-length or NaN/Infinity — both render black/undefined
    }
  }
  if (bad.size === 0) {
    return;
  }
  for (const tri of triangles) {
    if (!bad.has(tri.a) && !bad.has(tri.b) && !bad.has(tri.c)) {
      continue;
    }
    const face = faceNormal(positions, tri.a, tri.b, tri.c);
    if (!face) {
      continue; // degenerate triangle — try another incident one
    }
    for (const v of [tri.a, tri.b, tri.c]) {
      if (bad.delete(v)) {
        normals[v * 3] = face[0];
        normals[v * 3 + 1] = face[1];
        normals[v * 3 + 2] = face[2];
      }
    }
  }
  for (const v of bad) {
    normals[v * 3] = 0; // only-degenerate-triangle vertices: harmless up normal
    normals[v * 3 + 1] = 0;
    normals[v * 3 + 2] = 1;
  }
}

/**
 * Per-vertex sway weights from the day-prelit ALPHA channel, or null when every alpha is 255 (the
 * model is not wind-adapted). Weight = (255 − a) / 255: alpha 255 → 0 (rigid trunk), lower alpha →
 * more sway (cedar canopies ship 0xAA ≈ 0.33, dead trees 0xDC ≈ 0.14). `minAlpha` lets the caller
 * reject fade-style alpha gradients (skirts go near 0) as sway candidates.
 */
function swayWeightAttribute(prelit: Uint8Array): null | { attribute: BufferAttribute; minAlpha: number } {
  let minAlpha = 255;
  for (let i = 3; i < prelit.length; i += 4) {
    if (prelit[i] < minAlpha) {
      minAlpha = prelit[i];
    }
  }
  if (minAlpha === 255) {
    return null;
  }
  const weights = new Float32Array(prelit.length / 4);
  for (let i = 3, j = 0; i < prelit.length; i += 4, j += 1) {
    weights[j] = (255 - prelit[i]) / 255;
  }

  return { attribute: new BufferAttribute(weights, 1), minAlpha };
}

function vertexNormalAttribute(position: BufferAttribute, rw: RWGeometry): BufferAttribute {
  if (rw.normals) {
    // Stored garbage too (zeroed PF re-exports) — see plan 037.
    sanitizeDegenerateNormals(rw.normals, rw.positions, rw.triangles);

    return new BufferAttribute(rw.normals, 3);
  }
  const temporary = new BufferGeometry();
  temporary.setAttribute('position', position);
  const index: number[] = [];
  for (const tri of rw.triangles) {
    index.push(tri.a, tri.b, tri.c);
  }
  temporary.setIndex(index);
  temporary.computeVertexNormals();
  const normal = temporary.getAttribute('normal') as BufferAttribute;
  sanitizeDegenerateNormals(normal.array as Float32Array, rw.positions, rw.triangles);

  return normal;
}
