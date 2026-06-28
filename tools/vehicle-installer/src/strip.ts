import { openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The installed vehicles a `--strip` run keeps. */
export interface Installed {
  /** Handling ids (uppercase) — the key in handling.cfg. */
  handlingIds: ReadonlySet<string>;
  /** gta3.img entry names (lowercased) — the dff/txd of the installed vehicles. */
  imgNames: ReadonlySet<string>;
  /** Model names (lowercased) — the key in vehicles.ide / carcols.dat / carmods.dat. */
  models: ReadonlySet<string>;
}

/** carcols.dat: keep only installed models in `car`/`car4`; the `col` palette stays. */
export function stripCarcols(text: string, models: ReadonlySet<string>): string {
  return stripSections(text, new Set(['car', 'car4']), models);
}

/** cargrp.dat: keep only installed models in each population group line; comments/blanks + group order stay. */
export function stripCarGroups(text: string, models: ReadonlySet<string>): string {
  return join2(
    text,
    text.split(/\r?\n/).map((line) => {
      const hash = line.indexOf('#');
      const data = hash < 0 ? line : line.slice(0, hash);
      if (data.trim() === '') {
        return line; // a comment-only or blank line — kept as-is
      }
      const kept = data
        .split(',')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '' && models.has(cell.toLowerCase()));

      return kept.join(', ') + (hash < 0 ? '' : `\t${line.slice(hash)}`);
    }),
  );
}

/** carmods.dat: keep only installed models in `mods`; `link`/`wheel` stay. */
export function stripCarmods(text: string, models: ReadonlySet<string>): string {
  return stripSections(text, new Set(['mods']), models);
}

/** Keep only the named entries in gta3.img (the installed vehicles' dff/txd). */
export function stripGta3Img(imgPath: string, keep: ReadonlySet<string>): void {
  if (!existsSync(imgPath)) {
    return;
  }
  const buffer = readFileSync(imgPath);
  const img = openImg(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  for (const name of img.names()) {
    if (!keep.has(name.toLowerCase())) {
      img.delete(name);
    }
  }
  writeFileSync(imgPath, img.build());
}

/** handling.cfg: keep only the installed ids' car-table lines (letter-leading; id = first token). */
export function stripHandling(text: string, ids: ReadonlySet<string>): string {
  return join2(
    text,
    text.split(/\r?\n/).filter((line) => {
      // Only the main car table is letter-leading; comments / `!`/`$`/`%` sub-tables / blanks are kept.
      const trimmed = line.trim();

      return !/^[A-Z]/i.test(trimmed) || ids.has(trimmed.split(/\s+/)[0].toUpperCase());
    }),
  );
}

/** vehicles.ide: keep only the installed models' `cars` lines (model = comma column 1); markers/comments kept. */
export function stripIde(text: string, models: ReadonlySet<string>): string {
  return join2(
    text,
    text.split(/\r?\n/).filter((line) => isComment(line) || !line.includes(',') || models.has(col(line, 1))),
  );
}

/**
 * Reduce the output to **only** the installed vehicles (the `--strip` flag): drop every other entry from
 * `gta3.img` and every other car line from `vehicles.ide` / `handling.cfg` / `carcols.dat` / `carmods.dat`.
 * Structural/shared sections — the carcols `col` palette, carmods `link`/`wheel`, handling sub-tables, comments —
 * are kept (the installed cars reference them).
 */
export function stripOutput(outPath: string, installed: Installed): void {
  stripGta3Img(join(outPath, 'models', 'gta3.img'), installed.imgNames);
  editFile(join(outPath, 'data', 'vehicles.ide'), (text) => stripIde(text, installed.models));
  editFile(join(outPath, 'data', 'handling.cfg'), (text) => stripHandling(text, installed.handlingIds));
  editFile(join(outPath, 'data', 'carcols.dat'), (text) => stripCarcols(text, installed.models));
  editFile(join(outPath, 'data', 'carmods.dat'), (text) => stripCarmods(text, installed.models));
  editFile(join(outPath, 'data', 'cargrp.dat'), (text) => stripCarGroups(text, installed.models));
  editFile(join(outPath, 'parked.json'), (text) => stripParked(text, installed.models));
}

/** parked.json: keep only the installed models' parked-vehicle entries (other fields preserved). */
export function stripParked(jsonText: string, models: ReadonlySet<string>): string {
  const parked = JSON.parse(jsonText) as { model: string }[];

  return `${JSON.stringify(
    parked.filter((entry) => models.has(String(entry.model).toLowerCase())),
    null,
    2,
  )}\n`;
}

/** Lowercased comma column `index` of a line. */
function col(line: string, index: number): string {
  return (line.split(',')[index] ?? '').trim().toLowerCase();
}

function editFile(path: string, edit: (text: string) => string): void {
  if (existsSync(path)) {
    writeFileSync(path, edit(readFileSync(path, 'utf8')));
  }
}

function isComment(line: string): boolean {
  return line.trim().startsWith('#');
}

function join2(base: string, lines: readonly string[]): string {
  return lines.join(base.includes('\r\n') ? '\r\n' : '\n');
}

/** Drop data lines (model = column 0) failing `models`, but only inside `sections`; everything else is kept. */
function stripSections(text: string, sections: ReadonlySet<string>, models: ReadonlySet<string>): string {
  let section = '';
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const token = line.trim().toLowerCase();
    if (token === 'end') {
      section = '';
    } else if (/^[a-z0-9_]+$/.test(token)) {
      section = token; // a bare-word section marker (car, car4, col, mods, link, wheel)
    } else if (sections.has(section) && line.includes(',') && !isComment(line) && !models.has(col(line, 0))) {
      continue; // a non-installed car line in a target section — drop it
    }
    out.push(line);
  }

  return join2(text, out);
}
