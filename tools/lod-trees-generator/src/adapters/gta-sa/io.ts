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

/** Parse one HD tree into a triangle soup + bbox (native Z-up), sharing the combined `textures` map. Warns about
 *  any referenced texture name that the `--txd` source doesn't provide (those faces render untextured). */
export function loadTree(dffPath: string, model: string, textures: Textures): HdTree {
  const dff = parseDff(toArrayBuffer(readBytes(dffPath)));
  const triangles: HdTriangle[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const missing = new Set<string>();

  for (const geometry of dff.geometries) {
    const pos = geometry.positions;
    const uv: Float32Array | undefined = geometry.uvLayers[0];
    const col = geometry.prelitColors;
    const at = (i: number): Vec3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const uvAt = (i: number): Vec2 => (uv ? [uv[i * 2], uv[i * 2 + 1]] : [0, 0]);
    const colAt = (i: number): null | Rgba =>
      col ? [col[i * 4], col[i * 4 + 1], col[i * 4 + 2], col[i * 4 + 3]] : null;

    for (let i = 0; i < pos.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], pos[i + axis]);
        max[axis] = Math.max(max[axis], pos[i + axis]);
      }
    }
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
