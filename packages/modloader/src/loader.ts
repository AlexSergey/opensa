import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';

/** The gta.dat-style references a loader file carries. `col` is `COLFILE` paths (the level index is dropped). */
export interface LoaderRefs {
  col: string[];
  ide: string[];
  ipl: string[];
}

const COLFILE = /^\s*colfile\s+(?:\d+\s+)?(\S.*)$/i;

/**
 * Parse a Modloader loader file's gta.dat-style directives: `IDE`/`IPL` (via {@link parseGtaDat}) + `COLFILE`
 * (`COLFILE <level> <path>` — the level is dropped, the path kept verbatim). Prose / `#`-comments / a `readme.txt`
 * yield empty lists, so a non-loader `.txt` contributes nothing. The file's name is irrelevant (`loader.txt`,
 * `Loader.txt`, …) — only its content classifies it.
 */
export function parseLoader(text: string): LoaderRefs {
  const { ide, ipl } = parseGtaDat(text);
  const col: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = COLFILE.exec(raw);
    if (match) {
      col.push(match[1].trimEnd());
    }
  }

  return { col, ide, ipl };
}
