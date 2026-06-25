/** Parsed `carcols.dat`: the shared palette + per-car colour combos. */
export interface VehicleColours {
  /** 2-colour cars: model name → list of `[primary, secondary]` palette-index combos. */
  cars: Map<string, [number, number][]>;
  /** 4-colour cars: model name → list of `[c1, c2, c3, c4]` palette-index combos. */
  cars4: Map<string, [number, number, number, number][]>;
  /** Colour palette indexed by line order: `[r, g, b]`. */
  palette: [number, number, number][];
}

/**
 * Parse `carcols.dat`. Three section kinds:
 * - `col` … `end`: the palette, one `R,G,B` per line (indexed by order).
 * - `car` … `end`: 2-colour cars, `name, p,s, p,s, …` palette-index pairs.
 * - `car4` … `end`: 4-colour cars, `name, c1,c2,c3,c4, …` quads.
 * Names are lowercased; inline `#` comments are stripped.
 */
export function parseCarcols(text: string): VehicleColours {
  const palette: [number, number, number][] = [];
  const cars = new Map<string, [number, number][]>();
  const cars4 = new Map<string, [number, number, number, number][]>();
  let section: null | string = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (line === '') {
      continue;
    }
    if (line === 'col' || line === 'car' || line === 'car4') {
      section = line;
      continue;
    }
    if (line === 'end') {
      section = null;
      continue;
    }

    const cells = line.split(',').map((cell) => cell.trim());
    if (section === 'col') {
      palette.push([Number(cells[0]), Number(cells[1]), Number(cells[2])]);
    } else if (section === 'car') {
      const nums = values(cells);
      const combos: [number, number][] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        combos.push([nums[i], nums[i + 1]]);
      }
      cars.set(cells[0].toLowerCase(), combos);
    } else if (section === 'car4') {
      const nums = values(cells);
      const combos: [number, number, number, number][] = [];
      for (let i = 0; i + 3 < nums.length; i += 4) {
        combos.push([nums[i], nums[i + 1], nums[i + 2], nums[i + 3]]);
      }
      cars4.set(cells[0].toLowerCase(), combos);
    }
  }

  return { cars, cars4, palette };
}

/** Drop the inline `#` comment and surrounding whitespace. */
function stripComment(line: string): string {
  return line.split('#')[0].trim();
}

/** Numeric cells after the model name, blanks (trailing commas) removed. */
function values(cells: string[]): number[] {
  return cells
    .slice(1)
    .filter((cell) => cell !== '')
    .map(Number);
}
