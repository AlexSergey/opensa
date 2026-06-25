import { ideRefs } from '@opensa/game-build/partition';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { isLodModel } from '@opensa/renderware/parsers/text/lod';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Cell, CellInstance } from '../../core/types';
import type { Archive } from './io';

import { cellKey, cellOf } from '../../core/grid';

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
 * Assemble the exterior **HD** map instances into the square cell grid (Phase 0). Read-only reuse of the
 * engine's IDE/IPL parsers — the same data the runtime grid is built from. Interiors and existing `lod*` models
 * are dropped (we regenerate LODs from HD), so each cell holds only the full-detail instances to bake.
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

/** Every exterior, non-LOD HD instance with its model resolved by id. */
function collectInstances(
  dataDir: string,
  archives: readonly Archive[],
  idToModel: Map<number, string>,
): CellInstance[] {
  const out: CellInstance[] = [];
  for (const instance of [...textInstances(dataDir), ...binaryInstances(archives)]) {
    if (instance.interior > 0) {
      continue;
    }
    const model = idToModel.get(instance.id) ?? instance.modelName.toLowerCase();
    if (!model || isLodModel(model)) {
      continue; // missing def, or an old LOD we're regenerating
    }
    out.push({ model, position: instance.position, rotation: instance.rotation });
  }

  return out;
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
