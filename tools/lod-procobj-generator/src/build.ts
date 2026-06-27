import type { ImgArchive } from '@opensa/renderware/archive/img-archive';
import type { MergedMesh, Vec3 } from '@opensa/sa-lod/mesh';
import type { SourceTexture, TextureSource } from '@opensa/sa-lod/texture-source';

import { allocateLodIds, buildLodIde, lodAlias, patchGtaDat } from '@opensa/map-placement/ide';
import { convertProcObj, type ProcObjSpecies } from '@opensa/map-placement/procobj';
import { retxdSwappedModels } from '@opensa/map-placement/retxd';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { decodeDxt } from '@opensa/rw-codec/dxt';
import { decimateMesh } from '@opensa/sa-lod/decimate';
import { encodeColLibrary } from '@opensa/sa-lod/encode-col';
import { encodeLodDff } from '@opensa/sa-lod/encode-dff';
import { encodeLodTxd } from '@opensa/sa-lod/encode-txd';
import { createModelSource } from '@opensa/sa-lod/model-source';
import { rebuildMeshNormals } from '@opensa/sa-lod/normals';
import { createTextureSource } from '@opensa/sa-lod/texture-source';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ProcObjLodConfig } from './config';

import { buildModelMesh, meshBounds } from './mesh-builder';

const IDE_REL = 'data/maps/lod_procobj.ide';
const IDE_DAT = 'DATA\\MAPS\\LOD_PROCOBJ.IDE';
const IPL_NAME = 'lod_procobj';

export interface BuildOptions {
  config: ProcObjLodConfig;
  dffPath: string;
  gamePath: string;
  outPath: string;
  txdPath: string;
}

/** A registered LOD (pass 2): a {@link BuiltMesh} with its allocated alias/id and encoded DFF. */
interface BuiltLod {
  alias: string;
  bbox: { max: Vec3; min: Vec3 };
  dff: Uint8Array;
  height: number;
  id: number;
  model: string;
  textures: string[];
}

/** A built LOD mesh (pass 1): the source procobj model, its decimated mesh, bounds, height + textures it uses. */
interface BuiltMesh {
  bbox: { max: Vec3; min: Vec3 };
  height: number;
  mesh: MergedMesh;
  model: string;
  textures: string[];
}

/**
 * Convert the `--dff ∩ procobj` species into static IPL instances with **simplified-copy** LODs: per species,
 * build a model-local mesh (frame-aware) → QEM decimate → re-derive normals → encode a low-poly DFF; pack one
 * shared `lod_procobj.txd` (downscaled, `--txd ∪ stock`) + `lod_procobj.col`; register the LODs in
 * `lod_procobj.ide`; then reuse `convertProcObj` (scatter → static IPL + `procobj.dat` strip), swap the procobj
 * HD DFFs for `--dff`, and emit the drop-in under `--out`.
 */
export function run(options: BuildOptions): void {
  const { config, dffPath, gamePath, outPath, txdPath } = options;
  const archive = openArchive(readBytes(join(gamePath, 'models', 'gta3.img')));
  const dat = parseGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'));
  const { idByModel, usedIds } = scanIdes(gamePath, dat.ide);
  const procModels = procObjModels(gamePath);

  // Candidate species: a `--dff` model that scatters in procobj and has a stock object id.
  const species = listDffModels(dffPath).filter((m) => procModels.has(m) && idByModel.has(m));
  const modelSource = createModelSource([archive]);
  const textureSource = combinedTextureSource(txdPath, archive);

  // Per species: build the simplified-copy mesh + bounds (height gate); ids/DFFs are assigned in a second pass.
  const built: BuiltMesh[] = [];
  for (const model of species) {
    const clump = modelSource.load(model);
    if (!clump) {
      continue;
    }
    const raw = buildModelMesh(clump);
    const bbox = meshBounds(raw);
    const height = bbox.max[2] - bbox.min[2];
    if (config.procObjHeight > 0 && height < config.procObjHeight) {
      continue; // short clutter (grass) — leave on the runtime scatter
    }
    const mesh = rebuildMeshNormals(decimateMesh(raw, config.tris));
    const textures = [...new Set(mesh.groups.map((group) => group.texture).filter((t) => t.length > 0))];
    built.push({ bbox, height, mesh, model, textures });
  }
  if (built.length === 0) {
    console.log('lod-procobj-generator: no `--dff ∩ procobj` species to convert');

    return;
  }

  // Register: allocate ids ≤ 18630 + a short alias each, then encode the LOD DFFs under their alias name.
  const aliases = built.map((b, i) => lodAlias(`lod${b.model}`, i, 'lpo'));
  const ids = allocateLodIds(aliases, usedIds);
  const lods: BuiltLod[] = built.map((b, i) => ({
    alias: aliases[i],
    bbox: b.bbox,
    dff: encodeLodDff(b.mesh, aliases[i]),
    height: b.height,
    id: ids.get(aliases[i])!,
    model: b.model,
    textures: b.textures,
  }));

  // Shared LOD assets: one `lod_procobj.txd` (every texture, downscaled) + `lod_procobj.col` (empty-collision).
  const allTextures = [...new Set(lods.flatMap((lod) => lod.textures))];
  const lodTxd = encodeLodTxd(allTextures, textureSource, config.textureSize);
  const lodCol = encodeColLibrary(
    lods.map((lod) => lod.bbox),
    lods.map((lod) => lod.alias),
  );
  const ide = buildLodIde(new Map(lods.map((lod) => [lod.alias, lod.id])), IPL_NAME, config.drawDistance);

  // Scatter → static IPL (HD inst → its LOD) + strip `procobj.dat`; swap the procobj HD DFFs + retxd their TXD.
  const species_ = new Map<string, ProcObjSpecies>(
    lods.map((lod) => [
      lod.model,
      { hdId: idByModel.get(lod.model)!, height: lod.height, lodId: lod.id, lodModel: lod.alias },
    ]),
  );
  const procObj = convertProcObj({
    archive,
    gamePath,
    heightThreshold: config.procObjHeight,
    iplName: IPL_NAME,
    outPath,
    procObjMax: config.procObjMax,
    species: species_,
  });
  const swapModels = lods.map((lod) => lod.model);
  const swap = swapEntries(dffPath, swapModels);
  const retxd = retxdSwappedModels(gamePath, dat.ide, dffPath, txdPath, swapModels);

  // Emit: IDEs + patched gta.dat.
  writeText(join(outPath, IDE_REL), ide);
  for (const [idePath, text] of retxd.ides) {
    writeText(join(outPath, idePath.replace(/\\/g, '/')), text);
  }
  let gtaDat = patchGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'), IDE_DAT);
  if (procObj) {
    const eol = gtaDat.includes('\r\n') ? '\r\n' : '\n';
    gtaDat = `${gtaDat.replace(/\s*$/, '')}${eol}${procObj.datLine}${eol}`;
  }
  writeText(join(outPath, 'data', 'gta.dat'), gtaDat);

  // Emit: gta3.img with the LOD DFFs + lod_procobj.txd/col + swapped HD DFFs + custom TXDs.
  const img = editArchive(archive);
  for (const lod of lods) {
    img.set(`${lod.alias}.dff`, lod.dff);
  }
  img.set(`${IPL_NAME}.txd`, lodTxd);
  img.set(`${IPL_NAME}.col`, lodCol);
  for (const [name, bytes] of [...swap, ...retxd.txds]) {
    img.set(name, bytes);
  }
  writeBytes(join(outPath, 'models', 'gta3.img'), img.build());

  console.log(
    `procobj→lod: ${lods.length} species · ${procObj?.objects ?? 0} static objects · ` +
      `${swap.size} HD swapped (${retxd.txds.size} custom TXD) → ${outPath}`,
  );
}

