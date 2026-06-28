import { parsePedDefs } from '@opensa/renderware/parsers/text/ped-defs.parser';
import { openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The peds a `--strip` run keeps. */
export interface Installed {
  /** gta3.img entry names (lowercased) — the dff/txd of the installed peds. */
  imgNames: ReadonlySet<string>;
  /** Model names (lowercased) — the key in `peds.ide`. */
  models: ReadonlySet<string>;
  /** The player / main-character ped model (lowercased) — always kept (the engine spawns it). */
  player: string;
}

/** Keep only the named entries in gta3.img (the kept peds' dff/txd). */
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

/**
 * Reduce the output to **only** the installed peds (the `--strip` flag): drop every other entry from `gta3.img`
 * and every other `peds` line from `peds.ide`. The player / main-character ped is always kept (the engine spawns
 * it) — its line and its `gta3.img` dff/txd survive even when it isn't in `--in`.
 */
export function stripOutput(outPath: string, installed: Installed): void {
  const keepModels = new Set([...installed.models, installed.player]);
  const keepImg = new Set(installed.imgNames);
  const idePath = join(outPath, 'data', 'peds.ide');
  if (existsSync(idePath)) {
    const text = readFileSync(idePath, 'utf8');
    // Keep the player ped's archive entries (its txd may be named differently from the model → read peds.ide).
    const player = parsePedDefs(text).get(installed.player);
    keepImg.add(`${installed.player}.dff`);
    keepImg.add(`${(player?.txd ?? installed.player).toLowerCase()}.txd`);
    writeFileSync(idePath, stripPeds(text, keepModels));
  }
  stripGta3Img(join(outPath, 'models', 'gta3.img'), keepImg);
}

/** peds.ide: keep only the kept models' `peds` lines (model = comma col 1); markers/comments/blanks stay. */
export function stripPeds(text: string, keep: ReadonlySet<string>): string {
  let section = '';
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const token = line.trim().toLowerCase();
    if (token === 'end') {
      section = '';
    } else if (/^[a-z0-9_]+$/.test(token)) {
      section = token; // a bare-word section marker (peds, end, …)
    } else if (section === 'peds' && line.includes(',') && !isComment(line) && !keep.has(col(line, 1))) {
      continue; // a non-kept ped line in the peds section — drop it
    }
    out.push(line);
  }

  return out.join(text.includes('\r\n') ? '\r\n' : '\n');
}

/** Lowercased comma column `index` of a line. */
function col(line: string, index: number): string {
  return (line.split(',')[index] ?? '').trim().toLowerCase();
}

function isComment(line: string): boolean {
  return line.trim().startsWith('#');
}
