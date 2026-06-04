/** Shared text helpers for the line-oriented GTA map formats. */

/** Split into trimmed lines, dropping blank lines and `#` comments. */
export function cleanLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Walk the `sectionName … end` block structure shared by IDE and IPL files.
 * Lines outside any handled section (or inside one with no handler) are ignored;
 * `end` closes the current section.
 */
export function sectionedParse(lines: string[], handlers: Record<string, (row: string[]) => void>): void {
  let section: null | string = null;
  for (const line of lines) {
    if (section === null) {
      section = line.toLowerCase();
      continue;
    }
    if (line.toLowerCase() === 'end') {
      section = null;
      continue;
    }
    handlers[section]?.(splitRow(line));
  }
}

/** Split a comma-separated row into trimmed cells (IDE/IPL use `, ` spacing). */
export function splitRow(line: string): string[] {
  return line.split(',').map((cell) => cell.trim());
}
