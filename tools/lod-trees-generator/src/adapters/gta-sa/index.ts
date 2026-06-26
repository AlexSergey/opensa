import { readRw } from '@opensa/rw-codec/chunk';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { HdTree, Impostor, TreeLodAdapter, TreeLodConfig } from '../../core';

import { encodePng } from '../../core';
import { encodeColLibrary } from './encode-col';
import { encodeLodDff } from './encode-dff';
import { encodeAtlasTxd } from './encode-txd';
import { loadTemplate, loadTextures, loadTree, openTemplateArchive } from './io';

/** GTA-SA generator inputs: the HD trees (`--dff`) + their textures (`--txd`), where to emit (`--out`), and the
 *  game data (`--game`) used only to source a structural LOD template. */
export interface GtaSaTreeLodOptions {
  config: TreeLodConfig;
  dffPath: string;
  gamePath: string;
  outPath: string;
  txdPath: string;
}

export function createGtaSaTreeLodAdapter(options: GtaSaTreeLodOptions): TreeLodAdapter {
  const { dffPath, gamePath, outPath, txdPath } = options;
  const isDir = statSync(dffPath).isDirectory();
  const textures = loadTextures(txdPath);
  const archive = openTemplateArchive(gamePath);

  return {
    finalize(impostors: Impostor[]): void {
      const template = loadTemplate(archive);
      const version = readRw(template).chunks[0]?.version ?? 0;
      for (const impostor of impostors) {
        writeFileSync(join(outPath, `${impostor.name}.dff`), encodeLodDff(template, impostor));
        writeFileSync(join(outPath, `${impostor.name}.png`), encodePng(impostor.image, impostor.size, impostor.size));
      }
      writeFileSync(join(outPath, 'lodtrees.txd'), encodeAtlasTxd(impostors, version));
      writeFileSync(join(outPath, 'lodtrees.col'), encodeColLibrary(impostors));
      console.log(`→ ${impostors.length} LOD DFF(s) + lodtrees.txd + lodtrees.col (+ debug PNGs) → ${outPath}`);
    },

    listInputs(): string[] {
      return isDir ? readdirSync(dffPath).filter((file) => file.toLowerCase().endsWith('.dff')) : [basename(dffPath)];
    },

    loadTree(name: string): HdTree {
      const file = isDir ? join(dffPath, name) : dffPath;

      return loadTree(file, name.replace(/\.dff$/i, ''), textures);
    },
  };
}
