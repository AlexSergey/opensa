/**
 * In-browser port of `scripts/build-game.ts`'s selection (plan 053, phase 4). Given a raw GTA install, it
 * picks the same asset set the shipped build packs — the exterior-placed models/textures (from IPL/IDE) plus
 * the loose + world files — using the **shared** partition logic (`src/game-build/partition.ts`). No zipping:
 * the bytes go straight into the VFS (phase 5). The install is reached through {@link InstallSource} so this is
 * unit-testable over fakes; the File System Access wiring lands in phase 5.
 */
import type { Entry, ModelRef } from '@opensa/game-build/partition';

import { ideRefs, partitionEntries, placedModels } from '@opensa/game-build/partition';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { parsePedDefs } from '@opensa/renderware/parsers/text/ped-defs.parser';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

import type { LazyImgArchive } from './img-reader';

/** What to materialise into the VFS — mirrors the build's buckets (loose files are grouped by `looseGroup`). */
export interface InstallPlan {
  /** Loose file paths, ingested by their relative path (bucketed by `looseGroup`). */
  loose: string[];
  /** Referenced `.dff` + every `.col` archive entries. */
  models: Entry[];
  /** Placement/anim/data world files (ipl/ifp/dat) from `gta3.img`, ingested by bare name. */
  others: Entry[];
  /** Referenced `.txd` archive entries. */
  textures: Entry[];
}

/** A raw GTA install folder, abstracted for the conversion (FSA-backed in production, faked in tests). */
export interface InstallSource {
  /** Opened `gta3.img` (required) — lazy entry reads. */
  readonly gta3: LazyImgArchive;
  /** Opened `gta_int.img` (override), or null when absent. */
  readonly gtaInt: LazyImgArchive | null;
  /** Loose file paths, lowercased + `/`-joined relative, EXCLUDING the model/anim archives. */
  looseFiles(): Promise<string[]>;
  /** Raw bytes of a loose file. */
  readLoose(path: string): Promise<Uint8Array>;
  /** UTF-8 text of a loose file (IDE/IPL). */
  readLooseText(path: string): Promise<string>;
}

/** Options for {@link selectInstallEntries} — the dynamically-spawned models. */
export interface SelectOptions {
  /** Ped model names (from `peds.ide`) to pull in — e.g. `[VITE_MAIN_CHARACTER]`. */
  peds?: readonly string[];
}

/** Read one partition entry's bytes from the archive it resolves to (gta3, or gta_int override). */
export async function readEntry(source: InstallSource, entry: Entry): Promise<Uint8Array> {
  const archive = entry.source === 'gta3' ? source.gta3 : source.gtaInt;
  const bytes = archive ? await archive.read(entry.name) : null;
  if (!bytes) {
    throw new Error(`missing archive entry: ${entry.name}`);
  }

  return bytes;
}

/**
 * Compute the install's selection (exterior-placed models/textures + loose + world) — the build's port. Also
 * pulls in the named **peds** (from `peds.ide`) and **vehicles** (from `vehicles.ide`), since those are
 * spawned dynamically, not placed on the map, so the partition would otherwise miss them (plan 053 stop-gap).
 */
export async function selectInstallEntries(source: InstallSource, options: SelectOptions = {}): Promise<InstallPlan> {
  const placed = placedModels(await placedInstanceIds(source), await ideById(source));
  const extra = await dynamicModelRefs(source, options.peds ?? []);
  const refs = { models: [...placed.models, ...extra.models], txds: [...placed.txds, ...extra.txds] };
  const { models, others, textures } = partitionEntries(
    refs,
    new Set(source.gta3.names),
    new Set(source.gtaInt?.names ?? []),
  );

  return { loose: await source.looseFiles(), models, others, textures };
}

/** Model + txd base names for the dynamically-spawned set: the requested **peds** + **every** vehicle in
 *  `vehicles.ide` (cars are spawned dynamically, not placed on the map, so the partition would otherwise miss them). */
async function dynamicModelRefs(
  source: InstallSource,
  peds: readonly string[],
): Promise<{ models: string[]; txds: string[] }> {
  const models: string[] = [];
  const txds: string[] = [];
  const loose = await source.looseFiles();

  const pedsPath = peds.length > 0 ? loose.find((path) => path.endsWith('peds.ide')) : undefined;
  if (pedsPath) {
    const defs = parsePedDefs(await source.readLooseText(pedsPath));
    for (const name of peds) {
      const def = defs.get(name.toLowerCase());
      if (def) {
        models.push(def.model.toLowerCase());
        txds.push(def.txd.toLowerCase());
      }
    }
  }

  const vehiclesPath = loose.find((path) => path.endsWith('vehicles.ide'));
  if (vehiclesPath) {
    for (const def of parseVehicleDefs(await source.readLooseText(vehiclesPath)).values()) {
      models.push(def.model.toLowerCase());
      txds.push(def.txd.toLowerCase());
    }
  }

  return { models, txds };
}

/** `id → {model, txd}` from every IDE under `data/` (matches the build's `ideIdMap`). */
async function ideById(source: InstallSource): Promise<Map<number, ModelRef>> {
  const map = new Map<number, ModelRef>();
  for (const path of await source.looseFiles()) {
    if (path.startsWith('data/') && path.endsWith('.ide')) {
      for (const [id, ref] of ideRefs(await source.readLooseText(path))) {
        map.set(id, ref);
      }
    }
  }

  return map;
}

/** Exterior-placed instance ids: text IPLs under `data/` (not `interior/`) + binary IPL streams in gta3.img. */
async function placedInstanceIds(source: InstallSource): Promise<number[]> {
  const ids: number[] = [];
  for (const path of await source.looseFiles()) {
    if (path.startsWith('data/') && path.endsWith('.ipl') && !path.includes('/interior/')) {
      for (const inst of parseIpl(await source.readLooseText(path))) {
        ids.push(inst.id);
      }
    }
  }
  for (const name of source.gta3.names) {
    if (name.endsWith('.ipl')) {
      const bytes = await source.gta3.read(name);
      if (bytes) {
        for (const inst of parseBinaryIpl(toArrayBuffer(bytes))) {
          ids.push(inst.id);
        }
      }
    }
  }

  return ids;
}

/** A tight `ArrayBuffer` view of `bytes` (copying only when it is a sub-range of a larger buffer). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }

  return bytes.slice().buffer;
}
