/**
 * Additive merge for the line-based, key-addressed data files the engine re-reads — so a mod can **add or modify**
 * entries without dropping the stock ones (a community mod that ships only its new rows still keeps the base game's,
 * and stacked mods combine). A mod row **replaces** the stock row with the same key (important for `procobj.dat`,
 * which the engine parses as a flat list — a duplicate `(surface, model)` would scatter the species twice) and a
 * new key is appended; stock rows the mod doesn't touch, plus all comments / structure, are kept.
 *
 * Only files keyed by an **in-line identifier** are merged. `surfinfo.dat` (a positional table — index = COL
 * material id) and `plants.dat` stay whole-file overrides; appending to them would corrupt the indexing.
 */

/** Extract a data row's merge key (lowercased), or `null` for a comment / blank / non-data line. */
export type DataKey = (line: string) => null | string;

/** Engine-read data files merged additively, by bare name → the key of one of its data rows. */
export const ADDITIVE_DAT: Record<string, DataKey> = {
  // object.dat (plan 045 collision-damage): `model, mass, …` (comma or whitespace), ≥ 9 cells, `;` comments.
  'object.dat': (line) => cells(line, ';', /[\s,]+/, 9)?.[0] ?? null,
  // procobj.dat scatter rules: `surface model spacing …` (whitespace), ≥ 14 cells, `#` comments. Key = surface+model.
  'procobj.dat': (line) => {
    const row = cells(line, '#', /\s+/, 14);

    return row ? `${row[0]}\0${row[1]}` : null;
  },
};

/**
 * Fold the mod data files (`additions`, last wins per key) onto the stock text: replace stock rows whose key a mod
 * overrides, append rows with new keys, keep everything else. Returns `base` unchanged when no mod row parses.
 */
export function mergeDataFile(base: string, additions: readonly string[], key: DataKey): string {
  const override = new Map<string, string>();
  const order: string[] = [];
  for (const text of additions) {
    for (const raw of text.split(/\r?\n/)) {
      const k = key(raw);
      if (k === null) {
        continue;
      }
      if (!override.has(k)) {
        order.push(k);
      }
      override.set(k, raw.replace(/\s*$/, ''));
    }
  }
  if (order.length === 0) {
    return base;
  }

  const eol = base.includes('\r\n') ? '\r\n' : '\n';
  const used = new Set<string>();
  const out = base.split(/\r?\n/).map((raw) => {
    const k = key(raw);
    if (k !== null && override.has(k)) {
      used.add(k);

      return override.get(k)!;
    }

    return raw;
  });

  const fresh = order.filter((k) => !used.has(k)).map((k) => override.get(k)!);
  if (fresh.length === 0) {
    return out.join(eol);
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') {
    out.pop(); // append new rows after the stock content, before any trailing blank lines
  }

  return `${[...out, ...fresh].join(eol)}${eol}`;
}

/** A data row's lowercased cells, or `null` when it's a comment / blank / has too few columns to be data. */
function cells(line: string, comment: string, separator: RegExp, min: number): null | string[] {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith(comment)) {
    return null;
  }
  const parts = trimmed.split(separator);

  return parts.length >= min ? parts.map((part) => part.toLowerCase()) : null;
}
