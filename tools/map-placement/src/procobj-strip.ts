/**
 * Underwater procobj species (surface `P_UNDERWATERBARREN`): seaweed/starfish/searock. These are **never** touched
 * — never stripped, never converted — regardless of any `keep` predicate. Static placement of seabed scatter
 * doesn't behave, and they're harmless to leave on the runtime scatter. (Shared debris like `p_rubble*`, which also
 * scatters on land, is intentionally **not** here.)
 */
export const UNDERWATER_PROCOBJ: ReadonlySet<string> = new Set([
  'searock01',
  'searock02',
  'searock03',
  'searock04',
  'searock05',
  'searock06',
  'seaweed',
  'starfish',
]);

/**
 * Strip a `procobj.dat`: drop every scatter rule whose object name fails `keep` (column 2 of a data row; comment
 * and header lines start with `#`). {@link UNDERWATER_PROCOBJ} species are always kept. Surface/spacing columns and
 * all other lines are preserved.
 */
export function stripProcObj(text: string, keep: (model: string) => boolean): { removed: number; text: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let removed = 0;
  const lines = text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      return true;
    }
    const model = trimmed.split(/\s+/)[1];
    if (model && !UNDERWATER_PROCOBJ.has(model.toLowerCase()) && !keep(model)) {
      removed += 1;

      return false;
    }

    return true;
  });

  return { removed, text: lines.join(eol) };
}

/** A procobj `spacing` so large it parses to `Infinity` (`Number('1e999')`), making the scatter's `area / spacing`
 *  exactly `0` → deterministically zero placements (a clean, OpenSA-only "disable"). */
const DISABLED_SPACING = '1e999';
/** Number of columns in a procobj.dat data row (mirrors the engine parser); fewer = a comment / malformed line. */
const PROCOBJ_COLUMNS = 14;

/**
 * Build a `procobj.dat` fragment that **disables** scatter for the converted species — the Modloader-additive-merge
 * alternative to {@link stripProcObj}'s removal (which an additive merge would undo, re-adding the species from
 * stock). Re-emit each converted `(surface, model)` rule with its `spacing` column overflowed to `Infinity`, so the
 * merge (keyed by surface+model) replaces the stock rule with a zero-density copy; only the affected rows are
 * emitted (the merge keeps stock for the rest). {@link UNDERWATER_PROCOBJ} species are never touched.
 */
export function disableProcObj(text: string, isConverted: (model: string) => boolean): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rows: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const cells = trimmed.split(/\s+/);
    const model = cells[1]?.toLowerCase();
    if (cells.length >= PROCOBJ_COLUMNS && model && !UNDERWATER_PROCOBJ.has(model) && isConverted(model)) {
      cells[2] = DISABLED_SPACING; // spacing column → ∞ ⇒ zero scatter for this (surface, model)
      rows.push(cells.join('\t'));
    }
  }
  if (rows.length === 0) {
    return '';
  }

  return `# lod-procobj: scatter disabled for converted species (now static in lod_procobj.ipl)${eol}${rows.join(eol)}${eol}`;
}
