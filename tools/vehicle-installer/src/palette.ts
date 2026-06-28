import { parseCarcols } from '@opensa/renderware/parsers/text/carcols.parser';

import type { PaletteColor } from './settings';

/**
 * Append a vehicle's custom colours to `carcols.dat`'s `col` section and return the `newN → id` mapping. The id of
 * each new colour is its position in the palette (the engine indexes `col` by line order), continuing from the
 * current palette length — so colours from successive vehicles accumulate (127, 128, then 129, …). The appended
 * `col` line has its `newN` token rewritten to the assigned id (the `# 127` comment). No-op for an empty palette
 * or a file without a `col` section.
 */
export function addPaletteColors(
  carcolsText: string,
  palette: readonly PaletteColor[],
): { idByName: Map<string, number>; text: string } {
  const idByName = new Map<string, number>();
  if (palette.length === 0) {
    return { idByName, text: carcolsText };
  }
  const eol = carcolsText.includes('\r\n') ? '\r\n' : '\n';
  const lines = carcolsText.split(/\r?\n/);
  const colEnd = sectionEnd(lines, 'col');
  if (colEnd < 0) {
    return { idByName, text: carcolsText };
  }

  const next = parseCarcols(carcolsText).palette.length;
  const colLines = palette.map((color, index) => {
    const id = next + index;
    idByName.set(color.name, id);

    return replaceWord(color.line, color.name, String(id));
  });
  lines.splice(colEnd, 0, ...colLines);

  return { idByName, text: lines.join(eol) };
}

/** Replace each symbolic colour name (`newN`) in a carcols line with its assigned numeric id. */
export function resolveColorRefs(line: string, idByName: ReadonlyMap<string, number>): string {
  let out = line;
  for (const [name, id] of idByName) {
    out = replaceWord(out, name, String(id));
  }

  return out;
}

/** Replace `word` as a whole token (so `new1` never matches inside `new10`). */
function replaceWord(text: string, word: string, replacement: string): string {
  return text.replace(new RegExp(`\\b${word}\\b`, 'g'), replacement);
}

/** Index of the `end` that closes `<section>`, or -1 if the section is absent. */
function sectionEnd(lines: readonly string[], section: string): number {
  let inSection = false;
  for (let i = 0; i < lines.length; i += 1) {
    const token = lines[i].trim().toLowerCase();
    if (!inSection) {
      inSection = token === section;
    } else if (token === 'end') {
      return i;
    }
  }

  return -1;
}