function base(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.(?:dff|txd)$/i, '').toLowerCase();
}

/** Combined texture resolver: the user's `--txd` first, then the stock game TXDs (downscaled by the encoder). */
function combinedTextureSource(txdPath: string, archive: ImgArchive): TextureSource {
  const custom = loadCustomTextures(txdPath);
  const stock = createTextureSource([archive]);

  return { get: (name) => custom.get(name.toLowerCase()) ?? stock.get(name) };
}

/** Model names under `--dff` (a `.dff` file or a directory), lowercased without extension. */
function listDffModels(dffPath: string): string[] {
  if (!statSync(dffPath).isDirectory()) {
    return [base(dffPath)];
  }

  return readdirSync(dffPath)
    .filter((f) => f.toLowerCase().endsWith('.dff'))
    .map(base);
}

/** Decode every texture in the `--txd` (a `.txd` file or a directory of them) to RGBA, keyed by lowercased name. */
function loadCustomTextures(txdPath: string): Map<string, SourceTexture> {
  const files = statSync(txdPath).isDirectory()
    ? readdirSync(txdPath)
        .filter((f) => f.toLowerCase().endsWith('.txd'))
        .map((f) => join(txdPath, f))
    : [txdPath];
  const out = new Map<string, SourceTexture>();
  for (const file of files) {
    for (const tex of parseTxd(toArrayBuffer(readBytes(file))).textures) {
      const key = tex.name.toLowerCase();
      const base = tex.mipmaps[0];
      if (out.has(key) || !base) {
        continue;
      }
      const rgba = tex.format === 'rgba8888' ? base.data : decodeDxt(tex.format, base.data, base.width, base.height);
      out.set(key, { hasAlpha: tex.hasAlpha, height: base.height, rgba, width: base.width });
    }
  }

  return out;
}

/** procobj scatter species (column 2 of each `procobj.dat` data row), lowercased. */
function procObjModels(gamePath: string): Set<string> {
  const models = new Set<string>();
  for (const line of readFileSync(join(gamePath, 'data', 'procobj.dat'), 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) {
      const model = trimmed.split(/\s+/)[1]?.toLowerCase();
      if (model) {
        models.add(model);
      }
    }
  }

  return models;
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** model name → object id, and the full set of occupied ids, from every IDE the gta.dat lists. */
function scanIdes(
  gamePath: string,
  idePaths: readonly string[],
): { idByModel: Map<string, number>; usedIds: Set<number> } {
  const idByModel = new Map<string, number>();
  const usedIds = new Set<number>();
  for (const idePath of idePaths) {
    const file = datChildUrl(gamePath, idePath);
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      usedIds.add(def.id);
      idByModel.set(def.modelName.toLowerCase(), def.id);
    }
  }

  return { idByModel, usedIds };
}

/** Read the user HD DFF bytes for each swapped model, keyed by its `<model>.dff` IMG entry. */
function swapEntries(dffPath: string, models: readonly string[]): Map<string, Uint8Array> {
  const isDir = statSync(dffPath).isDirectory();
  const files = isDir
    ? new Map(readdirSync(dffPath).map((f) => [base(f), join(dffPath, f)]))
    : new Map([[base(dffPath), dffPath]]);
  const swap = new Map<string, Uint8Array>();
  for (const model of models) {
    const file = files.get(model);
    if (file) {
      swap.set(`${model}.dff`, readBytes(file));
    }
  }

  return swap;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function writeBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
