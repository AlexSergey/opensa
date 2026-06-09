import type { Texture } from 'three';

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
import { applyNightVertexEmissive } from './night-vertex-colors';

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
  material: MeshStandardMaterial;
  /** Local atomic-frame transform, in native Z-up. */
  matrix: Matrix4;
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
    const frame = clump.frames[atomic.frameIndex];
    const matrix = frame ? frameMatrix(frame.rotation, frame.position) : new Matrix4();

    const position = new BufferAttribute(rw.positions, 3);
    const uv = rw.uvLayers.length > 0 ? new BufferAttribute(rw.uvLayers[0], 2) : null;
    const color = rw.prelitColors ? prelitColorAttribute(rw.prelitColors) : null;
    // SA night (extra) vertex colours — bright warm texels are lit windows; added as emissive at night.
    const nightColor = rw.nightColors ? prelitColorAttribute(rw.nightColors) : null;
    const normal = vertexNormalAttribute(position, rw);

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
      geometry.setAttribute('normal', normal);
      const index: number[] = [];
      for (const tri of tris) {
        index.push(tri.a, tri.b, tri.c);
      }
      geometry.setIndex(index);
      geometry.computeBoundingSphere();

      const rwMaterial = rw.materials[materialIndex] ?? rw.materials[0];
      const material = rwMaterial
        ? buildMaterial(rwMaterial, rw, textures)
        : new MeshStandardMaterial({ vertexColors: color !== null });
      if (nightColor && material.map) {
        applyNightVertexEmissive(material); // night windows glow via the `nightColor` attribute (× texture)
      }
      parts.push({ geometry, material, matrix });
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
    geometry.setAttribute('normal', new BufferAttribute(rw.normals, 3));
  } else {
    geometry.computeVertexNormals();
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

/**
 * Lowest point of a clump's geometry in clump-local space (native Z-up) — the model's "foot". For a lamp this
 * is where the pole meets the ground, so a light pool placed at `instance.z + clumpFloorZ` lands on the road
 * regardless of where the model's origin sits (base, centre, …). Returns 0 if the clump has no geometry. Uses
 * each geometry's 8 bbox corners transformed by its frame (cheap; exact for the axis-aligned-after-yaw case).
 */
export function clumpFloorZ(clump: RWClump): number {
  const corner = new Vector3();
  let floor = Infinity;
  for (const atomic of clump.atomics) {
    const rw = clump.geometries[atomic.geometryIndex];
    if (!rw || rw.positions.length === 0) {
      continue;
    }
    const frame = clump.frames[atomic.frameIndex];
    const matrix = frame ? frameMatrix(frame.rotation, frame.position) : new Matrix4();
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const p = rw.positions;
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i]);
      maxX = Math.max(maxX, p[i]);
      minY = Math.min(minY, p[i + 1]);
      maxY = Math.max(maxY, p[i + 1]);
      minZ = Math.min(minZ, p[i + 2]);
      maxZ = Math.max(maxZ, p[i + 2]);
    }
    for (let c = 0; c < 8; c += 1) {
      corner.set(c & 1 ? maxX : minX, c & 2 ? maxY : minY, c & 4 ? maxZ : minZ).applyMatrix4(matrix);
      floor = Math.min(floor, corner.z);
    }
  }

  return floor === Infinity ? 0 : floor;
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

function vertexNormalAttribute(position: BufferAttribute, rw: RWGeometry): BufferAttribute {
  if (rw.normals) {
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

  return temporary.getAttribute('normal') as BufferAttribute;
}
