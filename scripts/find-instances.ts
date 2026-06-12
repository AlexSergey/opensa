import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { datChildUrl, iplBasename, streamIplUrl } from '../src/renderware/archive/resolve-paths';
import { parseGtaDat } from '../src/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '../src/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '../src/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '../src/renderware/parsers/text/ipl.parser';

/**
 * Find every placement of a model across ALL map IPLs (text + extracted binary streams), with the
 * source file of each — companion to `inspect-area.ts` for "ghost text placement vs real streamed
 * placement" cases. Run: `npx tsx scripts/find-instances.ts <modelNameOrId> [...more]`.
 */
const ROOT = join(import.meta.dirname, '..');
const BASE = join(ROOT, 'static');
const queries = process.argv.slice(2).map((value) => value.toLowerCase());
if (queries.length === 0) {
  console.error('usage: npx tsx scripts/find-instances.ts <modelNameOrId> [...more]');
  process.exit(1);
}

const dat = parseGtaDat(readFileSync(join(BASE, 'data', 'gta.dat'), 'utf8'));
const catalog = new Map<number, string>();
const idsByModel = new Map<string, number[]>();
for (const idePath of dat.ide) {
  const file = datChildUrl(BASE, idePath);
  if (!existsSync(file)) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
    catalog.set(def.id, def.modelName);
    const model = def.modelName.toLowerCase();
    idsByModel.set(model, [...(idsByModel.get(model) ?? []), def.id]);
  }
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

const manifest = JSON.parse(readFileSync(join(BASE, 'ipl_binary', 'manifest.json'), 'utf8')) as Record<string, number>;
for (const iplPath of dat.ipl) {
  if (iplPath.toLowerCase().endsWith('.zon')) {
    continue;
  }
  const basename = iplBasename(iplPath);
  const file = datChildUrl(BASE, iplPath);
  if (existsSync(file)) {
    for (const instance of parseIpl(readFileSync(file, 'utf8'))) {
      if (wantedIds.has(instance.id)) {
        report(basename, instance);
      }
    }
  }
  for (let index = 0; index < (manifest[basename] ?? 0); index += 1) {
    const stream = streamIplUrl(BASE, basename, index);
    if (!existsSync(stream)) {
      continue;
    }
    const buffer = readFileSync(stream);
    for (const instance of parseBinaryIpl(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    )) {
      if (wantedIds.has(instance.id)) {
        report(`${basename}_stream${index}`, instance);
      }
    }
  }
}

// Standalone script-gated groups (plan 042) — not in gta.dat/manifest, scan the dir for them.
for (const file of readdirSync(join(BASE, 'ipl_binary'))) {
  if (!file.endsWith('.ipl') || file.includes('_stream')) {
    continue;
  }
  const buffer = readFileSync(join(BASE, 'ipl_binary', file));
  for (const instance of parseBinaryIpl(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  )) {
    if (wantedIds.has(instance.id)) {
      report(file.replace('.ipl', ' (standalone)'), instance);
    }
  }
}

function report(
  from: string,
  instance: { id: number; interior: number; lod: number; position: readonly number[] },
): void {
  const pos = instance.position.map((value) => value.toFixed(2)).join(', ');
  console.log(
    `${catalog.get(instance.id) ?? '?'} (id ${instance.id}) @ (${pos}) [${from}] lod-link=${instance.lod} interior=${instance.interior}`,
  );
}
