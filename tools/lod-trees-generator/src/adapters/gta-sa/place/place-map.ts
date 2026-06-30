import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { allocateLodIds, buildLodIde, lodAlias, patchGtaDat } from '@opensa/map-placement/ide';
import { retxdSwappedModels, writeTxdpHdMod } from '@opensa/map-placement/retxd';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { applyStockPrelight, type PrelightInfo } from '@opensa/sa-lod/prelight';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { linkBinaryLods } from './ipl-binary-link';
import { type AppendInst, applyTextEdits, type Repoint } from './ipl-text-append';

/** One generated impostor: the `lod<source>` name (DFF file + texture) for source model `source`. */
export interface ImpostorRef {
  name: string;
  source: string;
}

export interface PlaceOptions {
  /** Impostor LOD draw distance written to `lodtrees.ide` (`--draw`). */
  drawDistance: number;
  /** Lowercased names of the alpha-cutout (foliage) textures — the trunk-only `--prelight` split. */
  foliageTextures: ReadonlySet<string>;
  gamePath: string;
  impostors: readonly ImpostorRef[];
  /** User HD model folder (`--in`, dff + txd) — its DFFs are swapped for the LOD'd, non-procobj models and its
   *  TXDs wired into their IDE `txd`. Omitted (no `--in`) → no swap/retxd; the stock HD models stay. */
  inPath?: string;
  /** `--modloader`: emit **two** Modloader mods under `<out>` — `lod/` (the mode-A far-LOD attachment: modified
   *  text IPLs as loose overrides + streams/assets in `gta3img/` + `lodtrees.ide` via `loader.txt`) and `hd/` (the
   *  swapped HD models, parented to the custom TXD via a `txdp` IDE so no stock IDE is rewritten). Default (false):
   *  one repacked `gta3.img` + patched gta.dat, with the `--in` HD swap inlined. */
  modloader: boolean;
  outPath: string;
  /** Copy each swapped model's prelight (day vertex colours) from its stock DFF (`--prelight`). */
  prelight: boolean;
  /** Per-model `--prelight` overrides; models in `skip` get the HD swap but no prelight transfer. */
  prelightInfo?: PrelightInfo;
}

type GtaDat = ReturnType<typeof parseGtaDat>;
/** A registered impostor: its DFF/texture `name`, the IMG/IDE `alias`, allocated object `id`, and `source` model. */
interface Impostor {
  alias: string;
  id: number;
  name: string;
  source: string;
}

const IDE_REL = 'data/maps/lodtrees.ide';
const IDE_DAT = 'DATA\\MAPS\\lodtrees.IDE';
/** `loader.txt` for the LOD mod (`<out>/lod/`): only the `IDE` line — the modified stock IPLs override their stock
 *  copies by name (no `IPL` line needed), and SA auto-discovers the `.col` embedded in `gta3.img` (no `COLFILE`). */
const LOADER_TXT = `IDE ${IDE_REL}\n`;
/** The HD mod (`<out>/hd/`) `txdp` IDE path — parents each swapped model's stock TXD to the custom TXD, so the
 *  stock IDEs stay untouched (see {@link emitHdMod} + the `./5` reference). */
const TXDP_IDE_REL = 'data/maps/lodtrees_hd.ide';

/** Per-area accumulator over the text IPL's shared instance-index space (binary streams + text rows alike). */
interface AreaEdit {
  appends: AppendInst[];
  baseCount: number;
  claimed: Map<number, number>;
  nextIdx: number;
  repoints: Map<number, Repoint>;
}

/** A placed HD instance (binary or text) — the transform the impostor LOD inherits. */
interface PlacedInst {
  interior: number;
  lod: number;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
}

/**
 * Stage 2 — attach the impostor LODs as the far-LOD of every placed tree HD: per area, append a leaf instance at
 * the HD's transform + link the HD's `lod` (binary stream field / text `lod` column), or repoint an existing LOD
 * row. The packaging then differs by output target:
 * - **Default (`--out`):** repack `gta3.img` (modified streams + assets) + patch `gta.dat`, with the `--in` HD swap.
 * - **`--modloader`:** the **same** attachment, packaged as **two** Modloader mods under `<out>` — `lod/` (the LOD
 *   attachment) + `hd/` (the swapped HD models, via `txdp` so no stock IDE is rewritten). See {@link placeModloader}.
 *
 * procobj species keep their stock HD + runtime scatter (procobj LODs are a separate tool — `lod-procobj-generator`).
 */
