/** One population vehicle group from `cargrp.dat` — the cars a ped type might drive. */
export interface CarGroup {
  /** The trailing `#` comment (the group label, e.g. `POPCYCLE_GROUP_WORKERS`), or '' if none. */
  comment: string;
  /** The vehicle model names in this group (lowercased), in order. */
  models: string[];
}

/**
 * Parse `cargrp.dat` — the per-ped-type vehicle distribution. Each non-comment line is a comma-separated list of
 * vehicle model names followed by a `#` group-label comment; the **line order is the group index** (workers,
 * business, … then gangs). Leading `#` comment lines and blanks are skipped.
 *
 * NOTE: added for `vehicle-installer` (offline `--strip`). Wiring the in-game population/traffic system onto this
 * is a later iteration — there is no engine/adapter usage yet (tagged deferred).
 */
export function parseCarGroups(text: string): CarGroup[] {
  const groups: CarGroup[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const hash = raw.indexOf('#');
    const data = (hash < 0 ? raw : raw.slice(0, hash)).trim();
    if (data === '') {
      continue; // a blank line or a pure-comment line
    }
    const models = data
      .split(',')
      .map((cell) => cell.trim().toLowerCase())
      .filter((cell) => cell !== '');
    groups.push({ comment: hash < 0 ? '' : raw.slice(hash + 1).trim(), models });
  }

  return groups;
}
