/** Parsed `carmods.dat`: the vehicle upgrade ("mod shop") component rules. */
export interface Carmods {
  /** `link` section — paired part ids `[left, right]` (a part and its mirror). */
  links: [string, string][];
  /** `mods` section — model name (lowercased) → the upgrade part ids the car accepts. */
  mods: Map<string, string[]>;
  /** `wheel` section — wheel group id → the wheel part ids in that group. */
  wheels: Map<number, string[]>;
}

/**
 * Parse `carmods.dat`. Three section kinds:
 * - `link` … `end`: `left, right` — a part id paired with its mirror.
 * - `mods` … `end`: `model, part, part, …` — the upgrade parts a car accepts.
 * - `wheel` … `end`: `groupId, wheel_x, …` — wheel part ids grouped by id.
 * Model names are lowercased; inline `#` comments are stripped.
 *
 * NOTE: added for `vehicle-installer` (offline settings merge). Wiring the in-game vehicle component/upgrade
 * system onto this is a later iteration — there is no engine/adapter usage yet (plan 002 "deferred").
 */
export function parseCarmods(text: string): Carmods {
  const links: [string, string][] = [];
  const mods = new Map<string, string[]>();
  const wheels = new Map<number, string[]>();
  let section: null | string = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (line === '') {
      continue;
    }
    if (line === 'link' || line === 'mods' || line === 'wheel') {
      section = line;
      continue;
    }
    if (line === 'end') {
      section = null;
      continue;
    }

    const cells = line.split(',').map((cell) => cell.trim());
    if (section === 'link' && cells.length >= 2) {
      links.push([cells[0], cells[1]]);
    } else if (section === 'mods') {
      mods.set(cells[0].toLowerCase(), parts(cells));
    } else if (section === 'wheel') {
      wheels.set(Number(cells[0]), parts(cells));
    }
  }

  return { links, mods, wheels };
}

/** The part ids after the leading key, blanks (trailing commas) removed. */
function parts(cells: string[]): string[] {
  return cells.slice(1).filter((cell) => cell !== '');
}

/** Drop the inline `#` comment and surrounding whitespace. */
function stripComment(line: string): string {
  return line.split('#')[0].trim();
}
