import { cleanLines } from './text-lines';

/**
 * Parse `data/surfinfo.dat` into the surface-name table: **row order = COL material id** (the
 * byte every collision face/primitive carries), so `names[face.material]` is the surface a
 * placement stands on. SA's 179 surfaces include the `P_*` rows `procobj.dat` rules reference
 * (e.g. id 138 → `p_sand`). Only the leading name token is read — the physics/audio columns
 * (adhesion, grip, skidmarks…) belong to later phases. Names are lowercased.
 */
export function parseSurfaceNames(text: string): string[] {
  return cleanLines(text).map((line) => line.split(/\s+/)[0].toLowerCase());
}
