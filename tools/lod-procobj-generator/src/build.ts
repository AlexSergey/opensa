import type { ImgArchive } from '@opensa/renderware/archive/img-archive';
import type { MergedMesh, Vec3 } from '@opensa/sa-lod/mesh';
import type { SourceTexture, TextureSource } from '@opensa/sa-lod/texture-source';

import { allocateLodIds, buildLodIde, lodAlias, patchGtaDat } from '@opensa/map-placement/ide';
import { convertProcObj, type ProcObjSpecies } from '@opensa/map-placement/procobj';
import { UNDERWATER_PROCOBJ } from '@opensa/map-placement/procobj-strip';
import { retxdSwappedModels, writeTxdpHdMod } from '@opensa/map-placement/retxd';
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
import {
  applyMeshTrunkPrelight,
  applyStockPrelight,
  type FoliagePredicate,
  type PrelightInfo,
  stockPrelightColor,
} from '@opensa/sa-lod/prelight';
import { createTextureSource } from '@opensa/sa-lod/texture-source';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ProcObjLodConfig } from './config';

import { buildModelMesh, meshBounds } from './mesh-builder';

const IDE_REL = 'data/maps/lod_procobj.ide';
const IDE_DAT = 'DATA\\MAPS\\LOD_PROCOBJ.IDE';
const IPL_NAME = 'lod_procobj';
/** The HD mod (`<out>/hd/`) `txdp` IDE — parents each swapped model's stock TXD to the custom TXD, so the stock
 *  IDEs stay untouched (the `./5` approach; see {@link emitHdMod}). */
const TXDP_IDE_REL = 'data/maps/lod_procobj_hd.ide';

