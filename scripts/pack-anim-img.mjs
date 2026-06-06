// Pack the GTA SA animation IFPs into a single WIMG archive the app reads at
// runtime (see src/renderware/archive/img-archive.ts). Bundles every *.ifp in
// the extracted anim.img folder PLUS the loose ped.ifp (the locomotion set), so
// all animations load from one file.
//
//   node scripts/pack-anim-img.mjs
//   ANIM_SRC=dir ANIM_PED=ped.ifp ANIM_OUT=out.img node scripts/pack-anim-img.mjs
//
// Note: the source folder is `static/anim/anim.img/`, so the output cannot share
// that name — it is written as `static/anim/animations.img`.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const SRC = process.env.ANIM_SRC ?? 'static/anim/anim.img';
const PED = process.env.ANIM_PED ?? 'static/anim/ped.ifp';
const OUT = process.env.ANIM_OUT ?? 'static/anim/animations.img';

const entries = [];
if (existsSync(PED)) {
  entries.push({ name: 'ped.ifp', path: PED });
}
for (const name of readdirSync(SRC).sort()) {
  if (name.toLowerCase().endsWith('.ifp')) {
    entries.push({ name, path: join(SRC, name) });
  }
}

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

mkdirSync(dirname(OUT), { recursive: true });
const out = createWriteStream(OUT);
out.setMaxListeners(0);
out.write(header);
out.write(directory);
for (const entry of entries) {
  await pipeline(createReadStream(entry.path), out, { end: false });
}
await new Promise((resolve, reject) => {
  out.end(resolve);
  out.on('error', reject);
});

console.log(`Packed ${entries.length} IFPs, ${(offset / 1048576).toFixed(1)} MB data -> ${OUT}`);
