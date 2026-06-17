import { parseIde, parseTimedObjects } from '../../src/renderware/parsers/text/ide.parser';

/** One file to pack: its bare lowercased name (`cj.dff`) + which img to read it from. */
export interface Entry {
  name: string;
  source: Source;
}

/** A placed model's dff + txd base names (lowercased, no extension). */
export interface ModelRef {
  model: string;
  txd: string;
}

/** The three output buckets. */
export interface Partition {
  /** Referenced `.dff` geometry. */
  models: Entry[];
  /** World layout files (col/ipl/ifp/dat) — go alongside the loose files in priority.zip. */
  priority: Entry[];
  /** Referenced `.txd` textures. */
  textures: Entry[];
}

/** Unique referenced model + txd base names (lowercased), placed in the map. */
export interface PlacedRefs {
  models: string[];
  txds: string[];
}

/** Which model archive a file's bytes come from: gta3.img (primary) or gta_int.img (override). */
export type Source = 'gta3' | 'gta_int';

/** World-layout files taken wholesale from gta3.img into the priority bucket (collision/placement/anim/data). */
const WORLD_EXTENSIONS = ['.col', '.ipl', '.ifp', '.dat'] as const;

/**
 * id → model/txd refs from one IDE's drawable, **placed** sections: `objs`/anim (`parseIde`) AND `tobj`
 * (`parseTimedObjects`). tobj (time-of-day) models — lit-window / neon night overlays — are placed like any
 * other but parsed separately, so the build must include them too; omitting them drops every tobj model from
 * the archive (they vanish in-game).
 */
export function ideRefs(ideText: string): Map<number, ModelRef> {
  const refs = new Map<number, ModelRef>();
  for (const def of [...parseIde(ideText), ...parseTimedObjects(ideText)]) {
    refs.set(def.id, { model: def.modelName.toLowerCase(), txd: def.txdName.toLowerCase() });
  }

  return refs;
}

/**
 * Split build entries into three buckets:
 * - priority: every world file (col/ipl/ifp/dat) from gta3.img (the loose files are added by the caller).
 * - models: each referenced `.dff` (gta3 → gta_int).
 * - textures: each referenced `.txd` (gta3 → gta_int).
 * Referenced dff/txd present in neither img are dropped.
 */
export function partitionEntries(refs: PlacedRefs, gta3: ReadonlySet<string>, gtaInt: ReadonlySet<string>): Partition {
  const priority: Entry[] = [];
  for (const name of gta3) {
    if (WORLD_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      priority.push({ name, source: 'gta3' });
    }
  }

  return {
    models: resolveBucket(refs.models, '.dff', gta3, gtaInt),
    priority,
    textures: resolveBucket(refs.txds, '.txd', gta3, gtaInt),
  };
}

/** Resolve placed instance ids to the unique set of referenced model + txd base names via the IDE id map. */
export function placedModels(instanceIds: Iterable<number>, ideById: ReadonlyMap<number, ModelRef>): PlacedRefs {
  const models = new Set<string>();
  const txds = new Set<string>();
  for (const id of instanceIds) {
    const ref = ideById.get(id);
    if (ref) {
      models.add(ref.model);
      txds.add(ref.txd);
    }
  }

  return { models: [...models], txds: [...txds] };
}

/** Where a bare file name lives: gta3.img first, then gta_int.img (override), else null (drop). */
export function resolveSource(name: string, gta3: ReadonlySet<string>, gtaInt: ReadonlySet<string>): null | Source {
  if (gta3.has(name)) {
    return 'gta3';
  }
  if (gtaInt.has(name)) {
    return 'gta_int';
  }

  return null;
}

/** Map base names → resolved {@link Entry}s for one extension, deduped, dropping any in neither img. */
function resolveBucket(
  bases: readonly string[],
  ext: string,
  gta3: ReadonlySet<string>,
  gtaInt: ReadonlySet<string>,
): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const base of bases) {
    const name = `${base}${ext}`;
    if (seen.has(name)) {
      continue;
    }
    const source = resolveSource(name, gta3, gtaInt);
    if (source) {
      out.push({ name, source });
      seen.add(name);
    }
  }

  return out;
}
