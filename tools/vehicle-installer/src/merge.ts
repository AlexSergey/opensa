/**
 * Merge one vehicle's settings lines into the stock data files, **replacing** the entry for that vehicle in place
 * (so the file still parses) and adding genuinely new ones. Match keys mirror each engine parser:
 * - `vehicles.ide` — `cars` section, key = model (comma column 1). Replace-or-append (file is id-ordered).
 * - `handling.cfg` — flat car table (letter-leading lines), key = the id (first token). Replace-or-append.
 * - `carcols.dat`  — `car`/`car4` section, key = model (column 0). Replace-or-insert, section **alpha-sorted**.
 * - `carmods.dat`  — `mods` section, key = model (column 0). Replace-or-insert, section **alpha-sorted**.
 */

/**
 * Replace/insert the carcols line by model (column 0), into `car` or `car4` **per the line's own colour count**
 * (2 values per combo → `car`, 4 → `car4`). The model is first removed from BOTH colour sections, so a vehicle
 * whose mod changed its colour count **moves** between them. Each touched section stays alpha-sorted.
 */
export function mergeCarcols(base: string, line: string): string {
  const model = keyAt(line, 0);
  const moved = removeFromSection(removeFromSection(base, 'car4', model), 'car', model);

  return mergeSortedSection(moved, carcolsSection(line), line);
}

/** Replace/insert the `mods` line in `carmods.dat` by model (column 0); keep the section alpha-sorted. */
export function mergeCarmods(base: string, line: string): string {
  return mergeSortedSection(base, 'mods', line);
}

/** Replace the car-table line in `handling.cfg` by id (first token); append if new. */
export function mergeHandling(base: string, line: string): string {
  const eol = eolOf(base);
  const out = base.split(/\r?\n/);
  const id = firstToken(line).toUpperCase();
  for (let i = 0; i < out.length; i += 1) {
    if (/^[A-Z]/i.test(out[i].trim()) && firstToken(out[i]).toUpperCase() === id) {
      out[i] = line;

      return out.join(eol);
    }
  }
  out.push(line);

  return out.join(eol);
}

/** Replace the `cars` line in `vehicles.ide` by model (column 1); append before the section `end` if new. */
export function mergeIde(base: string, line: string): string {
  return replaceOrAppend(base, 'cars', 1, line);
}

/**
 * `car4` when each colour combo carries 4 values (`1,31,1,0`), else `car` (2 values, `34,34`). Combos are
 * separated by a comma+whitespace, values within a combo by a bare comma — the stock `carcols.dat` / settings
 * convention, so the colour count is read straight from the line the vehicle ships.
 */
function carcolsSection(line: string): 'car4' | 'car' {
  const combos = line.split(/,\s+/); // [model, combo1, combo2, …]

  return (combos[1] ?? '').split(',').length === 4 ? 'car4' : 'car';
}

function eolOf(base: string): string {
  return base.includes('\r\n') ? '\r\n' : '\n';
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

function firstToken(line: string): string {
  return line.trim().split(/\s+/)[0] ?? '';
}

/** Lowercased comma column `col` of a line. */
function keyAt(line: string, col: number): string {
  return (line.split(',')[col] ?? '').trim().toLowerCase();
}

/** Rebuild a section's entry lines (keyed by column 0) with `line` added/replaced, sorted by model name. */
function mergeSortedSection(base: string, section: 'car4' | 'car' | 'mods', line: string): string {
  const eol = eolOf(base);
  const out = base.split(/\r?\n/);
  const found = findSection(out, section);
  if (!found) {
    return base;
  }
  const entries = new Map<string, string>();
  for (let i = found.start + 1; i < found.end; i += 1) {
    const trimmed = out[i].trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) {
      entries.set(keyAt(out[i], 0), out[i]);
    }
  }
  entries.set(keyAt(line, 0), line);
  const sorted = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, value]) => value);
  out.splice(found.start + 1, found.end - found.start - 1, ...sorted);

  return out.join(eol);
}

/** Remove the line keyed by column 0 == `model` from `<section>` (no-op if the section or model is absent). */
function removeFromSection(base: string, section: string, model: string): string {
  const out = base.split(/\r?\n/);
  const found = findSection(out, section);
  if (found) {
    for (let i = found.start + 1; i < found.end; i += 1) {
      if (keyAt(out[i], 0) === model) {
        out.splice(i, 1);

        return out.join(eolOf(base));
      }
    }
  }

  return base;
}

/** Replace the line keyed by comma column `col` inside `<section>` in place, else insert before its `end`. */
function replaceOrAppend(base: string, section: string, col: number, line: string): string {
  const eol = eolOf(base);
  const out = base.split(/\r?\n/);
  const found = findSection(out, section);
  if (!found) {
    return base;
  }
  const key = keyAt(line, col);
  for (let i = found.start + 1; i < found.end; i += 1) {
    if (keyAt(out[i], col) === key) {
      out[i] = line;

      return out.join(eol);
    }
  }
  out.splice(found.end, 0, line);

  return out.join(eol);
}
