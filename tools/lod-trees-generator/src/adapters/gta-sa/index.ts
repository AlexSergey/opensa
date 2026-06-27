import { lodAlias } from '@opensa/map-placement/ide';
import { readRw } from '@opensa/rw-codec/chunk';
import { encodeColLibrary } from '@opensa/sa-lod/encode-col';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { HdTree, Impostor, TreeLodAdapter, TreeLodConfig } from '../../core';

import { encodePng } from '../../core';
import { encodeLodDff } from './encode-dff';
import { encodeAtlasTxd } from './encode-txd';
import { applyTrunkPrelight, loadTemplate, loadTextures, loadTree, openTemplateArchive } from './io';
import { placeMap } from './place/place-map';
import { stockPrelightColor } from './place/prelight';
import { stripMap } from './strip/strip-map';

/** GTA-SA generator inputs: the HD trees (`--dff`) + their textures (`--txd`), where to emit (`--out`), and the
 *  game data (`--game`) used for the LOD template + the map strip. */
export interface GtaSaTreeLodOptions {
  config: TreeLodConfig;
  dffPath: string;
  gamePath: string;
  /** Write modified IMG entries loose to `<out>/gta3img/` instead of repacking a full `gta3.img`. */
  loose: boolean;
  outPath: string;
  /** Copy each swapped HD model's prelight from its stock DFF (`--prelight`). */
  prelight: boolean;
  /** Verification mode: strip all source trees from the map (empty world) instead of placing impostor LODs. */
  strip: boolean;
  txdPath: string;
}

export function createGtaSaTreeLodAdapter(options: GtaSaTreeLodOptions): TreeLodAdapter {
  const { dffPath, gamePath, loose, outPath, prelight, strip, txdPath } = options;
  const isDir = statSync(dffPath).isDirectory();
  const textures = loadTextures(txdPath);
  // Alpha-cutout textures are foliage; opaque ones are trunk/bark — drives the trunk-only `--prelight` split.
  const foliageTextures = new Set([...textures].filter(([, tex]) => tex.hasAlpha).map(([name]) => name));
  const archive = openTemplateArchive(gamePath);

  return {
    finalize(impostors: Impostor[]): void {
      const template = loadTemplate(archive);
      const version = readRw(template).chunks[0]?.version ?? 0;
      for (const impostor of impostors) {
        writeFileSync(join(outPath, `${impostor.name}.dff`), encodeLodDff(template, impostor));
        writeFileSync(
          join(outPath, `${impostor.name}.png`),
          encodePng(impostor.image, impostor.width, impostor.height),
        );
      }
      writeFileSync(join(outPath, 'lodtrees.txd'), encodeAtlasTxd(impostors, version));
      // Col models are bound by the same model name SA registers (the IDE/IMG alias), not the impostor's own name.
      const aliases = impostors.map((impostor, i) => lodAlias(impostor.name, i));
      writeFileSync(
        join(outPath, 'lodtrees.col'),
        encodeColLibrary(
          impostors.map((impostor) => impostor.bbox),
          aliases,
        ),
      );
      console.log(`→ ${impostors.length} LOD DFF(s) + lodtrees.txd + lodtrees.col (+ debug PNGs) → ${outPath}`);

      if (strip) {
        // Verification mode: strip the source trees (HD + old LODs + procobj) from the map (empty world).
        stripMap({
          dffNames: impostors.map((i) => i.name.replace(/^lod/i, '')),
          gamePath,
          loose,
          outPath,
        });

        return;
      }

      // Stage 2: attach an impostor LOD to every streamed tree HD + register/pack the impostor assets.
      placeMap({
        dffPath,
        drawDistance: options.config.drawDistance,
        foliageTextures,
        gamePath,
        impostors: impostors.map((i) => ({
          name: i.name,
          source: i.name.replace(/^lod/i, ''),
        })),
        loose,
        outPath,
        prelight,
        txdPath,
      });
    },

    listInputs(): string[] {
      return isDir ? readdirSync(dffPath).filter((file) => file.toLowerCase().endsWith('.dff')) : [basename(dffPath)];
    },

    loadTree(name: string): HdTree {
      const file = isDir ? join(dffPath, name) : dffPath;
      const model = name.replace(/\.dff$/i, '');
      const tree = loadTree(file, model, textures);
      if (prelight) {
        // Bake the LOD with the same stock trunk ambient the HD gets, so the impostor matches (not over-bright).
        const stock = archive.get(`${model.toLowerCase()}.dff`);
        const trunk = stock ? stockPrelightColor(new Uint8Array(stock)) : null;
        if (trunk) {
          applyTrunkPrelight(tree, trunk);
        }
      }

      return tree;
    },
  };
}
