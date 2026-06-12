/**
 * Dump one effects.fxp system: emitters, blend modes, textures and every keyframed track.
 * Usage: npx tsx scripts/dump-fx-system.ts <system-name> [fxp-path]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFxp } from '../src/renderware/parsers/text/fxp.parser';

const name = (process.argv[2] ?? 'fire').toLowerCase();
const path = process.argv[3] ?? join(process.cwd(), 'static', 'models', 'effects.fxp');

const systems = parseFxp(readFileSync(path, 'utf8'));
const system = systems.get(name);
if (!system) {
  console.error(`system "${name}" not found (${systems.size} systems in ${path})`);
  process.exit(1);
}

console.log(`SYSTEM ${system.name}  cullDist=${system.cullDist}  sphere=[${system.boundingSphere.join(', ')}]`);
for (const emitter of system.emitters) {
  console.log(
    `\nEMITTER ${emitter.name}  texture=${emitter.texture}  src=${emitter.srcBlendId} dst=${emitter.dstBlendId} alphaOn=${emitter.alphaOn}`,
  );
  for (const [track, keys] of [...emitter.tracks].sort(([a], [b]) => a.localeCompare(b))) {
    const dump = keys.map((key) => `${key.time}:${key.value}`).join('  ');
    console.log(`  ${track.padEnd(16)} ${dump}`);
  }
}
