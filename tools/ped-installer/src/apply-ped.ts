import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mergePedImg } from './img-merge';
import { mergePeds } from './merge';
import { parsePedSettings } from './settings';

/** What one ped contributed — its gta3.img entries + the model name `--strip` keeps. */
export interface AppliedPed {
  /** gta3.img entry names written (lowercased dff/txd). */
  imgNames: string[];
  /** Model name (lowercased, the dff basename) — the `peds.ide` / strip key. */
  model?: string;
}

/**
 * Install one ped over `--out`: put its `dff`/`txd` into `models/gta3.img` (replace by name), then — only when a
 * `*.settings.txt` carries a `peds` line (i.e. a **new** ped) — merge that line into `data/peds.ide`. A folder
 * with no settings line is a pure model swap: `peds.ide` is left untouched (the existing slot/id/type/anim group
 * stay). Returns the archive entries written + the model name (so a `--strip` run knows what to keep).
 */
export function applyPed(folderPath: string, outPath: string): AppliedPed {
  const imgNames = mergePedImg(folderPath, join(outPath, 'models', 'gta3.img'));
  const model = imgNames.find((name) => name.endsWith('.dff'))?.replace(/\.dff$/, '');

  const settingsFile = readdirSync(folderPath).find((name) => name.toLowerCase().endsWith('.txt'));
  if (settingsFile) {
    const { pedsLine } = parsePedSettings(readFileSync(join(folderPath, settingsFile), 'utf8'));
    const idePath = join(outPath, 'data', 'peds.ide');
    if (pedsLine !== undefined && existsSync(idePath)) {
      writeFileSync(idePath, mergePeds(readFileSync(idePath, 'utf8'), pedsLine));
    }
  }

  return { imgNames, model };
}
