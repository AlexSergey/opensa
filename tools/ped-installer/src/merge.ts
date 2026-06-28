/**
 * Merge one ped's settings line into `peds.ide`, **replacing** the entry for that model in place (so the file
 * still parses) and appending a genuinely new one. Key = model (comma column 1), mirroring the engine's
 * `parsePedDefs`. `peds.ide` is roughly id-ordered, so — like `vehicles.ide` — there is no re-sort.
 */

/** Replace the `peds` line in `peds.ide` by model (comma column 1); append before the section `end` if new. */
export function mergePeds(base: string, line: string): string {
  const eol = base.includes('\r\n') ? '\r\n' : '\n';
  const out = base.split(/\r?\n/);
  const found = findSection(out, 'peds');
  if (!found) {
    return base;
  }
  const key = keyAt(line, 1);
  for (let i = found.start + 1; i < found.end; i += 1) {
    if (keyAt(out[i], 1) === key) {
      out[i] = line;

      return out.join(eol);
    }
  }
  out.splice(found.end, 0, line);

  return out.join(eol);
}

/** Locate `<section> … end`; returns the marker + end line indices (`end` = `out.length` if the block runs on). */
function findSection(out: readonly string[], section: string): null | { end: number; start: number } {
  let start = -1;
  for (let i = 0; i < out.length; i += 1) {
    const token = out[i].trim().toLowerCase();
    if (start < 0) {
      if (token === section) {
        start = i;
      }
    } else if (token === 'end') {
      return { end: i, start };
    }
  }

  return start < 0 ? null : { end: out.length, start };
}

/** Lowercased comma column `col` of a line. */
function keyAt(line: string, col: number): string {
  return (line.split(',')[col] ?? '').trim().toLowerCase();
}
