/** Position (`x,y,z`) + rotation quaternion (`x,y,z,w`) to write into an `inst` row. */
export interface IplTransform {
  pos: readonly number[];
  rot: readonly number[];
}

/**
 * Rewrite the position + rotation of specific `inst` rows, keyed by their **parse-order index** — the same index
 * the `lod` field and the companion binary streams point into. Every other line (comments, other sections, blanks,
 * the file's CRLF style) is preserved; only the seven transform cells (3–9) of a targeted row change. Row counting
 * mirrors `parseIpl` exactly (only rows with ≥ 11 cells and a numeric id advance the index) so the caller's indices
 * stay aligned with the LOD-index space.
 */
export function retransformTextIpl(
  text: string,
  transforms: ReadonlyMap<number, IplTransform>,
): { changed: boolean; text: string } {
  if (transforms.size === 0) {
    return { changed: false, text };
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let section: null | string = null;
  let row = -1;
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    if (section === null) {
      section = trimmed.toLowerCase();
      continue;
    }
    if (trimmed.toLowerCase() === 'end') {
      section = null;
      continue;
    }
    if (section !== 'inst') {
      continue;
    }
    const cells = trimmed.split(',').map((cell) => cell.trim());
    if (cells.length < 11 || Number.isNaN(Number(cells[0]))) {
      continue;
    }
    row += 1;
    const transform = transforms.get(row);
    if (!transform) {
      continue;
    }
    [cells[3], cells[4], cells[5]] = transform.pos.map(num);
    [cells[6], cells[7], cells[8], cells[9]] = transform.rot.map(num);
    lines[i] = cells.join(', ');
    changed = true;
  }

  return changed ? { changed, text: lines.join(eol) } : { changed: false, text };
}

/** Serialize a coordinate for an IPL cell (avoid a stray `-0`). */
function num(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}
