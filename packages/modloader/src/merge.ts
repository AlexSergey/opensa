/**
 * Merge mod vehicle lines into the stock vehicle data files, **replacing** the line for a vehicle in place (so the
 * file still parses) and appending genuinely new ones. The match key mirrors each engine parser:
 * - `vehicles.ide` — `cars` section, key = model (comma column 1).
 * - `carcols.dat`  — `car` section, key = model (comma column 0).
 * - `handling.cfg` — flat car table (lines starting with a letter), key = the id (first whitespace token).
 */

/** Replace `car`-section lines in `carcols.dat` by model (column 0). */
export function mergeCarcols(base: string, lines: readonly string[]): string {
  return mergeSectioned(base, 'car', 0, lines);
}

/** Replace car-table lines in `handling.cfg` by handling id (first token); comments/sub-tables are left alone. */
export function mergeHandling(base: string, lines: readonly string[]): string {
  if (lines.length === 0) {
    return base;
  }
  const eol = base.includes('\r\n') ? '\r\n' : '\n';
  const out = base.split(/\r?\n/);
  const byId = new Map(lines.map((line) => [firstToken(line).toUpperCase(), line]));
  const used = new Set<string>();
  for (let i = 0; i < out.length; i += 1) {
    if (!/^[A-Z]/i.test(out[i].trim())) {
      continue; // comment / blank / a non-car sub-table line (`!`/`$`/`%` …)
    }
    const id = firstToken(out[i]).toUpperCase();
    if (byId.has(id)) {
      out[i] = byId.get(id)!;
      used.add(id);
    }
  }
  appendUnused(out, byId, used);

  return out.join(eol);
}

/** Replace `cars`-section lines in `vehicles.ide` by model (column 1). */
export function mergeIde(base: string, lines: readonly string[]): string {
  return mergeSectioned(base, 'cars', 1, lines);
}

/** Append the replacement lines whose key never matched (new entries) at the end of `out`. */
function appendUnused(out: string[], byKey: ReadonlyMap<string, string>, used: ReadonlySet<string>): void {
  for (const [key, line] of byKey) {
    if (!used.has(key)) {
      out.push(line);
    }
  }
}

function firstToken(line: string): string {
  return line.trim().split(/\s+/)[0] ?? '';
}

/** Lowercased value of comma column `col` of a data line. */
function keyOf(line: string, col: number): string {
  return (line.split(',')[col] ?? '').trim().toLowerCase();
}

/** Replace lines (matched by comma column `col`) inside the `<section> … end` block; append new ones before `end`. */
function mergeSectioned(base: string, section: string, col: number, lines: readonly string[]): string {
  if (lines.length === 0) {
    return base;
  }
  const eol = base.includes('\r\n') ? '\r\n' : '\n';
  const out = base.split(/\r?\n/);
  const byKey = new Map(lines.map((line) => [keyOf(line, col), line]));

  let start = -1;
  let end = -1;
  for (let i = 0; i < out.length; i += 1) {
    const token = out[i].trim().toLowerCase();
    if (start < 0) {
      if (token === section) {
        start = i;
      }
    } else if (token === 'end') {
      end = i;
      break;
    }
  }
  if (start < 0) {
    return base; // no such section — nothing to merge into
  }

  const used = new Set<string>();
  const limit = end < 0 ? out.length : end;
  for (let i = start + 1; i < limit; i += 1) {
    const key = keyOf(out[i], col);
    if (byKey.has(key)) {
      out[i] = byKey.get(key)!;
      used.add(key);
    }
  }

  const fresh = [...byKey].filter(([key]) => !used.has(key)).map(([, line]) => line);
  if (fresh.length > 0) {
    out.splice(end < 0 ? out.length : end, 0, ...fresh);
  }

  return out.join(eol);
}
