/** URL helpers that turn gta.dat-style paths into fetchable URLs. */

/** URL of a DAT-referenced child file (IDE/IPL), relative to the served root. */
export function datChildUrl(base: string, datPath: string): string {
  return joinUrl(base, normalizeDatPath(datPath));
}

/** URL of an asset (dff/txd) inside an IMG folder. */
export function imgAssetUrl(base: string, imgDir: string, name: string, ext: string): string {
  return joinUrl(base, `${normalizeDatPath(imgDir)}/${name.toLowerCase()}.${ext.toLowerCase()}`);
}

/** Backslashes -> slashes, drop leading slashes, lowercased (on-disk assets are lowercase). */
export function normalizeDatPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path}`;
}
