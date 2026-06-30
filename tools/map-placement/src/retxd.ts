import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { parseIde } from '@opensa/renderware/parsers/text/ide.parser';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { trimTxd } from './txd-trim';

export interface CustomTxd {
  bytes: Uint8Array;
  name: string;
  textures: Set<string>;
}

/**
 * Point the swapped HD models at the user's custom TXD: each swapped DFF references textures that live in the
 * `--txd`, not the stock TXD its IDE names — so the model renders untextured (white) until we (a) pack the custom
 * TXD into the IMG and (b) rewrite the model's IDE `txd` column to it. A model is repointed **only** to a custom
 * TXD that actually contains its textures; a model whose textures aren't in any custom TXD (the user's `--txd`
 * doesn't cover it — its `--dff` still names stock textures) keeps its stock `txd` — repointing it would strip
 * its textures.
 */
export interface RetxdResult {
  /** gta.dat-relative IDE path → rewritten text. */
  ides: Map<string, string>;
  /** IMG entry name (`<txd>.txd`) → TXD bytes to pack. */
  txds: Map<string, Uint8Array>;
}

/**
 * The Modloader-friendly alternative to {@link RetxdResult}: instead of rewriting stock IDEs, parent each swapped
 * model's **stock** TXD (child) to the custom TXD (parent) via a `txdp` IDE section. The stock IDEs stay untouched
 * — the game/engine resolves any texture the child TXD lacks from its parent (see the `./5` reference + the engine
 * `asset-cache` txdp resolver). So a self-contained HD mod ships just the swapped DFFs + the parent TXD + a `txdp`
 * IDE, and overrides nothing.
 */
export interface TxdpResult {
  /** Child stock TXD → parent custom TXD (lowercased), for a `txdp` IDE section. */
  txdp: Map<string, string>;
  /** IMG entry name (`<txd>.txd`) → TXD bytes to pack. */
  txds: Map<string, Uint8Array>;
}

/** Rewrite the `txd` column (cell 2) of every `objs`/`tobj`/`anim` row whose model is in `modelToTxd`. */
export function editIdeTxd(text: string, modelToTxd: ReadonlyMap<string, string>): { changed: boolean; text: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let changed = false;
  let section = '';
  const lines = text.split(/\r?\n/).map((line) => {
    const token = line.trim().toLowerCase();
    if (['2dfx', 'anim', 'end', 'objs', 'path', 'tanm', 'tobj'].includes(token)) {
      section = token === 'end' ? '' : token;

      return line;
    }
    if (!['anim', 'objs', 'tobj'].includes(section) || token === '' || token.startsWith('#')) {
      return line;
    }
    const cells = line.split(',');
    const txd = modelToTxd.get((cells[1] ?? '').trim().toLowerCase());
    if (!txd || cells.length < 3) {
      return line;
    }
    changed = true;
    const lead = /^\s*/.exec(cells[2])?.[0] ?? '';

    return [cells[0], cells[1], `${lead}${txd}`, ...cells.slice(3)].join(',');
  });

  return { changed, text: lines.join(eol) };
}

/** Build the IDE rewrites + the TXDs to pack for `models` (the swapped HD models), reading DFFs from `dffPath`. */
export function retxdSwappedModels(
  gamePath: string,
  idePaths: readonly string[],
  dffPath: string,
  txdPath: string,
  models: readonly string[],
): RetxdResult {
  const { modelToTxd, txdUsed } = resolveModelTxds(dffPath, txdPath, models);

  const modelToTxdName = new Map([...modelToTxd].map(([model, txd]) => [model, txd.name]));
  const ides = new Map<string, string>();
  for (const idePath of idePaths) {
    const file = datChild(gamePath, idePath);
    const edited = file ? editIdeTxd(readFileSync(file, 'utf8'), modelToTxdName) : null;
    if (edited?.changed) {
      ides.set(idePath, edited.text);
    }
  }

  return { ides, txds: packTxds(modelToTxd, txdUsed) };
}

/**
 * The custom TXD covering the **most** of the model's referenced textures, requiring at least one hit — so a model
 * whose textures aren't in any custom TXD returns `undefined` and keeps its stock `txd` (rather than being
 * repointed to a TXD that doesn't contain them, which strips its textures in-game).
 */
