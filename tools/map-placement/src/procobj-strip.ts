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
