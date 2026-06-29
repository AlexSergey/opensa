import { ideRefs } from '@opensa/game-build/partition';
import { SA_TREE_MODELS } from '@opensa/map-placement/vegetation';
import { isInterior } from '@opensa/renderware/parsers/text/interior';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { isLodModel } from '@opensa/renderware/parsers/text/lod';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Cell, CellInstance } from '../../core/types';
import type { Archive } from './io';

import { cellKey, cellOf } from '../../core/grid';

/** Tree models (lowercased) — baked into impostors by `lod-trees-generator`, so excluded from the cell merge
 *  (decimated alpha foliage looks bad and duplicates the impostors' far-LOD). */
const TREE_MODELS = new Set(SA_TREE_MODELS);

/** Highest object id across every IDE under the game's data folder — cell-LOD ids start at +1 (no collision). */
export function maxObjectId(gameDir: string): number {
  let max = 0;
  for (const file of walk(join(gameDir, 'data')).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const [id] of ideRefs(readFileSync(file, 'utf8'))) {
      max = Math.max(max, id);
    }
  }

  return max;
}

/**
 * Assemble the exterior map instances into the square cell grid (Phase 0). Read-only reuse of the engine's
 * IDE/IPL parsers — the same data the runtime grid is built from. Interiors and trees (handled by
 * `lod-trees-generator`) are dropped; HD models are baked, and so are `lod*` models that are **base geometry**
 * (no placed HD twin) — redundant per-object `lod*` are skipped (their HD is baked instead). See
 * {@link collectInstances}.
 */
export function resolveCells(gameDir: string, archives: readonly Archive[], cellSize: number): Cell[] {
  const dataDir = join(gameDir, 'data');
  const idToModel = buildIdMap(dataDir);
  const cells = new Map<string, Cell>();
  for (const instance of collectInstances(dataDir, archives, idToModel)) {
    const [cx, cy] = cellOf(instance.position, cellSize);
    const key = cellKey(cx, cy);
    let cell = cells.get(key);
    if (!cell) {
      cell = { cx, cy, instances: [] };
      cells.set(key, cell);
    }
    cell.instances.push(instance);
  }

  return [...cells.values()];
}

function binaryInstances(archives: readonly Archive[]): ReturnType<typeof parseBinaryIpl> {
  const out: ReturnType<typeof parseBinaryIpl> = [];
  for (const archive of archives) {
    for (const name of archive.names.filter((entry) => entry.endsWith('.ipl'))) {
      const buffer = archive.get(name);
      if (buffer) {
        out.push(...parseBinaryIpl(buffer));
      }
    }
  }

  return out;
}

/** id → model name (lowercased) from every IDE under the game's data folder. */
function buildIdMap(dataDir: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const [id, ref] of ideRefs(readFileSync(file, 'utf8'))) {
      map.set(id, ref.model.toLowerCase());
    }
  }

  return map;
}

/**
 * Every exterior, non-tree instance to bake into the cells: all HD models **plus** the `lod*` models that are
 * **base geometry** — i.e. have no placed HD twin (e.g. the LA-east `lodlae2_lndhub*` ground-fill plates SA ships
 * only as `lod`-named). Redundant per-object `lod*` (whose HD twin *is* placed, like `lodlae2_roads89` ↔
 * `lae2_roads89`) are skipped: their HD is already baked, so baking the LOD too would double the surface
 * (z-fighting in the cell mesh). Without baking the base-only LODs, stripping them later leaves blue holes.
 */
function collectInstances(
  dataDir: string,
  archives: readonly Archive[],
  idToModel: Map<number, string>,
): CellInstance[] {
  // First pass: every exterior, non-tree instance with a resolved model (+ the set of all placed model names).
  const raw: CellInstance[] = [];
  const placed = new Set<string>();
  for (const instance of [...textInstances(dataDir), ...binaryInstances(archives)]) {
    if (isInterior(instance.interior)) {
      continue; // real interior (low byte ≠ 0, non-world) — `interior > 0` dropped area-coded exteriors like 1024
    }
    const model = idToModel.get(instance.id) ?? instance.modelName.toLowerCase();
    if (!model || TREE_MODELS.has(model)) {
      continue; // missing def, or a tree (→ lod-trees-generator impostor)
    }
    placed.add(model);
    raw.push({ model, position: instance.position, rotation: instance.rotation });
  }
  // Second pass: keep HD; keep a `lod*` only when it has no placed HD twin (base geometry, else redundant).

  return raw.filter((instance) => !isLodModel(instance.model) || !hasHdTwin(instance.model, placed));
}

/** Whether a `lod*` model has a placed **HD twin** — its name with the `lod`/`lod<N>` prefix stripped is a placed,
 *  non-LOD model (e.g. `lodlae2_roads89` → `lae2_roads89`, `lod1blockk_lae` → `blockk_lae`). Such LODs are
 *  redundant (the HD is baked); a `lod*` with no twin is base geometry that must be baked itself. */
function hasHdTwin(lodModel: string, placed: ReadonlySet<string>): boolean {
  for (const twin of [lodModel.replace(/^lod\d+/, ''), lodModel.replace(/^lod/, '')]) {
    if (twin !== lodModel && twin.length > 0 && !isLodModel(twin) && placed.has(twin)) {
      return true;
    }
  }

  return false;
}

function textInstances(dataDir: string): ReturnType<typeof parseIpl> {
  return walk(dataDir)
    .filter((file) => file.toLowerCase().endsWith('.ipl') && !/[/\\]interior[/\\]/i.test(file))
    .flatMap((file) => parseIpl(readFileSync(file, 'utf8')));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, out);
    } else {
      out.push(path);
    }
  }

  return out;
}
