/**
 * Strip a `procobj.dat`: drop every scatter rule whose object name fails `keep` (column 2 of a data row; comment
 * and header lines start with `#`). Surface/spacing columns and all other lines are preserved.
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
    if (model && !keep(model)) {
      removed += 1;

      return false;
    }

    return true;
  });

  return { removed, text: lines.join(eol) };
}
