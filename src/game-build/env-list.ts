/** Parse a `['a','b']`-style or `a,b`-style env value into lowercased names (empty when unset). Shared by the
 *  browser config ({@link import('../game-config')}) and the node game builder, so both read the same list. */
export function parseModelList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .replace(/[[\]'"]/g, '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
