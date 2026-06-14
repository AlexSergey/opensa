import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regenerate `src/game/mods/wind-mode.ts` (plan 039) from the wind mod's model set in
 * `game-src/wind/` (the unadapted originals = the ground-truth should-sway list).
 * Run: `npx tsx scripts/gen-wind-list.ts`.
 */
const ROOT = join(import.meta.dirname, '..');
const names = readdirSync(join(ROOT, 'game-src', 'wind'))
  .filter((name) => name.toLowerCase().endsWith('.dff'))
  .map((name) => name.replace(/\.dff$/i, '').toLowerCase())
  .sort();

const header = `/**
 * Wind-sway model list (plan 039): the models the vegetation-wind mod adapts — sourced from the
 * mod's own distribution (\`game-src/wind/*.dff\`, the unadapted originals). Being ON this list is the
 * sway TRIGGER; the per-vertex weights come from the adapted DFFs' day-prelit alpha where present
 * (prelit alpha alone is ambiguous — roads/night overlays use it too, see plan 039 iteration 4b).
 * Regenerate with: \`npx tsx scripts/gen-wind-list.ts\`.
 */
export const WIND_MODELS: ReadonlySet<string> = new Set([
`;
const body = names.map((name) => `  '${name}',`).join('\n');
writeFileSync(join(ROOT, 'src', 'game', 'mods', 'wind-mode.ts'), `${header}${body}\n]);\n`);
console.log(`wrote ${names.length} models`);