export interface BuildOptions {
  config: ProcObjLodConfig;
  gamePath: string;
  /** Optional HD model folder (`<model>.dff` + `<model>.txd`); omitted → convert the game's own procobj models. */
  inPath?: string;
  /** `--modloader`: emit two Modloader mods under `<out>` — `lod/` (LOD `gta3img/` + static IPL + stripped
   *  `procobj.dat` + `loader.txt`) and `hd/` (the swapped HD models via a `txdp` IDE, no stock IDE rewritten) —
   *  instead of repacking one `<out>/models/gta3.img` + patching `data/gta.dat` with the HD swap inlined. */
  modloader: boolean;
  outPath: string;
  /** Copy each model's trunk prelight from its stock DFF onto the LOD (and the swapped HD when `--in`). */
  prelight: boolean;
  /** Per-model `--prelight` overrides (`--prelight <info.json>`); models in `skip` are left untouched. */
  prelightInfo?: PrelightInfo;
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

/** The changed IMG entries to emit: LOD DFFs + lod_procobj.txd/col + the swapped HD DFFs + custom TXDs. */
export function collectImgEntries(
  lods: readonly { alias: string; dff: Uint8Array }[],
  lodTxd: Uint8Array,
  lodCol: Uint8Array,
  swap: ReadonlyMap<string, Uint8Array>,
  retxdTxds: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  for (const lod of lods) {
    entries.set(`${lod.alias}.dff`, lod.dff);
  }
  entries.set(`${IPL_NAME}.txd`, lodTxd);
  entries.set(`${IPL_NAME}.col`, lodCol);
  for (const [name, bytes] of [...swap, ...retxdTxds]) {
    entries.set(name, bytes);
  }

  return entries;
}

/**
 * Convert the `--dff ∩ procobj` species into static IPL instances with **simplified-copy** LODs: per species,
 * build a model-local mesh (frame-aware) → QEM decimate → re-derive normals → encode a low-poly DFF; pack one
 * shared `lod_procobj.txd` (downscaled, `--txd ∪ stock`) + `lod_procobj.col`; register the LODs in
 * `lod_procobj.ide`; then reuse `convertProcObj` (scatter → static IPL + `procobj.dat` strip), swap the procobj
 * HD DFFs for `--dff`, and emit the drop-in under `--out`.
 */
export function run(options: BuildOptions): void {
  const { config, gamePath, inPath, modloader, outPath, prelight, prelightInfo } = options;
  const archive = openArchive(readBytes(join(gamePath, 'models', 'gta3.img')));
  const dat = parseGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'));
  const { idByModel, usedIds } = scanIdes(gamePath, dat.ide);
  const procModels = procObjModels(gamePath);

  // Candidate species: a procobj scatter species that has a stock object id. With `--in`, narrowed to the models
  // it ships; without it, **every** procobj species — converted straight from the game's own gta3.img. The
  // never-touch UNDERWATER set (seaweed/starfish/searock) is dropped here too — `convertProcObj` never places it,
  // so without this filter the no-`--in` run would bake dead LOD DFFs/ids/IDE rows for seabed scatter.
  const candidates = inPath === undefined ? [...procModels] : listDffModels(inPath).filter((m) => procModels.has(m));
  const species = candidates.filter((m) => idByModel.has(m) && !UNDERWATER_PROCOBJ.has(m));
  const modelSource = createModelSource([archive]);
  const textureSource = inPath === undefined ? createTextureSource([archive]) : combinedTextureSource(inPath, archive);

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

  // `--prelight`: recolour each LOD mesh's trunk to its stock model's ambient (foliage kept) so the simplified
  // copy isn't black/washed-out next to stock geometry — the procobj species are stock-present in gta3.img, so the
  // ambient comes from each model's own DFF. Alpha-cutout textures are foliage; opaque ones are trunk/bark.
  const foliageTextures = new Set(
    [...new Set(built.flatMap((b) => b.textures))].filter((t) => textureSource.get(t)?.hasAlpha),
  );
  const isFoliage: FoliagePredicate = (name) => foliageTextures.has(name);
  if (prelight) {
    prelightLodMeshes(built, archive, isFoliage, prelightInfo);
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
  // `--modloader` ships two mods under `<out>`: `lod/` (this build) + `hd/` (the swapped HD models). So the LOD
  // mod's files (IPL + procobj.dat from convertProcObj, the IDE, the IMG entries) go under `<out>/lod/`. Under
  // `--modloader` procobj.dat is emitted as disable rows (survives Modloader's additive `.dat` merge), not stripped.
  const lodOut = modloader ? join(outPath, 'lod') : outPath;
  const procObj = convertProcObj({
    archive,
    disableScatter: modloader,
    gamePath,
    heightThreshold: config.procObjHeight,
    iplName: IPL_NAME,
    outPath: lodOut,
    procObjMax: config.procObjMax,
    species: species_,
  });
  // The swapped (prelit) HD DFFs — with `--in`, regardless of mode (the HD carries our prelight; we don't drop it).
  const swapModels = lods.map((lod) => lod.model);
  const swap =
    inPath === undefined
      ? new Map<string, Uint8Array>()
      : swapEntries(inPath, swapModels, prelight ? archive : null, isFoliage, prelightInfo);

  writeText(join(lodOut, IDE_REL), ide);
  emitRegistration({ gamePath, modloader, outPath: lodOut, procObj });

  if (modloader) {
    // LOD mod: only the LOD assets to `<out>/lod/gta3img/`; the HD swap is a separate `<out>/hd/` mod that parents
    // the stock TXDs to the custom one via `txdp` — so no stock IDE is rewritten (the `./5` approach).
    emitImg(archive, collectImgEntries(lods, lodTxd, lodCol, new Map(), new Map()), lodOut, true);
    const swapped = emitHdMod(inPath, gamePath, dat, swap, swapModels, outPath);
    console.log(
      `procobj→lod: ${lods.length} species · ${procObj?.objects ?? 0} static objects → ${outPath}/lod` +
        (swapped > 0 ? ` · ${swapped} HD swapped (txdp) → ${outPath}/hd` : ''),
    );

    return;
  }

  // `--out`: repack everything (LOD assets + swapped HD + custom TXDs) into models/gta3.img + retxd the stock IDEs.
  const retxd =
    inPath === undefined
      ? { ides: new Map<string, string>(), txds: new Map<string, Uint8Array>() }
      : retxdSwappedModels(gamePath, dat.ide, inPath, inPath, swapModels);
  for (const [idePath, text] of retxd.ides) {
    writeText(join(outPath, idePath.replace(/\\/g, '/')), text);
  }
  emitImg(archive, collectImgEntries(lods, lodTxd, lodCol, swap, retxd.txds), outPath, false);
  console.log(
    `procobj→lod: ${lods.length} species · ${procObj?.objects ?? 0} static objects · ` +
      `${swap.size} HD swapped (${retxd.txds.size} custom TXD) → ${outPath}/models/gta3.img`,
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

/**
 * Emit the HD mod under `<out>/hd/` (`--modloader`): the swapped (prelit) procobj HD DFFs + the custom parent TXD,
 * plus a `txdp` IDE parenting each swapped model's **stock** TXD to the custom one — so the stock IDEs are never
 * rewritten (the `./5` approach). Returns the number of swapped DFFs; 0 (nothing written) without `--in` or when no
 * model matched a custom TXD.
 */
function emitHdMod(
  inPath: string | undefined,
  gamePath: string,
  dat: ReturnType<typeof parseGtaDat>,
  swap: ReadonlyMap<string, Uint8Array>,
  swapModels: readonly string[],
  outPath: string,
): number {
  if (inPath === undefined) {
    return 0;
  }

  return writeTxdpHdMod({
    gamePath,
    hdDir: join(outPath, 'hd'),
    idePaths: dat.ide,
    inPath,
    swap,
    swapModels,
    txdpIdeRel: TXDP_IDE_REL,
  });
}

/** Repack the changed entries into `<out>/models/gta3.img`, or write them loose to `<out>/gta3img/` (`--modloader`). */
function emitImg(archive: ImgArchive, entries: ReadonlyMap<string, Uint8Array>, outPath: string, loose: boolean): void {
  if (loose) {
    for (const [name, bytes] of entries) {
      writeBytes(join(outPath, 'gta3img', name), bytes);
    }

    return;
  }
  const img = editArchive(archive);
  for (const [name, bytes] of entries) {
    img.set(name, bytes);
  }
  writeBytes(join(outPath, 'models', 'gta3.img'), img.build());
}

/**
 * Register the LODs (+ the static IPL) for the game to load: a Modloader `loader.txt` of `IDE`/`IPL` lines
 * (`--modloader`, no `gta.dat` edit — Modloader merges them), or a patched `data/gta.dat` (default). Either way
 * the IPL + stripped `procobj.dat` already sit at their `data/` paths (written by `convertProcObj`).
 */
function emitRegistration(args: {
  gamePath: string;
  modloader: boolean;
  outPath: string;
  procObj: null | { datLine: string };
}): void {
  const { gamePath, modloader, outPath, procObj } = args;
  if (modloader) {
    const lines = [`IDE ${IDE_REL}`];
    if (procObj) {
      lines.push(`IPL data/maps/${IPL_NAME}.ipl`);
    }
    writeText(join(outPath, 'loader.txt'), `${lines.join('\n')}\n`);

    return;
  }
  let gtaDat = patchGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'), IDE_DAT);
  if (procObj) {
    const eol = gtaDat.includes('\r\n') ? '\r\n' : '\n';
    gtaDat = `${gtaDat.replace(/\s*$/, '')}${eol}${procObj.datLine}${eol}`;
  }
  writeText(join(outPath, 'data', 'gta.dat'), gtaDat);
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

/** `--prelight`: recolour each built LOD mesh's trunk to its stock model's ambient — foliage kept, skip-list honoured. */
function prelightLodMeshes(
  built: readonly BuiltMesh[],
  archive: ImgArchive,
  isFoliage: FoliagePredicate,
  prelightInfo: PrelightInfo | undefined,
): void {
  for (const b of built) {
    if (prelightInfo?.skip.has(b.model)) {
      continue;
    }
    const stock = archive.get(`${b.model}.dff`);
    const trunk = stock ? stockPrelightColor(new Uint8Array(stock)) : null;
    if (trunk) {
      applyMeshTrunkPrelight(b.mesh, trunk, isFoliage);
    }
  }
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

/**
 * Read the user HD DFF bytes for each swapped model, keyed by its `<model>.dff` IMG entry. When `archive` is given
 * (`--prelight`), each swapped DFF inherits its stock model's trunk prelight before being packed — except models
 * the `--prelight` info opts out (`prelightInfo.skip`), which are packed verbatim.
 */
function swapEntries(
  dffPath: string,
  models: readonly string[],
  archive: ImgArchive | null,
  isFoliage: FoliagePredicate,
  prelightInfo: PrelightInfo | undefined,
): Map<string, Uint8Array> {
  const isDir = statSync(dffPath).isDirectory();
  const files = isDir
    ? new Map(readdirSync(dffPath).map((f) => [base(f), join(dffPath, f)]))
    : new Map([[base(dffPath), dffPath]]);
  const swap = new Map<string, Uint8Array>();
  for (const model of models) {
    const file = files.get(model);
    if (!file) {
      continue;
    }
    let bytes = readBytes(file);
    if (archive && !prelightInfo?.skip.has(model)) {
      const stock = archive.get(`${model}.dff`);
      if (stock) {
        bytes = applyStockPrelight(bytes, new Uint8Array(stock), isFoliage);
      } else {
        console.warn(`  ! ${model}: no stock DFF in gta3.img → prelight not transferred`);
      }
    }
    swap.set(`${model}.dff`, bytes);
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
