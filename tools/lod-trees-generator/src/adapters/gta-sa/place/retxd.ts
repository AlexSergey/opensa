import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface CustomTxd {
  bytes: Uint8Array;
  name: string;
  textures: Set<string>;
}

/**
 * Point the swapped HD models at the user's custom TXD: each swapped DFF references textures that live in the
 * `--txd`, not the stock TXD its IDE names — so the model renders untextured (white) until we (a) pack the custom
 * TXD into the IMG and (b) rewrite the model's IDE `txd` column to it. A model is repointed **only** to a custom
 * TXD that actually contains its textures; a model whose textures aren't in any custom TXD (e.g. a swapped procobj
 * desert plant that still uses stock `gta_procdesert` textures) keeps its stock `txd` — repointing it would strip
 * its textures.
 */
export interface RetxdResult {
  /** gta.dat-relative IDE path → rewritten text. */
  ides: Map<string, string>;
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
  const custom = loadCustomTxds(txdPath);
  const dffFiles = dffByModel(dffPath);
  const modelToTxd = new Map<string, CustomTxd>();
  for (const model of models) {
    const txd = pickTxd(custom, dffFiles.get(model));
    if (txd) {
      modelToTxd.set(model, txd);
    }
  }

  const modelToTxdName = new Map([...modelToTxd].map(([model, txd]) => [model, txd.name]));
  const ides = new Map<string, string>();
  for (const idePath of idePaths) {
    const file = datChild(gamePath, idePath);
    const edited = file ? editIdeTxd(readFileSync(file, 'utf8'), modelToTxdName) : null;
    if (edited?.changed) {
      ides.set(idePath, edited.text);
    }
  }

  const txds = new Map<string, Uint8Array>();
  for (const txd of new Set(modelToTxd.values())) {
    txds.set(`${txd.name}.txd`, txd.bytes);
  }

  return { ides, txds };
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

/** The custom TXD that covers the model's referenced textures, or `undefined` (→ keep its stock `txd`). */
function pickTxd(custom: readonly CustomTxd[], dffFile: string | undefined): CustomTxd | undefined {
  if (!dffFile) {
    return undefined; // can't inspect the DFF → don't risk repointing to a TXD that lacks its textures
  }
  try {
    return selectTxd(dffTextures(dffFile), custom);
  } catch {
    return undefined; // unparseable DFF → leave its stock txd
  }
}