export function placeMap(options: PlaceOptions): void {
  const { gamePath, impostors, modloader, outPath } = options;
  const dat = parseGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'));
  const registry = buildRegistry(impostors, allObjectIds(gamePath, dat));
  const idToImpostor = sourceObjectIds(gamePath, dat, new Map(registry.map((r) => [r.source, r])));
  const procModels = procObjModels(gamePath);
  const archive = openArchive(readBytes(join(gamePath, 'models', 'gta3.img')));

  // Attach impostors as far-LODs (edit stock streams + companion text IPLs) — shared by both output targets.
  const result = editAreas(archive, gamePath, dat, idToImpostor);

  if (modloader) {
    placeModloader(options, { archive, dat, procModels, registry, result });

    return;
  }

  // `--out`: repack gta3.img + patch gta.dat, with the `--in` HD swap.
  const { retxd, swap } = computeSwap(options, result.placedSources, procModels, archive, dat);
  for (const [iplPath, text] of result.texts) {
    writeText(join(outPath, iplPath.replace(/\\/g, '/')), text);
  }
  for (const [idePath, text] of retxd.ides) {
    writeText(join(outPath, idePath.replace(/\\/g, '/')), text);
  }
  const ids = new Map(registry.map((r) => [r.alias, r.id]));
  writeText(join(outPath, IDE_REL), buildLodIde(ids, 'lodtrees', options.drawDistance));
  writeText(
    join(outPath, 'data', 'gta.dat'),
    patchGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'), IDE_DAT),
  );
  emitImg(archive, result.streams, registry, new Map([...swap, ...retxd.txds]), outPath, outPath, false);
  console.log(
    `place: ${result.attached} tree instances → impostor LODs ` +
      `(${result.appended} appended, ${result.repointed} repointed) · ${swap.size} HD DFFs swapped ` +
      `(${retxd.txds.size} custom TXD, ${retxd.ides.size} IDEs retxd'd) · ${registry.length} impostors ` +
      `· LOD draw ${options.drawDistance} → ${outPath}/gta3.img`,
  );
}

/** Every object id defined by the gta.dat IDEs — the occupied id space the impostors must avoid. */
function allObjectIds(gamePath: string, dat: GtaDat): Set<number> {
  const ids = new Set<number>();
  for (const idePath of dat.ide) {
    const file = datChildUrl(gamePath, idePath);
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      ids.add(def.id);
    }
  }

  return ids;
}

/** Area key shared by a text IPL and its binary streams: `countrye.ipl` & `countrye_stream3.ipl` → `countrye`. */
function areaKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;

  return base
    .replace(/_stream\d+\.ipl$/i, '')
    .replace(/\.ipl$/i, '')
    .toLowerCase();
}

/**
 * Attach an impostor LOD to one placed HD: repoint the HD's existing stock-LOD text row onto the impostor (when
 * free), else append a leaf impostor row at the HD's transform. Returns the appended row index the caller must
 * link the HD's `lod` to (binary stream field or text `lod` column), or `null` when repointed in place.
 */
function attachImpostor(
  edit: AreaEdit,
  imp: Impostor,
  inst: PlacedInst,
  out: { appended: number; repointed: number },
): null | number {
  if (inst.lod >= 0 && inst.lod < edit.baseCount && claim(edit.claimed, inst.lod, imp.id)) {
    edit.repoints.set(inst.lod, { id: imp.id, model: imp.alias });
    out.repointed += 1;

    return null;
  }
  edit.appends.push({ id: imp.id, interior: inst.interior, model: imp.alias, pos: inst.position, rot: inst.rotation });
  const idx = edit.nextIdx;
  edit.nextIdx += 1;
  out.appended += 1;

  return idx;
}

/** Impostor records: short IMG/IDE alias + a free object id each. */
function buildRegistry(impostors: readonly ImpostorRef[], usedIds: ReadonlySet<number>): Impostor[] {
  const aliases = impostors.map((imp, i) => lodAlias(imp.name, i));
  const ids = allocateLodIds(aliases, usedIds);

  return impostors.map((imp, i) => ({
    alias: aliases[i],
    id: ids.get(aliases[i]) ?? 0,
    name: imp.name.toLowerCase(),
    source: imp.source.toLowerCase(),
  }));
}

