import { readFileSync, writeFileSync } from 'node:fs';

// Stretch the night of gtadrive's Atmosphere Simulation timecyc by REMAPPING each hour's data values, keeping
// every comment / hour label / header byte-identical (we only rewrite the numbers on data lines).
//
// Target hour ← source hour (per the ask):
//   20 ← 23 (twilight moved earlier)         0,1,2,3 ← 0 (dark held)
//   4  ← 1  (dawn starts later)              5 ← 5   (morning unchanged)
//   6..19 ← identity (daytime untouched)     21,22,23 ← lerp(23→0) (smooth twilight→dark fade)
const DIR = 'static/data/timecycs';
const SRC = `${DIR}/24h TimeCycle gtadrive's Atmosphere Simulation.dat`;
const OUT = `${DIR}/24h TimeCycle gtadrive's Atmosphere Simulation++.dat`;
const HOURS = 24;

const text = readFileSync(SRC, 'latin1'); // bytes preserved; values are ASCII
const lines = text.split('\n');

// Index of every data line (non-comment, non-blank), in file order → k-th data line = weather floor(k/24), hour k%24.
const dataIdx = [];
lines.forEach((line, i) => {
  const t = line.replace(/\r$/, '').trim();
  if (t !== '' && !t.startsWith('//')) dataIdx.push(i);
});
if (dataIdx.length % HOURS !== 0) throw new Error(`data lines ${dataIdx.length} not a multiple of ${HOURS}`);

const orig = dataIdx.map((i) => lines[i]); // verbatim original data-line text (per k)

/** Lerp the numeric tokens of two data lines, preserving column widths + int/float formatting of line `a`. */
function lerpLine(aLine, bLine, f) {
  const cr = aLine.endsWith('\r') ? '\r' : '';
  const a = aLine.replace(/\r$/, '');
  const b = bLine.replace(/\r$/, '');
  const bNums = b.match(/-?\d+\.?\d*/g) ?? [];
  let n = 0;
  const out = a.replace(/-?\d+\.?\d*/g, (tok) => {
    const av = Number(tok);
    const bv = Number(bNums[n] ?? tok);
    n += 1;
    const v = av + (bv - av) * f;
    const dot = tok.indexOf('.');
    const str = dot >= 0 ? v.toFixed(tok.length - dot - 1) : String(Math.round(v));
    return str.padStart(tok.length, ' '); // keep the original column width (right-aligned)
  });
  return out + cr;
}

/** target hour → { copy: srcHour } or { lerp: [a, b, f] } source hours within the same weather block. */
function mapHour(h) {
  if (h <= 3) return { copy: 0 }; // 0..3 dark (hold midnight)
  if (h === 4) return { copy: 1 }; // dawn starts
  if (h <= 19) return { copy: h }; // 5..19 unchanged (5←5, day identity)
  if (h === 20) return { copy: 23 }; // twilight moved to 20:00
  return { lerp: [23, 0, (h - 20) / 4] }; // 21,22,23 → smooth 23→0 fade (f = .25/.5/.75)
}

for (let k = 0; k < orig.length; k += 1) {
  const base = Math.floor(k / HOURS) * HOURS;
  const h = k % HOURS;
  const m = mapHour(h);
  const newText =
    m.copy !== undefined ? orig[base + m.copy] : lerpLine(orig[base + m.lerp[0]], orig[base + m.lerp[1]], m.lerp[2]);
  lines[dataIdx[k]] = newText;
}

writeFileSync(OUT, lines.join('\n'), 'latin1');
console.log(`wrote ${OUT}  (${orig.length} data rows across ${orig.length / HOURS} weathers)`);
