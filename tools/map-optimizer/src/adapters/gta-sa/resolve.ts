import type { ModelRef } from '@opensa/game-build/partition';
import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { ideRefs, placedModels } from '@opensa/game-build/partition';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One placed instance: its (lowercased) model name + world transform, for the seam-weld pass (plan 016). */
export interface Placement {
  modelName: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
}

/**
 * The unique DFF **models** and TXD **textures** the game's EXTERIOR map references (deduped, lowercased).
 * Reuses the build partition + IPL/IDE parsers read-only — the same logic `scripts/build-game.ts` uses to
 * know what the map needs. Interiors are skipped (the optimizer targets the visible world).
 */
export function resolveMap(dataDir: string, gta3: ImgArchive): { models: string[]; txds: string[] } {
  const placed = placedModels(placedInstanceIds(dataDir, gta3), ideIdMap(dataDir));

  return { models: [...new Set(placed.models)], txds: [...new Set(placed.txds)] };
}

/**
 * Every exterior placement (loose text IPLs + binary streams inside gta3.img) with its world transform, model
 * name resolved from the IDE catalog by id — so names match the pipeline's asset names (lowercased). Interiors
 * are skipped (same as {@link resolveMap}). Reuses the IPL/IDE parsers read-only.
 */
export function resolvePlacements(dataDir: string, gta3: ImgArchive): Placement[] {
  const idMap = ideIdMap(dataDir);
  const placements: Placement[] = [];
  const push = (instance: {
    id: number;
    position: [number, number, number];
    rotation: [number, number, number, number];
  }): void => {
    const ref = idMap.get(instance.id);
    if (ref) {
      placements.push({ modelName: ref.model, position: instance.position, rotation: instance.rotation });
    }
  };
  for (const file of walk(dataDir)) {
    if (!file.toLowerCase().endsWith('.ipl') || /[/\\]interior[/\\]/i.test(file)) {
      continue;
    }
    for (const instance of parseIpl(readFileSync(file, 'utf8'))) {
      push(instance);
    }
  }
  for (const name of gta3.names) {
    if (name.endsWith('.ipl')) {
      const buffer = gta3.get(name);
      if (buffer) {
        for (const instance of parseBinaryIpl(buffer)) {
          push(instance);
        }
      }
    }
  }

  return placements;
}

/** id → {model, txd} (lowercased) from every IDE under the game's data folder. */
function ideIdMap(dataDir: string): Map<number, ModelRef> {
  const map = new Map<number, ModelRef>();
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const [id, ref] of ideRefs(readFileSync(file, 'utf8'))) {
      map.set(id, ref);
    }
  }

  return map;
}

/** All instance ids placed by the loose `.ipl` files (non-interior) + the binary IPLs inside gta3.img. */
function placedInstanceIds(dataDir: string, gta3: ImgArchive): number[] {
  const ids: number[] = [];
  for (const file of walk(dataDir)) {
    if (!file.toLowerCase().endsWith('.ipl') || /[/\\]interior[/\\]/i.test(file)) {
      continue;
    }
    for (const instance of parseIpl(readFileSync(file, 'utf8'))) {
      ids.push(instance.id);
    }
  }
  for (const name of gta3.names) {
    if (name.endsWith('.ipl')) {
      const buffer = gta3.get(name);
      if (buffer) {
        for (const instance of parseBinaryIpl(buffer)) {
          ids.push(instance.id);
        }
      }
    }
  }

  return ids;
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
