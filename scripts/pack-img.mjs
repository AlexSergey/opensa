// Pack the GTA model folders into a single WIMG archive (see src/map/img-archive.ts).
// Streams file data so the ~600 MB output is never held in memory. Reads from
// multiple source folders (comma-separated); later folders override earlier ones
// by (lowercased) name, so `gta3additional` supplies models missing from the
// original `gta3` dump (e.g. the gym props / CJ_SWEETIE_TRAY_1).
//
//   node scripts/pack-img.mjs            # dff + txd (+ col) only (default)
//   node scripts/pack-img.mjs --all      # every file in the folders
//   IMG_SRC=dirA,dirB IMG_OUT=/out.img node scripts/pack-img.mjs
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const SRCS = (process.env.IMG_SRC ?? 'static/img/gta3,static/img/gta3additional').split(',');
const OUT = process.env.IMG_OUT ?? 'static/models/gta3.img';
const includeAll = process.argv.includes('--all');
const KEEP = new Set(['.col', '.dff', '.txd']);

mkdirSync(dirname(OUT), { recursive: true });

// Merge folders by lowercased name (later folder wins), then sort for a stable archive.
const byName = new Map();
for (const dir of SRCS) {
  if (!existsSync(dir)) {
    continue;
  }
  for (const name of readdirSync(dir)) {
    if (includeAll || KEEP.has(name.slice(name.lastIndexOf('.')).toLowerCase())) {
      byName.set(name.toLowerCase(), { name, path: join(dir, name) });
    }
  }
}
const entries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

const files = {};
let offset = 0;
for (const entry of entries) {
  const size = statSync(entry.path).size;
  files[entry.name.toLowerCase()] = [offset, size];
  offset += size;
}

const directory = Buffer.from(JSON.stringify({ files }), 'utf8');
const header = Buffer.alloc(12);
header.write('WIMG0001', 0, 'ascii');
header.writeUInt32LE(directory.length, 8);

const out = createWriteStream(OUT);
out.setMaxListeners(0); // many sequential pipeline() calls share this stream
out.write(header);
out.write(directory);
for (const entry of entries) {
  await pipeline(createReadStream(entry.path), out, { end: false });
}
await new Promise((resolve, reject) => {
  out.end(resolve);
  out.on('error', reject);
});

console.log(
  `Packed ${entries.length} files from ${SRCS.length} folder(s), ${(offset / 1048576).toFixed(1)} MB -> ${OUT}`,
);
