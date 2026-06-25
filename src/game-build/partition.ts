import { parseIde, parseTimedObjects } from '../renderware/parsers/text/ide.parser';

/** One file to pack: its bare lowercased name (`cj.dff`) + which img to read it from. */
export interface Entry {
  name: string;
  source: Source;
}

/** The four build groups (asset buckets) the build emits — the runtime loaders/VFS fetch + store by these. */
export type GroupName = 'data' | 'models' | 'others' | 'textures';

/** A placed model's dff + txd base names (lowercased, no extension). */
export interface ModelRef {
  model: string;
  txd: string;
}

/** The img-sourced output buckets (loose files are grouped separately by {@link looseGroup}). */
export interface Partition {
  /** Referenced `.dff` geometry + every `.col` collision (collision pairs with the geometry). */
  models: Entry[];
  /** Placement/anim/data world files (ipl/ifp/dat) — packed in the others group. */
  others: Entry[];
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

/** Collision taken wholesale from gta3.img into the models bucket (it pairs with the geometry). */
const MODEL_WORLD_EXTENSIONS = ['.col'] as const;

/** Placement/anim/data taken wholesale from gta3.img into the others bucket. */
const OTHER_WORLD_EXTENSIONS = ['.ipl', '.ifp', '.dat'] as const;

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
 * The group a loose file (keyed by its lowercased relative path) is packed into: everything under `data/`
 * goes to `data`; otherwise by extension — `.dff` → models, `.txd` → textures, the rest (ifp/gxt) → others.
 */
export function looseGroup(name: string): GroupName {
  if (name.startsWith('data/')) {
    return 'data';
  }
  if (name.endsWith('.dff')) {
    return 'models';
  }
  if (name.endsWith('.txd')) {
    return 'textures';
  }

  return 'others';
}

/**
 * Split img-sourced entries into three buckets:
 * - models: each referenced `.dff` (gta3 → gta_int) + every `.col` from gta3.img.
 * - others: every placement/anim/data file (ipl/ifp/dat) from gta3.img.
 * - textures: each referenced `.txd` (gta3 → gta_int).
 * Referenced dff/txd present in neither img are dropped. Loose files are grouped by {@link looseGroup}.
 */
export function partitionEntries(refs: PlacedRefs, gta3: ReadonlySet<string>, gtaInt: ReadonlySet<string>): Partition {
  const models = resolveBucket(refs.models, '.dff', gta3, gtaInt);
  const others: Entry[] = [];
  for (const name of gta3) {
    if (MODEL_WORLD_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      models.push({ name, source: 'gta3' });
    } else if (OTHER_WORLD_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      others.push({ name, source: 'gta3' });
    }
  }

  return { models, others, textures: resolveBucket(refs.txds, '.txd', gta3, gtaInt) };
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
