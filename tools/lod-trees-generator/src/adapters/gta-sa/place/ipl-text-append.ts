/**
 * Append impostor LOD instances to a text IPL and/or repoint existing rows onto an impostor — preserving the
 * file's CRLF endings, comments, and every other row verbatim. Appends go at the end of the `inst` section, so
 * they never shift existing instance indices (the index space the binary streams' `lod` fields point into).
 */

/** A new `inst` row (an impostor LOD placed at an HD tree's transform; `lod -1` — it is itself a leaf). */
export interface AppendInst {
  id: number;
  interior: number;
  model: string;
  pos: readonly [number, number, number];
  rot: readonly [number, number, number, number];
}

/** Overwrite an existing data row's id + model (its transform/lod are kept) — used for HDs that already had a LOD. */
export interface Repoint {
  id: number;
  model: string;
}

export interface TextEdits {
  appends: readonly AppendInst[];
  /** data-row index → impostor it should now resolve to. */
  repoints: ReadonlyMap<number, Repoint>;
}

/** Apply edits; returns the new text + the data-row count seen (the base index appends were numbered from). */
export function applyTextEdits(text: string, edits: TextEdits): { instCount: number; text: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const section = findInst(lines);
  if (!section || (edits.appends.length === 0 && edits.repoints.size === 0)) {
    return { instCount: section ? countRows(lines, section) : 0, text };
  }

  const out: string[] = [];
  let r = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (i === section.end) {
      for (const inst of edits.appends) {
        out.push(formatInst(inst));
      }
    }
    if (i > section.start && i < section.end && isRow(lines[i])) {
      out.push(repoint(lines[i], edits.repoints.get(r)));
      r += 1;
    } else {
      out.push(lines[i]);
    }
  }

  return { instCount: r, text: out.join(eol) };
}

function countRows(lines: string[], section: { end: number; start: number }): number {
  let n = 0;
  for (let i = section.start + 1; i < section.end; i += 1) {
    if (isRow(lines[i])) {
      n += 1;
    }
  }

  return n;
}

/** The first `inst … end` block's bounds, or null. */
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

/** `id, model, interior, x, y, z, rx, ry, rz, rw, -1` — a leaf LOD instance at the HD's transform. */
function formatInst(inst: AppendInst): string {
  const t = [...inst.pos, ...inst.rot].join(', ');

  return `${inst.id}, ${inst.model}, ${inst.interior}, ${t}, -1`;
}

function isRow(line: string): boolean {
  const trimmed = line.trim();

  return trimmed !== '' && !trimmed.startsWith('#');
}

/** Replace the id (col 0) + model (col 1) of a row, keeping its spacing/transform/lod. */
function repoint(line: string, to: Repoint | undefined): string {
  if (!to) {
    return line;
  }
  const cells = line.split(',');
  cells[0] = `${to.id}`;
  const lead = /^\s*/.exec(cells[1])?.[0] ?? '';
  const trail = /\s*$/.exec(cells[1])?.[0] ?? '';
  cells[1] = `${lead}${to.model}${trail}`;

  return cells.join(',');
}
