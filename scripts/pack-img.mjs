// Pack static/img/gta3 into a single WIMG archive (see src/map/img-archive.ts).
// Streams file data so the ~600 MB output is never held in memory.
//
//   node scripts/pack-img.mjs            # dff + txd only (default)
//   node scripts/pack-img.mjs --all      # every file in the folder
//   IMG_SRC=/path IMG_OUT=/out.img node scripts/pack-img.mjs
import { createReadStream, createWriteStream, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const SRC = process.env.IMG_SRC ?? 'static/img/gta3';
const OUT = process.env.IMG_OUT ?? 'static/models/gta3.img';
const includeAll = process.argv.includes('--all');
const KEEP = new Set(['.dff', '.txd']);

mkdirSync(dirname(OUT), { recursive: true });

const names = readdirSync(SRC)
  .filter((name) => includeAll || KEEP.has(name.slice(name.lastIndexOf('.')).toLowerCase()))
  .sort();

const files = {};
let offset = 0;
for (const name of names) {
  const size = statSync(join(SRC, name)).size;
  files[name.toLowerCase()] = [offset, size];
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
for (const name of names) {
  await pipeline(createReadStream(join(SRC, name)), out, { end: false });
}
await new Promise((resolve, reject) => {
  out.end(resolve);
  out.on('error', reject);
});

console.log(`Packed ${names.length} files, ${(offset / 1048576).toFixed(1)} MB data -> ${OUT}`);
