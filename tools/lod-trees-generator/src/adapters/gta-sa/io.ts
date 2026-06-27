import type { ImgArchive } from '@opensa/renderware/archive/img-archive';
import type { RWTexture } from '@opensa/renderware/parsers/binary/types';

import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/rw-codec/dxt';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { DecodedTexture, HdTree, HdTriangle, Rgba, Vec2, Vec3 } from '../../core';

/** A name→RGBA texture map, combined from the `--txd` source. */
export type Textures = Map<string, DecodedTexture>;

/** Pick a tree-LOD DFF from the game archive as a structural template (1 geometry, 1 material, prelit). */
export function loadTemplate(archive: ImgArchive): Uint8Array {
  for (const fileName of archive.names) {
    if (!/^lod.*\.dff$/i.test(fileName)) {
      continue;
    }
    const bytes = archive.get(fileName);
    if (!bytes) {
      continue;
    }
    try {
      const dff = parseDff(bytes);
      const geometry = dff.geometries[0];
      if (dff.geometries.length === 1 && geometry.materials.length === 1 && geometry.prelitColors) {
        return new Uint8Array(bytes);
      }
    } catch {
      // unreadable / anti-rip — try the next candidate
    }
  }

  throw new Error('no suitable lod*.dff template (1 geometry, 1 material, prelit) found in --game gta3.img');
}

/** Load every texture from `--txd` (a `.txd` file or a directory of them) into one combined name→RGBA map. */
export function loadTextures(txdPath: string): Textures {
  const files = statSync(txdPath).isDirectory()
    ? readdirSync(txdPath)
        .filter((file) => file.toLowerCase().endsWith('.txd'))
        .map((file) => join(txdPath, file))
    : [txdPath];

  const textures: Textures = new Map();
  for (const file of files) {
    for (const rw of parseTxd(toArrayBuffer(readBytes(file))).textures) {
      textures.set(rw.name.toLowerCase(), decodeTexture(rw));
    }
  }

  return textures;
}

// Identity frame for atomics without a frame (and the fallback when a DFF has no atomics).
const IDENTITY_ROTATION = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO_POSITION: Vec3 = [0, 0, 0];

/**
 * Override the **trunk** triangles' prelit colour in a baked tree so the LOD atlas matches a `--prelight`-corrected
 * HD: trunk (opaque-textured) triangles take the stock ambient `trunk` colour; foliage (alpha-textured) triangles
 * keep their source prelit, staying natural. Mutates the tree's triangles in place.
 */
export function applyTrunkPrelight(tree: HdTree, trunk: readonly [number, number, number, number]): void {
  const colour: Rgba = [trunk[0], trunk[1], trunk[2], trunk[3]];
  for (const triangle of tree.triangles) {
    const foliage = triangle.texture ? (tree.textures.get(triangle.texture)?.hasAlpha ?? false) : false;
    if (!foliage) {
      triangle.colors = [colour, colour, colour];
    }
  }
}

/**
 * Transform a vertex by a RenderWare frame: the flattened 3×3 `rotation` holds the right/up/at basis vectors and
 * `position` the translation (mirrors `build-clump.ts` `frameMatrix` — the proven viewer path). Column-vector
 * convention: `out = right·x + up·y + at·z + position`.
 */
export function frameTransformPoint(rotation: readonly number[], position: Vec3, [x, y, z]: Vec3): Vec3 {
  return [
    rotation[0] * x + rotation[3] * y + rotation[6] * z + position[0],
    rotation[1] * x + rotation[4] * y + rotation[7] * z + position[1],
    rotation[2] * x + rotation[5] * y + rotation[8] * z + position[2],
  ];
}

/** Parse one HD tree into a triangle soup + bbox (native Z-up), sharing the combined `textures` map. Iterates the
 *  clump's **atomics** so each geometry is placed by its **frame transform** (a multi-atomic / frame-offset model
 *  was being baked from a mis-assembled mesh — the "LOD as if from the wrong model" bug). Warns about any
 *  referenced texture name that the `--txd` source doesn't provide (those faces render untextured). */
export function loadTree(dffPath: string, model: string, textures: Textures): HdTree {
  const dff = parseDff(toArrayBuffer(readBytes(dffPath)));
  const triangles: HdTriangle[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const missing = new Set<string>();

  // Bake the atomic instances (geometry + its frame transform); fall back to raw geometries for DFFs with none.
  const atomics =
    dff.atomics.length > 0
      ? dff.atomics
      : dff.geometries.map((_, geometryIndex) => ({ frameIndex: -1, geometryIndex }));

  for (const atomic of atomics) {
    const geometry = dff.geometries[atomic.geometryIndex];
    if (!geometry) {
      continue;
    }
    const frame = dff.frames[atomic.frameIndex];
    const rot = frame?.rotation ?? IDENTITY_ROTATION;
    const fpos = frame?.position ?? ZERO_POSITION;
    const pos = geometry.positions;
    const uv: Float32Array | undefined = geometry.uvLayers[0];
    const col = geometry.prelitColors;

    // Frame-transform every vertex once into world space.
    const world = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const p = frameTransformPoint(rot, fpos, [pos[i], pos[i + 1], pos[i + 2]]);
      world[i] = p[0];
      world[i + 1] = p[1];
      world[i + 2] = p[2];
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
    }

    const at = (i: number): Vec3 => [world[i * 3], world[i * 3 + 1], world[i * 3 + 2]];
    const uvAt = (i: number): Vec2 => (uv ? [uv[i * 2], uv[i * 2 + 1]] : [0, 0]);
    const colAt = (i: number): null | Rgba =>
      col ? [col[i * 4], col[i * 4 + 1], col[i * 4 + 2], col[i * 4 + 3]] : null;

    for (const triangle of geometry.triangles) {
      const texture = geometry.materials[triangle.materialIndex]?.texture?.name?.toLowerCase() ?? null;
      if (texture && !textures.has(texture)) {
        missing.add(texture);
      }
      const colors = col ? [colAt(triangle.a), colAt(triangle.b), colAt(triangle.c)] : null;
      triangles.push({
        colors: colors as [Rgba, Rgba, Rgba] | null,
        positions: [at(triangle.a), at(triangle.b), at(triangle.c)],
        texture,
        uvs: [uvAt(triangle.a), uvAt(triangle.b), uvAt(triangle.c)],
      });
    }
  }

  if (missing.size > 0) {
    console.warn(`  ! ${model}: ${missing.size} texture(s) not in --txd → untextured: ${[...missing].join(', ')}`);
  }

  return { bbox: { max, min }, name: model, textures, triangles };
}

/** Open the game model archive (`gta3.img` + `gta_int.img` fallback) — used only to source the LOD template. */
export function openTemplateArchive(gamePath: string): ImgArchive {
  const gta3 = openArchive(readBytes(join(gamePath, 'models', 'gta3.img')));
  const intPath = join(gamePath, 'models', 'gta_int.img');
  if (!existsSync(intPath)) {
    return gta3;
  }
  const gtaInt = openArchive(readBytes(intPath));

  return {
    get: (name) => gta3.get(name) ?? gtaInt.get(name),
    names: [...new Set([...gta3.names, ...gtaInt.names])],
  };
}

function decodeTexture(rw: RWTexture): DecodedTexture {
  const base = rw.mipmaps[0];
  const rgba = rw.format === 'rgba8888' ? base.data : decodeDxt(rw.format, base.data, base.width, base.height);

  return { hasAlpha: rw.hasAlpha, height: base.height, rgba, width: base.width };
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
}
