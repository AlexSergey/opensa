/** URL helpers that turn gta.dat-style paths into fetchable URLs. */

/** URL of a DAT-referenced child file (IDE/IPL), relative to the served root. */
export function datChildUrl(base: string, datPath: string): string {
  return joinUrl(base, normalizeDatPath(datPath));
}

/** Base name (no path, no extension, lowercased) of a DAT IPL path. */
export function iplBasename(datPath: string): string {
  const file = normalizeDatPath(datPath).split('/').pop() ?? '';

  return file.replace(/\.[^.]*$/, '');
}

/** Backslashes -> slashes, drop leading slashes, lowercased (on-disk assets are lowercase). */
export function normalizeDatPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

/** URL of the Nth binary stream IPL for a text IPL base name. */
export function streamIplUrl(base: string, basename: string, index: number): string {
  return joinUrl(base, `ipl_binary/${basename}_stream${index}.ipl`);
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path}`;
}
