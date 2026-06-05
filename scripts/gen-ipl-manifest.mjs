// Generate static/ipl_binary/manifest.json — a map of { basename: streamCount }
// so the app loads exactly the binary stream IPLs that exist (no probe-by-404).
//   node scripts/gen-ipl-manifest.mjs
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.IPL_DIR ?? 'static/ipl_binary';

const counts = {};
for (const name of readdirSync(DIR)) {
  const match = /^(.+)_stream(\d+)\.ipl$/i.exec(name);
  if (!match) {
    continue;
  }
  const base = match[1].toLowerCase();
  counts[base] = Math.max(counts[base] ?? 0, Number(match[2]) + 1);
}

const out = join(DIR, 'manifest.json');
writeFileSync(out, JSON.stringify(counts));
console.log(`Wrote ${out}: ${Object.keys(counts).length} stream sets`);