/** Claim a text-IPL row for repointing; false if already claimed by a different impostor (→ caller appends). */
function claim(claimed: Map<number, number>, index: number, id: number): boolean {
  const owner = claimed.get(index);
  if (owner === undefined) {
    claimed.set(index, id);

    return true;
  }

  return owner === id;
}

/** HD swap + retxd for the LOD'd, non-procobj placed models — `--out` (`--in`) only. With no `--in` there's
 *  nothing to swap (the stock HD stays). procobj species keep their stock mesh. */
function computeSwap(
  options: PlaceOptions,
  placedSources: ReadonlySet<string>,
  procModels: ReadonlySet<string>,
  archive: ImgArchive,
  dat: GtaDat,
): { retxd: { ides: Map<string, string>; txds: Map<string, Uint8Array> }; swap: Map<string, Uint8Array> } {
  const { foliageTextures, gamePath, inPath, prelight, prelightInfo } = options;
  const swapModels = [...placedSources].filter((m) => !procModels.has(m));
  const swap =
    inPath === undefined
      ? new Map<string, Uint8Array>()
      : swapEntries(inPath, swapModels, prelight ? archive : null, foliageTextures, prelightInfo);
  const retxd =
    inPath === undefined
      ? { ides: new Map<string, string>(), txds: new Map<string, Uint8Array>() }
      : retxdSwappedModels(gamePath, dat.ide, inPath, inPath, swapModels);

  return { retxd, swap };
}

/**
 * Per-area: attach an impostor LOD to every placed tree HD — binary-stream HDs (link the binary `lod` field) and
 * text-IPL HDs (set the text row's `lod` column) alike — appending leaf LOD rows / repointing existing ones into
 * the area's companion text IPL. Areas iterated = every text IPL ∪ every binary-stream area (so text-only
 * placements are no longer skipped); binary streams without a companion text IPL can't host LODs and are skipped.
 */
function editAreas(
  archive: ImgArchive,
  gamePath: string,
  dat: GtaDat,
  idToImpostor: ReadonlyMap<number, Impostor>,
): {
  appended: number;
  attached: number;
  placedSources: Set<string>;
  repointed: number;
  streams: Map<string, Uint8Array>;
  texts: Map<string, string>;
} {
  const streamsByArea = groupStreams(archive);
  const textByArea = textIplByArea(gamePath, dat);
  const out = { appended: 0, attached: 0, placedSources: new Set<string>(), repointed: 0 };
  const streams = new Map<string, Uint8Array>();
  const texts = new Map<string, string>();

  for (const area of new Set([...textByArea.keys(), ...streamsByArea.keys()])) {
    const textRef = textByArea.get(area);
    if (!textRef) {
      continue; // binary streams without a companion text IPL can't host LOD instances — skip
    }
    const textRaw = readFileSync(datChildUrl(gamePath, textRef), 'utf8');
    const baseCount = parseIpl(textRaw).length;
    const edit: AreaEdit = { appends: [], baseCount, claimed: new Map(), nextIdx: baseCount, repoints: new Map() };

    // Binary-stream HDs: link the stream instance's `lod` to its appended/repointed impostor row.
    for (const name of streamsByArea.get(area) ?? []) {
      const bytes = new Uint8Array(archive.get(name) ?? new ArrayBuffer(0));
      const links = new Map<number, number>();
      parseBinaryIpl(toArrayBuffer(bytes)).forEach((inst, i) => {
        const imp = idToImpostor.get(inst.id);
        if (!imp) {
          return;
        }
        out.attached += 1;
        out.placedSources.add(imp.source);
        const idx = attachImpostor(edit, imp, inst, out);
        if (idx !== null) {
          links.set(i, idx);
        }
      });
      if (links.size > 0) {
        streams.set(name, linkBinaryLods(bytes, links));
      }
    }

    // Text-IPL HDs (always-loaded placements): set the row's `lod` column to its appended impostor.
    const setLods = new Map<number, number>();
    parseIpl(textRaw).forEach((inst, row) => {
      const imp = idToImpostor.get(inst.id);
      if (!imp) {
        return;
      }
      out.attached += 1;
      out.placedSources.add(imp.source);
      const idx = attachImpostor(edit, imp, inst, out);
      if (idx !== null) {
        setLods.set(row, idx);
      }
    });

    if (edit.appends.length === 0 && edit.repoints.size === 0 && setLods.size === 0) {
      continue; // no tree placements in this area — leave the stock text IPL untouched (don't ship a no-op copy)
    }
    texts.set(textRef, applyTextEdits(textRaw, { appends: edit.appends, repoints: edit.repoints, setLods }).text);
  }

  return { ...out, streams, texts };
}

