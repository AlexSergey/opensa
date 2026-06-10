import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One-off audit (plan 004 follow-up): histogram of IDE object-flag bits across every `.ide` that
 * ships under `static/data/maps`, with example models per bit — to see which SA engine flags our
 * renderer still ignores. Run: `npx tsx scripts/ide-flag-histogram.ts`.
 */
const root = join(import.meta.dirname, '..', 'static', 'data', 'maps');
const bits = new Map<number, number>();
const examples = new Map<number, string[]>();
let rows = 0;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }

    return name.toLowerCase().endsWith('.ide') ? [full] : [];
  });
}

for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) {
      continue;
    }
    if (/^(?:objs|tobj|anim|end|cars|peds|txdp|hier|weap|path)$/i.test(line)) {
      section = line.toLowerCase();
      continue;
    }
    if (section !== 'objs' && section !== 'tobj' && section !== 'anim') {
      continue;
    }
    const cells = line.split(',').map((cell) => cell.trim());
    if (cells.length < 5) {
      continue;
    }
    // objs/anim: …, flags is the LAST cell; tobj appends timeOn, timeOff after the flags.
    const flagsIndex = section === 'tobj' ? cells.length - 3 : cells.length - 1;
    const flags = Number(cells[flagsIndex]);
    if (!Number.isInteger(flags)) {
      continue;
    }
    rows += 1;
    for (let bit = 0; bit < 31; bit += 1) {
      if (flags & (1 << bit)) {
        bits.set(bit, (bits.get(bit) ?? 0) + 1);
        const list = examples.get(bit) ?? [];
        if (list.length < 4) {
          list.push(cells[1]);
        }
        examples.set(bit, list);
      }
    }
  }
}

console.log(`rows=${rows}`);
for (const [bit, count] of [...bits.entries()].sort((a, b) => a[0] - b[0])) {
  const hex = `0x${(1 << bit).toString(16)}`;
  console.log(
    `bit ${String(bit).padStart(2)} (${hex.padStart(8)}): ${String(count).padStart(6)}  e.g. ${(examples.get(bit) ?? []).join(', ')}`,
  );
}
