// Pack the GTA model folders into a single archive in the stock GTA San Andreas IMG (VER2) format — the
// same format the game (and mods shipped as .img, e.g. Proper Fixes) use, so our reader handles them
// interchangeably. Streams file data so the ~600 MB output is never held in memory. Reads from multiple
// source folders (comma-separated); later folders override earlier ones by (lowercased) name, so
// `gta3additional` supplies models missing from the original `gta3` dump (e.g. the gym props) and
// `gta3anim` supplies the zone IFPs (counxref/vegasw/… — map-object animations, plan 041; vanilla SA
// keeps them in gta3.img too). Stream IPLs present in the source folders are NOT packed — they are
// served from `static/ipl_binary/` instead (see gen:ipl-manifest).
//
//   node scripts/pack-img.mjs            # dff + txd + col + ifp (default)
//   node scripts/pack-img.mjs --all      # every file in the folders
//   IMG_SRC=dirA,dirB IMG_OUT=/out.img node scripts/pack-img.mjs
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const SRCS = (process.env.IMG_SRC ?? 'static/img/gta3,static/img/gta3additional,static/img/gta3anim').split(',');
const OUT = process.env.IMG_OUT ?? 'static/models/gta3.img';
const includeAll = process.argv.includes('--all');
const KEEP = new Set(['.col', '.dff', '.ifp', '.txd']);
const SECTOR = 2048; // VER2 offsets + sizes are counted in 2048-byte sectors

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

// Lay every file out on whole sectors, after a sector-aligned directory.
const dirSectors = Math.ceil((8 + entries.length * 32) / SECTOR);
let cursor = dirSectors;
for (const entry of entries) {
  const size = statSync(entry.path).size;
  const sectors = Math.max(1, Math.ceil(size / SECTOR));
  if (sectors > 0xffff) {
    throw new Error(`${entry.name}: ${sectors} sectors exceeds the VER2 u16 size field`);
  }
  if (Buffer.byteLength(entry.name) > 23) {
    throw new Error(`${entry.name}: name exceeds the 23-byte VER2 limit`);
  }
  entry.size = size;
  entry.sectors = sectors;
  entry.offset = cursor;
  cursor += sectors;
}

// The directory: "VER2" + count, then a 32-byte entry each (offset, streamingSize, sizeInArchive=0, name),
// zero-padded out to a whole number of sectors so the first file starts sector-aligned.
const directory = Buffer.alloc(dirSectors * SECTOR);
directory.write('VER2', 0, 'ascii');
directory.writeUInt32LE(entries.length, 4);
entries.forEach((entry, i) => {
  const base = 8 + i * 32;
  directory.writeUInt32LE(entry.offset, base);
  directory.writeUInt16LE(entry.sectors, base + 4);
  directory.write(entry.name, base + 8, 23, 'ascii'); // NUL padding already in the zeroed buffer
});

const out = createWriteStream(OUT);
out.setMaxListeners(0); // many sequential pipeline() calls share this stream
out.write(directory);
for (const entry of entries) {
  await pipeline(createReadStream(entry.path), out, { end: false });
  const pad = entry.sectors * SECTOR - entry.size; // fill the file's last partial sector
  if (pad > 0) {
    out.write(Buffer.alloc(pad));
  }
}
await new Promise((resolve, reject) => {
  out.end(resolve);
  out.on('error', reject);
});

const mb = ((cursor * SECTOR) / 1048576).toFixed(1);
console.log(`Packed ${entries.length} files from ${SRCS.length} folder(s) into VER2 ${mb} MB -> ${OUT}`);