/**
 * Emit the HD mod under `<out>/hd/`: the swapped (prelit) HD DFFs + the custom parent TXD, plus a `txdp` IDE that
 * parents each swapped model's **stock** TXD to the custom one (so the stock IDEs are never rewritten — the `./5`
 * approach). Returns the number of swapped DFFs; 0 (nothing written) when there's no `--in` or no model matched a
 * custom TXD. procobj species are excluded (their HD stays stock — handled by `lod-procobj-generator`).
 */
function emitHdMod(
  options: PlaceOptions,
  placedSources: ReadonlySet<string>,
  procModels: ReadonlySet<string>,
  archive: ImgArchive,
  dat: GtaDat,
): number {
  const { foliageTextures, gamePath, inPath, outPath, prelight, prelightInfo } = options;
  if (inPath === undefined) {
    return 0;
  }
  const swapModels = [...placedSources].filter((m) => !procModels.has(m));
  const swap = swapEntries(inPath, swapModels, prelight ? archive : null, foliageTextures, prelightInfo);

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

/** Repack the IMG, or write only changed entries loose to `<destDir>/gta3img/`. The baked impostor DFFs +
 *  `lodtrees.txd`/`.col` are read from `srcPath` (the top-level `--out`, where stage 1 wrote them); the IMG /
 *  `gta3img/` is written under `destDir` (which differs from `srcPath` for the `--modloader` `lod/` subfolder). */
function emitImg(
  archive: ImgArchive,
  streams: ReadonlyMap<string, Uint8Array>,
  registry: readonly Impostor[],
  swap: ReadonlyMap<string, Uint8Array>,
  srcPath: string,
  destDir: string,
  loose: boolean,
): void {
  const entries = new Map<string, Uint8Array>(streams);
  for (const r of registry) {
    entries.set(`${r.alias}.dff`, readBytes(join(srcPath, `${r.name}.dff`)));
  }
  entries.set('lodtrees.txd', readBytes(join(srcPath, 'lodtrees.txd')));
  entries.set('lodtrees.col', readBytes(join(srcPath, 'lodtrees.col'))); // SA auto-discovers .col in the IMG
  for (const [name, bytes] of swap) {
    entries.set(name, bytes);
  }

  if (loose) {
    for (const [name, bytes] of entries) {
      writeBytes(join(destDir, 'gta3img', name), bytes);
    }

    return;
  }
  const img = editArchive(archive);
  for (const [name, bytes] of entries) {
    img.set(name, bytes);
  }
  writeBytes(join(destDir, 'gta3.img'), img.build());
}

function groupStreams(archive: ImgArchive): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const name of archive.names) {
    if (!name.toLowerCase().endsWith('.ipl')) {
      continue;
    }
    const area = areaKey(name);
    (groups.get(area) ?? groups.set(area, []).get(area)!).push(name);
  }

  return groups;
}

/**
 * `--modloader` — emit **two** self-contained Modloader mods under `<out>`:
 * - **`lod/`** — the mode-A far-LOD attachment ({@link editAreas}), mirroring the MixMods "LOD Vegetation" layout:
 *   modified text IPLs as loose stock overrides, modified binary streams + impostor DFFs + `lodtrees.txd`/`.col`
 *   into `gta3img/` (injected by name; col auto-discovered), `lodtrees.ide` via a one-line `loader.txt`. No
 *   `gta.dat` patch, no stock IDE rewritten; the `lod`-link means no near-field double-draw.
 * - **`hd/`** — the swapped (prelit) `--in` HD models ({@link emitHdMod}), parented to the custom TXD via a `txdp`
 *   IDE so **no stock IDE is rewritten** (the `./5` approach). Empty/absent when there's no `--in`.
 *
 * Two independent mods so the HD swap (which carries our prelight) isn't lost, yet neither overrides a stock IDE.
 */
