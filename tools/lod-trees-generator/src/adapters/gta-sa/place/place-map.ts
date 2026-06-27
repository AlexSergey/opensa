import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { convertProcObj, type ProcObjSpecies } from '../procobj/convert';
import { allocateImpostorIds, buildLodTreesIde, impostorAlias, patchGtaDat } from './ide';
import { linkBinaryLods } from './ipl-binary-link';
import { type AppendInst, applyTextEdits, type Repoint } from './ipl-text-append';
import { applyStockPrelight } from './prelight';
import { retxdSwappedModels } from './retxd';

/** One generated impostor: the `lod<source>` name (DFF file + texture) for source model `source`, and its
 *  bbox height (the procobj tree-vs-grass gate). */
export interface ImpostorRef {
  height: number;
  name: string;
  source: string;
}

export interface PlaceOptions {
  /** User HD trees (`--dff`) dir/file — HD DFFs swapped for the LOD'd models (procobj only with `--procobj`). */
  dffPath: string;
  /** Impostor LOD draw distance written to `lodtrees.ide` (`--draw`). */
  drawDistance: number;
  gamePath: string;
  impostors: readonly ImpostorRef[];
  /** Write modified IMG entries loose to `<out>/gta3img/` instead of repacking `gta3.img`. */
  loose: boolean;
  outPath: string;
  /** Copy each swapped model's prelight (day vertex colours) from its stock DFF (`--prelight`). */
  prelight: boolean;
  /** Touch `--dff ∩ procobj` species (`--procobj`): convert their scatter to static LODs **and** swap their HD.
   *  Off ⇒ procobj species are left fully stock (no static conversion, no HD swap) even if in `--dff`. */
  procobj: boolean;
  /** Min impostor height (m) to convert a `--dff ∩ procobj` species to static (excludes grass). */
  procObjHeight: number;
  /** Cap on statically converted procobj objects (0 = skip procobj conversion). */
  procObjMax: number;
  /** User HD textures (`--txd`) — packed + wired into the swapped models' IDE `txd` column. */
  txdPath: string;
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

/**
 * Stage 2 — attach an impostor LOD to every streamed tree HD. For each binary-stream instance of a source model
 * we ensure a text-IPL LOD = its impostor: append a leaf instance at the HD's transform (and point the HD's `lod`
 * at it), or repoint an existing LOD row. Then register the impostors (`lodtrees.ide` + `gta.dat`) and pack the
 * impostor DFFs + `lodtrees.txd` + the swapped HD DFFs (procobj species only with `--procobj`) into `--out`.
 */
export function placeMap(options: PlaceOptions): void {
  const {
    dffPath,
    drawDistance,
    gamePath,
    impostors,
    loose,
    outPath,
    prelight,
    procobj,
    procObjHeight,
    procObjMax,
    txdPath,
  } = options;
  const dat = parseGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'));
  const registry = buildRegistry(impostors, allObjectIds(gamePath, dat));
  const bySource = new Map(registry.map((r) => [r.source, r]));
  const heightOf = new Map(impostors.map((i) => [i.source.toLowerCase(), i.height]));
  const idToImpostor = sourceObjectIds(gamePath, dat, bySource);
  const procModels = procObjModels(gamePath);

  const archive = openArchive(readBytes(join(gamePath, 'models', 'gta3.img')));
  const result = editAreas(archive, gamePath, dat, idToImpostor);

  // Swapped HD models + their custom TXD: pack the TXD + retarget the models' IDE `txd`. procobj species are
  // swapped only with `--procobj` (else kept stock so their runtime scatter stays unchanged).
  const swapModels = procobj ? [...result.placedSources] : [...result.placedSources].filter((m) => !procModels.has(m));
  const swap = swapEntries(dffPath, swapModels, prelight ? archive : null);
  const retxd = retxdSwappedModels(gamePath, dat.ide, dffPath, txdPath, swapModels);

  // Emit: text IPLs, retxd'd IDEs, lodtrees.ide, patched gta.dat.
  for (const [iplPath, text] of result.texts) {
    writeText(join(outPath, iplPath.replace(/\\/g, '/')), text);
  }
  for (const [idePath, text] of retxd.ides) {
    writeText(join(outPath, idePath.replace(/\\/g, '/')), text);
  }
  const ids = new Map(registry.map((r) => [r.alias, r.id]));
  writeText(join(outPath, IDE_REL), buildLodTreesIde(ids, drawDistance));

  // procobj → static IPL: convert the tall `--dff ∩ procobj` species (writes lodtrees_procobj.ipl + procobj.dat).
  // Only with `--procobj` — otherwise procobj is left untouched even when a species is in `--dff`.
  const procObj =
    procobj && procObjMax > 0
      ? convertProcObj({
          archive,
          gamePath,
          heightThreshold: procObjHeight,
          outPath,
          procObjMax,
          species: procObjSpecies(idToImpostor, heightOf),
        })
      : null;

  let gtaDat = patchGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'), IDE_DAT);
  if (procObj) {
    const eol = gtaDat.includes('\r\n') ? '\r\n' : '\n';
    gtaDat = `${gtaDat.replace(/\s*$/, '')}${eol}${procObj.datLine}${eol}`;
  }
  writeText(join(outPath, 'data', 'gta.dat'), gtaDat);

  // Emit: gta3.img (edited streams + impostor DFFs + lodtrees.txd + swapped HD DFFs + custom TXDs).
  const extras = new Map([...swap, ...retxd.txds]);
  emitImg(archive, result.streams, registry, extras, outPath, loose);

  console.log(
    `place: ${result.attached} tree instances → impostor LODs ` +
      `(${result.appended} appended, ${result.repointed} repointed) · ${swap.size} HD DFFs swapped ` +
      `(${retxd.txds.size} custom TXD, ${retxd.ides.size} IDEs retxd'd) · ${registry.length} impostors ` +
      `${procObj ? `· procobj→static ${procObj.objects} ` : ''}` +
      `· LOD draw ${drawDistance} → ${loose ? `${outPath}/gta3img/` : `${outPath}/gta3.img`}`,
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

/** Impostor records: short IMG/IDE alias + a free object id each. */
function buildRegistry(impostors: readonly ImpostorRef[], usedIds: ReadonlySet<number>): Impostor[] {
  const aliases = impostors.map((imp, i) => impostorAlias(imp.name, i));
  const ids = allocateImpostorIds(aliases, usedIds);

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

/** Per-area: append/repoint impostor LODs in the text IPL + link the binary `lod` fields. */
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

  for (const [area, streamNames] of streamsByArea) {
    const textRef = textByArea.get(area);
    if (!textRef) {
      continue; // streams without a companion text IPL can't host LOD instances — skip
    }
    const textRaw = readFileSync(datChildUrl(gamePath, textRef), 'utf8');
    const appends: AppendInst[] = [];
    const repoints = new Map<number, Repoint>();
    const claimed = new Map<number, number>();
    let nextIdx = parseIpl(textRaw).length;

    for (const name of streamNames) {
      const bytes = new Uint8Array(archive.get(name) ?? new ArrayBuffer(0));
      const links = new Map<number, number>();
      parseBinaryIpl(toArrayBuffer(bytes)).forEach((inst, i) => {
        const imp = idToImpostor.get(inst.id);
        if (!imp) {
          return;
        }
        out.attached += 1;
        out.placedSources.add(imp.source);
        if (inst.lod >= 0 && inst.lod < nextIdx && claim(claimed, inst.lod, imp.id)) {
          // The HD already has a stock LOD slot — repoint that text instance onto the impostor (no append).
          repoints.set(inst.lod, { id: imp.id, model: imp.alias });
          out.repointed += 1;
        } else {
          // Append the impostor as a leaf instance at the HD's transform and point the HD's binary `lod` at it.
          appends.push({
            id: imp.id,
            interior: inst.interior,
            model: imp.alias,
            pos: inst.position,
            rot: inst.rotation,
          });
          links.set(i, nextIdx);
          nextIdx += 1;
          out.appended += 1;
        }
      });
      if (links.size > 0) {
        streams.set(name, linkBinaryLods(bytes, links));
      }
    }
    texts.set(textRef, applyTextEdits(textRaw, { appends, repoints }).text);
  }

  return { ...out, streams, texts };
}

/** Repack the IMG, or write only changed entries loose to `<out>/gta3img/`. */
function emitImg(
  archive: ImgArchive,
  streams: ReadonlyMap<string, Uint8Array>,
  registry: readonly Impostor[],
  swap: ReadonlyMap<string, Uint8Array>,
  outPath: string,
  loose: boolean,
): void {
  const entries = new Map<string, Uint8Array>(streams);
  for (const r of registry) {
    entries.set(`${r.alias}.dff`, readBytes(join(outPath, `${r.name}.dff`)));
  }
  entries.set('lodtrees.txd', readBytes(join(outPath, 'lodtrees.txd')));
  entries.set('lodtrees.col', readBytes(join(outPath, 'lodtrees.col'))); // SA auto-discovers .col in the IMG
  for (const [name, bytes] of swap) {
    entries.set(name, bytes);
  }

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
  writeBytes(join(outPath, 'gta3.img'), img.build());
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

/** Map each source model that has an impostor → its procobj registration (stock HD id + impostor + height). */
function procObjSpecies(
  idToImpostor: ReadonlyMap<number, Impostor>,
  heightOf: ReadonlyMap<string, number>,
): Map<string, ProcObjSpecies> {
  const species = new Map<string, ProcObjSpecies>();
  for (const [hdId, imp] of idToImpostor) {
    species.set(imp.source, {
      hdId,
      height: heightOf.get(imp.source) ?? 0,
      impostorAlias: imp.alias,
      impostorId: imp.id,
    });
  }

  return species;
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
 * given (`--prelight`), each swapped DFF inherits its stock model's prelight before being packed.
 */
function swapEntries(dffPath: string, models: readonly string[], archive: ImgArchive | null): Map<string, Uint8Array> {
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
    if (archive) {
      const stock = archive.get(`${model}.dff`);
      if (stock) {
        bytes = applyStockPrelight(bytes, new Uint8Array(stock));
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
