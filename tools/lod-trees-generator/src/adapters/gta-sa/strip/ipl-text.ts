/**
 * Rewrite a text IPL, dropping every `inst` row whose `(id, modelName)` fails `keep` (and transitively its LOD
 * rows — the last column is the `lod` index into the data rows). Survivors are **re-indexed**. Edits are
 * minimal: every other line (comments, other sections, the file's CRLF endings) is preserved verbatim, and a
 * kept row is only rewritten when its `lod` value actually changes — so the GTA parser sees byte-faithful input.
 *
 * Returns the old→new instance-index `map` (`-1` for dropped rows). This is the area's shared LOD-index space:
 * the companion binary streams' `lod` fields point into it, so the caller feeds the same `map` to those streams.
 */
export function stripTextIpl(
  text: string,
  keep: (id: number, modelName: string) => boolean,
): { map: Int32Array; removed: number; text: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const section = findInst(lines);
  if (!section) {
    return { map: new Int32Array(0), removed: 0, text };
  }

  const rowCells = indexRows(lines, section.start, section.end);
  const { map, removed } = removalSet(rowCells, keep);
  if (removed === 0) {
    return { map, removed: 0, text };
  }

  return { map, removed, text: rebuild(lines, section, rowCells, map).join(eol) };
}

/** The first `inst … end` block's line bounds, or null. */
function findInst(lines: string[]): null | { end: number; start: number } {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const token = lines[i].trim().toLowerCase();
    if (token === 'inst') {
      start = i;
    } else if (start >= 0 && token === 'end') {
      return { end: i, start };
    }
  }

  return null;
}

/** The data rows (skipping comments/blanks), split into cells — the basis the `lod` field indexes. */
function indexRows(lines: string[], start: number, end: number): string[][] {
  const rows: string[][] = [];
  for (let i = start + 1; i < end; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) {
      rows.push(trimmed.split(',').map((cell) => cell.trim()));
    }
  }

  return rows;
}

/** Emit the file's lines with removed rows dropped + kept rows' `lod` minimally re-indexed. */
function rebuild(
  lines: string[],
  section: { end: number; start: number },
  rowCells: string[][],
  map: Int32Array,
): string[] {
  const out = lines.slice(0, section.start + 1);
  let r = 0;
  for (let i = section.start + 1; i < section.end; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      out.push(lines[i]);
      continue;
    }
    if (map[r] >= 0) {
      const lod = Number(rowCells[r][10]);
      const newLod = lod >= 0 && lod < rowCells.length ? map[lod] : -1;
      out.push(newLod === lod ? lines[i] : lines[i].replace(/(-?\d+)(\s*)$/, `${newLod}$2`));
    }
    r += 1;
  }
  for (let i = section.end; i < lines.length; i += 1) {
    out.push(lines[i]);
  }

  return out;
}

/** Mark tree rows + their LOD rows (transitively) for removal; return the old→new index map + removed count. */
function removalSet(
  rowCells: string[][],
  keep: (id: number, modelName: string) => boolean,
): { map: Int32Array; removed: number } {
  const remove = new Uint8Array(rowCells.length);
  const stack: number[] = [];
  rowCells.forEach((cells, r) => {
    if (!keep(Number(cells[0]), cells[1])) {
      remove[r] = 1;
      stack.push(r);
    }
  });
  for (let r = stack.pop(); r !== undefined; r = stack.pop()) {
    const lod = Number(rowCells[r][10]);
    if (lod >= 0 && lod < rowCells.length && remove[lod] === 0) {
      remove[lod] = 1;
      stack.push(lod);
    }
  }

  const map = new Int32Array(rowCells.length).fill(-1);
  let next = 0;
  for (let r = 0; r < rowCells.length; r += 1) {
    if (remove[r] === 0) {
      map[r] = next;
      next += 1;
    }
  }

  return { map, removed: rowCells.length - next };
}
