import type { RWClump } from '../parsers/binary/types';
import type { TextureDictionary } from '../three/txd-loader';
import type { ImgArchive } from './img-archive';

import { parseDff } from '../parsers/binary/dff';
import { parseTxd } from '../parsers/binary/txd';
import { buildTextureMap } from '../three/build-texture';

/**
 * Parse models/textures out of the in-memory WIMG archive, cached by name.
 *
 * Synchronous (the archive is already downloaded), so there's no per-model
 * fetch/Suspense. A name absent from the archive (or unparseable) yields an
 * empty clump / empty texture map — it renders nothing instead of crashing.
 */
const EMPTY_CLUMP: RWClump = { atomics: [], frames: [], geometries: [] };

const clumpCache = new Map<string, RWClump>();

/** A TXD's own (raw) parsed textures, by lowercased name (no extension). */
const ownTextureCache = new Map<string, TextureDictionary>();
/** A TXD's *resolved* textures — its own overlaid on its `txdp` parent chain — by lowercased name. */
const resolvedTextureCache = new Map<string, TextureDictionary>();
/** `txdp` parent links (lowercased child → parent). Empty until {@link setTxdParents}; then chains resolve. */
let txdParents = new Map<string, string>();

export function getClump(archive: ImgArchive, modelName: string): RWClump {
  const key = `${modelName.toLowerCase()}.dff`;
  let clump = clumpCache.get(key);
  if (!clump) {
    clump = parseOrEmpty(archive.get(key), parseDff, EMPTY_CLUMP);
    clumpCache.set(key, clump);
  }

  return clump;
}

/** A TXD's resolved textures: its own, overlaid on its `txdp` parent chain (child wins), cached by name. */
export function getTextures(archive: ImgArchive, txdName: string): TextureDictionary {
  const name = txdName.toLowerCase();
  let resolved = resolvedTextureCache.get(name);
  if (!resolved) {
    resolved = resolveTxdChain(name, (n) => ownTextures(archive, n), txdParents);
    resolvedTextureCache.set(name, resolved);
  }

  return resolved;
}

/**
 * Walk a TXD's `txdp` parent chain, overlaying each child's own textures on its parent's so the **child
 * wins** (the inheritance the optimized map relies on). Pure — `ownOf` supplies each TXD's own map — and
 * cycle-guarded; the caller ({@link getTextures}) memoizes the final per-name result. An empty/absent parent
 * map (or missing parent TXD) collapses to just the child, so it's a no-op on self-contained archives.
 */
export function resolveTxdChain(
  name: string,
  ownOf: (name: string) => TextureDictionary,
  parents: Map<string, string>,
  seen = new Set<string>(),
): TextureDictionary {
  const own = ownOf(name);
  const parent = parents.get(name);
  if (!parent || parent === name || seen.has(parent)) {
    return own;
  }
  seen.add(name); // guard cycles in the parent chain
  const inherited = resolveTxdChain(parent, ownOf, parents, seen);

  return inherited.size > 0 ? new Map([...inherited, ...own]) : own;
}

/**
 * Install the `txdp` parent map (from {@link MapDefinitions}). A child TXD then inherits any texture it
 * lacks from its parent (recursively). Clears the resolved cache so existing maps pick up the new chains.
 * No-op effect when empty (stock archives are self-contained), so it's always safe to call.
 */
export function setTxdParents(parents: Map<string, string>): void {
  txdParents = parents;
  resolvedTextureCache.clear();
}

/** Parse one `<name>.txd` into its own texture map (empty if absent/unparseable), cached by name. */
function ownTextures(archive: ImgArchive, name: string): TextureDictionary {
  let textures = ownTextureCache.get(name);
  if (!textures) {
    textures = parseOrEmpty(archive.get(`${name}.txd`), (buffer) => buildTextureMap(parseTxd(buffer)), new Map());
    ownTextureCache.set(name, textures);
  }

  return textures;
}

function parseOrEmpty<T>(buffer: ArrayBuffer | null, parse: (buffer: ArrayBuffer) => T, empty: T): T {
  if (!buffer) {
    return empty;
  }
  try {
    return parse(buffer);
  } catch {
    return empty;
  }
}
