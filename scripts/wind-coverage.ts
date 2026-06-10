import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WIND_MODELS } from '../src/game/mods/wind-mode';
import { parseDff } from '../src/renderware/parsers/binary/dff';
import { IdeFlag } from '../src/renderware/parsers/text/ide-flags';
import { parseIde } from '../src/renderware/parsers/text/ide.parser';

/**
 * Wind coverage audit (plan 039 iteration 4b). `static/wind/` holds the ground-truth set of models
 * that must sway (the wind mod's unadapted originals; mirrored into the runtime constant
 * `WIND_MODELS`); the adapted ones live in `static/img/gta3` with per-vertex sway weights in the
 * day-prelit ALPHA. Reports how each listed model will sway (weighted vs height fallback), checks
 * folder↔constant drift, and lists adapted-looking NON-listed models as review candidates.
 * Run: `npx tsx scripts/wind-coverage.ts`.
 */
const ROOT = join(import.meta.dirname, '..');
const WIND_DIR = join(ROOT, 'static', 'wind');
const GTA3_DIR = join(ROOT, 'static', 'img', 'gta3');
const MAPS_DIR = join(ROOT, 'static', 'data', 'maps');
const ALPHA_FLOOR = 64; // candidate reporting only (the runtime trigger is the list, not alpha)

function walkIde(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkIde(full);
    }

    return entry.name.toLowerCase().endsWith('.ide') ? [full] : [];
  });
}

// Model name (lowercase) → IDE flags, across every map IDE.
const flagsByModel = new Map<string, number>();
for (const file of walkIde(MAPS_DIR)) {
  for (const def of parseIde(readFileSync(file, 'utf8'))) {
    flagsByModel.set(def.modelName.toLowerCase(), def.flags);
  }
}

/** Min day-prelit alpha across the DFF's geometries (255 = no alpha data / not adapted). */
function minPrelitAlpha(file: string): number {
  const buffer = readFileSync(file);
  const clump = parseDff(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  let min = 255;
  for (const geometry of clump.geometries) {
    const prelit = geometry.prelitColors;
    if (!prelit) {
      continue;
    }
    for (let i = 3; i < prelit.length; i += 4) {
      if (prelit[i] < min) {
        min = prelit[i];
      }
    }
  }

  return min;
}

// The runtime trigger is the LIST (src/game/mods/wind-mode.ts, generated from static/wind/);
// prelit alpha only supplies per-vertex weights. This audit reports how each listed model will
// sway, plus adapted-looking non-listed models as candidates (informational — they will NOT sway).
// NB it reads the FOLDER (the generator's source) so list-vs-constant drift also shows up here.
const windList = readdirSync(WIND_DIR)
  .filter((name) => name.toLowerCase().endsWith('.dff'))
  .map((name) => name.toLowerCase());
const constantList = new Set([...WIND_MODELS].map((name) => `${name}.dff`));
const drift = windList.filter((name) => !constantList.has(name));
if (drift.length > 0) {
  console.log(`DRIFT: static/wind has models missing from WIND_MODELS — rerun gen-wind-list.ts: ${drift.join(', ')}`);
}
const gta3Files = new Set(readdirSync(GTA3_DIR).map((name) => name.toLowerCase()));

const noAsset: string[] = [];
const heightMode: string[] = [];
let weighted = 0;

for (const name of windList) {
  const model = name.replace(/\.dff$/, '');
  if (!gta3Files.has(name)) {
    noAsset.push(model);
    continue;
  }
  const min = minPrelitAlpha(join(GTA3_DIR, name));
  if (min < 255) {
    weighted += 1;
  } else {
    const flags = flagsByModel.get(model) ?? 0;
    const hasVegFlag = (flags & (IdeFlag.IS_TREE | IdeFlag.IS_PALM)) !== 0;
    heightMode.push(`${model} (alpha 255${hasVegFlag ? ', veg flag' : ''})`);
  }
}

console.log(`wind list: ${windList.length}`);
console.log(`weighted sway (adapted alphas): ${weighted}`);
console.log(`height-mode sway (no weights — uniform fallback): ${heightMode.length}`);
for (const entry of heightMode) {
  console.log(`  ${entry}`);
}
console.log(`listed but no DFF in gta3: ${noAsset.length}  ${noAsset.join(', ')}`);

// Candidates: adapted-looking gta3 models NOT in the list (they will not sway; review + add to the
// list if they should — e.g. flags/banners). Alpha is ambiguous (roads/overlays use it), so this is
// informational only.
const candidates: string[] = [];
for (const name of gta3Files) {
  if (!name.endsWith('.dff') || windList.includes(name)) {
    continue;
  }
  const min = minPrelitAlpha(join(GTA3_DIR, name));
  if (min < 255 && min >= ALPHA_FLOOR) {
    candidates.push(`${name} (min alpha ${min})`);
  }
}
console.log(`\nnon-listed models with weight-like alphas (candidates to review): ${candidates.length}`);
for (const entry of candidates) {
  console.log(`  ${entry}`);
}
