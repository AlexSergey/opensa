import type { Texture } from 'three';

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
} from 'three';

import type { RWClump, RWGeometry, RWMaterial, RWTriangle } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';

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
      parts.push({ geometry, material, matrix });
    });
  }

  return parts;
}

export function buildMaterial(
  rw: RWMaterial,
  geometry: RWGeometry,
  textures?: Map<string, Texture>,
): MeshStandardMaterial {
  const map = rw.texture && textures ? (textures.get(rw.texture.name.toLowerCase()) ?? null) : null;
  const hasVertexColors = (geometry.flags & GeometryFlag.PRELIT) !== 0;
  const transparent = map ? Boolean(map.userData.hasAlpha) : rw.color[3] < 255;

  const material = new MeshStandardMaterial({
    alphaTest: transparent ? 0.5 : 0,
    color: map ? 0xffffff : (rw.color[0] << 16) | (rw.color[1] << 8) | rw.color[2],
    map,
    metalness: 0,
    roughness: 1,
    side: transparent ? DoubleSide : FrontSide,
    transparent,
    vertexColors: hasVertexColors,
  });
  material.name = rw.texture?.name ?? 'material';

  return material;
}

export function groupTrianglesByMaterial(triangles: RWTriangle[], materialCount: number): RWTriangle[][] {
  const groups: RWTriangle[][] = Array.from({ length: Math.max(1, materialCount) }, () => []);
  for (const tri of triangles) {
    const slot = tri.materialIndex < groups.length ? tri.materialIndex : 0;
    groups[slot].push(tri);
  }

  return groups;
}

function buildGeometry(rw: RWGeometry): BufferGeometry {
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

function frameMatrix(rotation: number[], position: [number, number, number]): Matrix4 {
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rotation;
  const matrix = new Matrix4();
  // RW stores right/up/at basis vectors; lay them into column-major Matrix4.
  matrix.set(r0, r3, r6, position[0], r1, r4, r7, position[1], r2, r5, r8, position[2], 0, 0, 0, 1);

  return matrix;
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
