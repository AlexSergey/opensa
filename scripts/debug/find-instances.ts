import type { PlacedInstance } from '../lib/game';

import { gameArg, loadMapDefs, openGameArchive, positionalArgs } from '../lib/game';

/**
 * Find every placement of a model across ALL map IPLs (text + the binary streams in the archive), with
 * the source of each — companion to `inspect-area.ts` for "ghost text placement vs real streamed
 * placement" cases. Run: `npx tsx scripts/debug/find-instances.ts <modelNameOrId> [...more] [--game original]`.
 */
const game = gameArg();
const queries = positionalArgs().map((value) => value.toLowerCase());
if (queries.length === 0) {
  console.error('usage: npx tsx scripts/debug/find-instances.ts <modelNameOrId> [...more] [--game original]');
  process.exit(1);
}

const archive = openGameArchive(game);
const { catalog, instances } = loadMapDefs(game, archive);

const idsByModel = new Map<string, number[]>();
for (const [id, def] of catalog) {
  const model = def.modelName.toLowerCase();
  idsByModel.set(model, [...(idsByModel.get(model) ?? []), id]);
}

const wantedIds = new Set<number>();
for (const query of queries) {
  const asId = Number(query);
  if (Number.isInteger(asId)) {
    wantedIds.add(asId);
  }
  for (const id of idsByModel.get(query) ?? []) {
    wantedIds.add(id);
  }
}
console.log(`matching ids: ${[...wantedIds].join(', ') || '(none)'}\n`);

for (const instance of instances) {
  if (wantedIds.has(instance.id)) {
    report(instance);
  }
}

function report(instance: PlacedInstance): void {
  const pos = instance.position.map((value) => value.toFixed(2)).join(', ');
  console.log(
    `${catalog.get(instance.id)?.modelName ?? '?'} (id ${instance.id}) @ (${pos}) [${instance.from}] ` +
      `lod-link=${instance.lod} interior=${instance.interior}`,
  );
}