function placeModloader(
  options: PlaceOptions,
  ctx: {
    archive: ImgArchive;
    dat: GtaDat;
    procModels: ReadonlySet<string>;
    registry: readonly Impostor[];
    result: ReturnType<typeof editAreas>;
  },
): void {
  const { archive, dat, procModels, registry, result } = ctx;
  const { drawDistance, outPath } = options;
  const lodOut = join(outPath, 'lod');

  // lod/ — the LOD attachment mod.
  for (const [iplPath, text] of result.texts) {
    writeText(join(lodOut, iplPath.replace(/\\/g, '/')), text); // stock text IPL — overrides by name
  }
  const ids = new Map(registry.map((r) => [r.alias, r.id]));
  writeText(join(lodOut, IDE_REL), buildLodIde(ids, 'lodtrees', drawDistance));
  writeText(join(lodOut, 'loader.txt'), LOADER_TXT);
  emitImg(archive, result.streams, registry, new Map(), outPath, lodOut, true);

  // hd/ — the swapped HD models (only with `--in`).
  const swapped = emitHdMod(options, result.placedSources, procModels, archive, dat);

  console.log(
    `place (modloader): ${result.attached} tree instances → impostor LODs ` +
      `(${result.appended} appended, ${result.repointed} repointed) · ${registry.length} impostors → ${outPath}/lod` +
      (swapped > 0 ? ` · ${swapped} HD DFFs swapped (txdp) → ${outPath}/hd` : ''),
  );
}

/** procobj scatter species — their HD DFFs are left stock (not swapped). */
function procObjModels(gamePath: string): Set<string> {
  const models = new Set<string>();
  for (const line of readFileSync(join(gamePath, 'data', 'procobj.dat'), 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) {
      models.add(trimmed.split(/\s+/)[1]?.toLowerCase());
    }
  }

  return models;
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Object ids whose model is one of the source trees → its impostor record. */
function sourceObjectIds(
  gamePath: string,
  dat: GtaDat,
  bySource: ReadonlyMap<string, Impostor>,
): Map<number, Impostor> {
  const ids = new Map<number, Impostor>();
  for (const idePath of dat.ide) {
    const file = datChildUrl(gamePath, idePath);
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      const imp = bySource.get(def.modelName.toLowerCase());
      if (imp) {
        ids.set(def.id, imp);
      }
    }
  }

  return ids;
}

/**
 * Read the user HD DFF bytes for each model to swap, keyed by its `<model>.dff` IMG entry. When `archive` is
 * given (`--prelight`), each swapped DFF inherits its stock model's prelight before being packed — except models
 * the `--prelight` info opts out (`prelightInfo.skip`), which are packed verbatim.
 */
function swapEntries(
  dffPath: string,
  models: readonly string[],
  archive: ImgArchive | null,
  foliageTextures: ReadonlySet<string>,
  prelightInfo: PrelightInfo | undefined,
): Map<string, Uint8Array> {
  const isDir = statSync(dffPath).isDirectory();
  const files = isDir
    ? new Map(readdirSync(dffPath).map((f) => [f.replace(/\.dff$/i, '').toLowerCase(), join(dffPath, f)]))
    : new Map([
        [
          dffPath
            .split(/[\\/]/)
            .pop()!
            .replace(/\.dff$/i, '')
            .toLowerCase(),
          dffPath,
        ],
      ]);
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
        bytes = applyStockPrelight(bytes, new Uint8Array(stock), (name) => foliageTextures.has(name));
      } else {
        console.warn(`  ! ${model}: no stock DFF in gta3.img → prelight not transferred`);
      }
    }
    swap.set(`${model}.dff`, bytes);
  }

  return swap;
}

/** Map each area key → the gta.dat text IPL path that exists on disk. */
function textIplByArea(gamePath: string, dat: GtaDat): Map<string, string> {
  const byArea = new Map<string, string>();
  for (const iplPath of dat.ipl) {
    if (iplPath.toLowerCase().endsWith('.zon')) {
      continue;
    }
    if (existsSync(datChildUrl(gamePath, iplPath))) {
      byArea.set(areaKey(iplPath), iplPath);
    }
  }

  return byArea;
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