export function selectTxd(refs: ReadonlySet<string>, custom: readonly CustomTxd[]): CustomTxd | undefined {
  let best: CustomTxd | undefined;
  let bestHits = 0;
  for (const txd of custom) {
    let hits = 0;
    for (const t of refs) {
      if (txd.textures.has(t)) {
        hits += 1;
      }
    }
    if (hits > bestHits) {
      best = txd;
      bestHits = hits;
    }
  }

  return best;
}

/** Serialize `txdp` parent links ({@link txdpPairs}) as a `txdp` IDE section: `txdp\n<child>, <parent>\n…\nend\n`. */
export function txdpIde(pairs: ReadonlyMap<string, string>): string {
  const rows = [...pairs].map(([child, parent]) => `${child}, ${parent}`);

  return `txdp\n${rows.join('\n')}\nend\n`;
}

/**
 * The `txdp` parent links from each swapped model's **stock** TXD (child) to its **custom** TXD (parent): keyed by
 * stock TXD so models sharing one collapse to a single parent link. A model with no known stock TXD, or already
 * using the custom TXD (child === parent), is skipped — a self-parent `txdp` line is invalid.
 */
export function txdpPairs(
  modelToCustom: ReadonlyMap<string, string>,
  modelToStock: ReadonlyMap<string, string>,
): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const [model, custom] of modelToCustom) {
    const child = modelToStock.get(model);
    if (child && child !== custom) {
      pairs.set(child, custom); // child stock TXD inherits from the custom parent
    }
  }

  return pairs;
}

/**
 * Build a `txdp` (TXD-parent) mapping for the swapped HD models instead of patching their stock IDEs: each model's
 * **stock** TXD (read from the stock IDE) is parented to the custom TXD that holds its textures. Models whose
 * textures aren't in any custom TXD are skipped (they keep stock textures, no parent needed). The stock IDEs are
 * read but never modified.
 */
export function txdpSwappedModels(
  gamePath: string,
  idePaths: readonly string[],
  dffPath: string,
  txdPath: string,
  models: readonly string[],
): TxdpResult {
  const { modelToTxd, txdUsed } = resolveModelTxds(dffPath, txdPath, models);
  const stockTxdByModel = stockTxdNames(gamePath, idePaths, new Set(modelToTxd.keys()));
  const modelToCustom = new Map([...modelToTxd].map(([model, txd]) => [model, txd.name.toLowerCase()]));

  return { txdp: txdpPairs(modelToCustom, stockTxdByModel), txds: packTxds(modelToTxd, txdUsed) };
}

/**
 * Write a Modloader **HD mod** to `hdDir`: the swapped HD DFFs + the custom parent TXD into `gta3img/` (Modloader
 * injects them into `gta3.img` by name), a `txdp` IDE ({@link txdpIde} of {@link txdpSwappedModels}) parenting each
 * swapped model's stock TXD to the custom one, and a one-line `loader.txt`. **No stock IDE is touched.** Returns the
 * number of swapped DFFs — `0` (nothing written) when `swap` is empty or no model matched a custom TXD. Shared by
 * `lod-trees-generator` + `lod-procobj-generator` under `--modloader`.
 */
export function writeTxdpHdMod(args: {
  gamePath: string;
  hdDir: string;
  idePaths: readonly string[];
  inPath: string;
  swap: ReadonlyMap<string, Uint8Array>;
  swapModels: readonly string[];
  txdpIdeRel: string;
}): number {
  const { gamePath, hdDir, idePaths, inPath, swap, swapModels, txdpIdeRel } = args;
  if (swap.size === 0) {
    return 0;
  }
  const { txdp, txds } = txdpSwappedModels(gamePath, idePaths, inPath, inPath, swapModels);
  for (const [name, bytes] of [...swap, ...txds]) {
    writeOut(join(hdDir, 'gta3img', name), bytes); // HD DFFs + custom parent TXD → gta3.img by name
  }
  writeOut(join(hdDir, txdpIdeRel), txdpIde(txdp));
  writeOut(join(hdDir, 'loader.txt'), `IDE ${txdpIdeRel}\n`);

  return swap.size;
}

function base(path: string): string {
  return basename(path)
    .replace(/\.(?:dff|txd)$/i, '')
    .toLowerCase();
}

function datChild(gamePath: string, rel: string): null | string {
  const file = join(gamePath, rel.replace(/\\/g, '/'));

  return statSync(file, { throwIfNoEntry: false })?.isFile() ? file : null;
}

