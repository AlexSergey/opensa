/** One handling entry: the id + its raw fields (interpreted by the physics layer later). */
export interface HandlingEntry {
  /** Whitespace-separated fields after the id (mass, drag, dims, traction, gears, … + `F P` flags). */
  fields: string[];
  id: string;
}

/**
 * Parse `handling.cfg` into a dict keyed by handling id. Only the **standard
 * (car) table** is read — its lines start with the id (a letter). Comment lines
 * (`;`) and the bike/boat/plane sub-tables (prefixed `!`, `$`, `%`, …) are
 * skipped. Fields are kept raw (mixed numbers + `F`/`P` transmission flags + a
 * hex flag); the physics implementation maps columns later.
 */
export function parseHandling(text: string): Map<string, HandlingEntry> {
  const entries = new Map<string, HandlingEntry>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || !/^[A-Z]/i.test(line)) {
      continue; // comment / blank / a non-car sub-table line
    }
    const [id, ...fields] = line.split(/\s+/);
    entries.set(id, { fields, id });
  }

  return entries;
}