/** Map each model name → its DFF path under `--dff`. */
function dffByModel(dffPath: string): Map<string, string> {
  if (!statSync(dffPath).isDirectory()) {
    return new Map([[base(dffPath), dffPath]]);
  }

  return new Map(readdirSync(dffPath).map((f) => [base(f), join(dffPath, f)]));
}

function dffTextures(file: string): Set<string> {
  const bytes = new Uint8Array(readFileSync(file));
  const dff = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const names = new Set<string>();
  for (const geometry of dff.geometries) {
    for (const material of geometry.materials) {
      if (material.texture?.name) {
        names.add(material.texture.name.toLowerCase());
      }
    }
  }

  return names;
}

/** The custom TXDs from `--txd` (a file or a directory of them), with their texture-name sets. */
function loadCustomTxds(txdPath: string): CustomTxd[] {
  const files = statSync(txdPath).isDirectory()
    ? readdirSync(txdPath)
        .filter((f) => f.toLowerCase().endsWith('.txd'))
        .map((f) => join(txdPath, f))
    : [txdPath];

  return files.map((file) => {
    const bytes = new Uint8Array(readFileSync(file));
    const parsed = parseTxd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    return { bytes, name: base(file), textures: new Set(parsed.textures.map((t) => t.name.toLowerCase())) };
  });
}

/** Pack each used custom TXD, trimmed to just the textures its models reference. */
function packTxds(
  modelToTxd: ReadonlyMap<string, CustomTxd>,
  txdUsed: ReadonlyMap<CustomTxd, Set<string>>,
): Map<string, Uint8Array> {
  const txds = new Map<string, Uint8Array>();
  for (const txd of new Set(modelToTxd.values())) {
    txds.set(`${txd.name}.txd`, trimTxd(txd.bytes, txdUsed.get(txd) ?? new Set<string>()));
  }

  return txds;
}

/**
 * Resolve each swapped model to the custom TXD holding its textures: read the model's DFF texture refs, pick the
 * best-covering custom TXD ({@link selectTxd}), and accumulate the per-TXD union of referenced names (to trim it).
 * A model with no inspectable DFF, or whose textures aren't in any custom TXD, is left out (keeps its stock TXD).
 */
function resolveModelTxds(
  dffPath: string,
  txdPath: string,
  models: readonly string[],
): { modelToTxd: Map<string, CustomTxd>; txdUsed: Map<CustomTxd, Set<string>> } {
  const custom = loadCustomTxds(txdPath);
  const dffFiles = dffByModel(dffPath);
  const modelToTxd = new Map<string, CustomTxd>();
  // Per packed TXD, the union of texture names its models actually reference — used to trim the TXD to just those
  // (a shared mod TXD also holds textures for the models we dropped; only the kept ones read it).
  const txdUsed = new Map<CustomTxd, Set<string>>();
  for (const model of models) {
    const dffFile = dffFiles.get(model);
    if (!dffFile) {
      continue; // can't inspect the DFF → don't risk pointing at a TXD that lacks its textures
    }
    let refs: Set<string>;
    try {
      refs = dffTextures(dffFile);
    } catch {
      continue; // unparseable DFF → leave its stock txd
    }
    const txd = selectTxd(refs, custom);
    if (!txd) {
      continue;
    }
    modelToTxd.set(model, txd);
    const used = txdUsed.get(txd) ?? new Set<string>();
    for (const ref of refs) {
      used.add(ref);
    }
    txdUsed.set(txd, used);
  }

  return { modelToTxd, txdUsed };
}

/** Read the stock `txd` column for each wanted model from the gta.dat IDEs (lowercased model → txd). */
function stockTxdNames(
  gamePath: string,
  idePaths: readonly string[],
  wanted: ReadonlySet<string>,
): Map<string, string> {
  const byModel = new Map<string, string>();
  for (const idePath of idePaths) {
    const file = datChild(gamePath, idePath);
    if (!file) {
      continue;
    }
    for (const def of parseIde(readFileSync(file, 'utf8'))) {
      const model = def.modelName.toLowerCase();
      if (wanted.has(model) && !byModel.has(model)) {
        byModel.set(model, def.txdName.toLowerCase());
      }
    }
  }

  return byModel;
}

/** Write text or bytes, creating parent directories. */
function writeOut(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
