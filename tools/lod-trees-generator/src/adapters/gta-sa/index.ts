import { lodAlias } from '@opensa/map-placement/ide';
import { isNonTreeModel, SA_TREE_MODELS } from '@opensa/map-placement/vegetation';
import { readRw } from '@opensa/rw-codec/chunk';
import { encodeColLibrary } from '@opensa/sa-lod/encode-col';
import { type PrelightInfo, stockPrelightColor } from '@opensa/sa-lod/prelight';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { HdTree, Impostor, TreeLodAdapter, TreeLodConfig } from '../../core';

import { encodePng } from '../../core';
import { encodeLodDff } from './encode-dff';
import { encodeAtlasTxd } from './encode-txd';
import {
  applyTrunkPrelight,
  loadArchiveTextures,
  loadTemplate,
  loadTextures,
  loadTree,
  openTemplateArchive,
} from './io';
import { placeMap } from './place/place-map';
import { stripMap } from './strip/strip-map';

/** GTA-SA generator inputs: the HD trees (`--in`, dff + txd), where to emit (`--out`), and the game data
 *  (`--game`) used for the LOD template + the map strip. With no `--in`, the built-in {@link SA_TREE_MODELS}
 *  roster is baked straight from the game's `gta3.img`. */
export interface GtaSaTreeLodOptions {
  config: TreeLodConfig;
  /** Write a per-impostor PNG preview of each baked atlas to `<out>` (`--debug-png`); off by default. */
  debugPng: boolean;
  gamePath: string;
  /** HD model folder (`<model>.dff` + `<model>.txd`); omit → bake the built-in SA tree roster from `gta3.img`. */
  inPath?: string;
  /** Write modified IMG entries loose to `<out>/gta3img/` instead of repacking a full `gta3.img`. */
  loose: boolean;
  outPath: string;
  /** Copy each swapped HD model's prelight from its stock DFF (`--prelight`). */
  prelight: boolean;
  /** Per-model `--prelight` overrides (`--prelight <info.json>`); e.g. opt a model out via `{ skip: true }`. */
  prelightInfo?: PrelightInfo;
  /** Verification mode: strip all source trees from the map (empty world) instead of placing impostor LODs. */
  strip: boolean;
}

export function createGtaSaTreeLodAdapter(options: GtaSaTreeLodOptions): TreeLodAdapter {
  const { debugPng, gamePath, inPath, loose, outPath, prelight, prelightInfo, strip } = options;
  const archive = openTemplateArchive(gamePath);
  const isDir = inPath !== undefined && statSync(inPath).isDirectory();
  // Model list (dff file names) + their textures: from `--in` when given, else the built-in SA roster from gta3.img.
  // A `--in` directory is filtered the same way the no-`--in` roster is curated — drop `procobj.dat` scatter species
  // (those go to lod-procobj-generator) and non-foliage "types" (rocks/grass/rubble/pots/proc-patches/already-LOD).
  // A single-file `--in` is taken as-is (an explicit pick).
  const inputs =
    inPath === undefined
      ? SA_TREE_MODELS.filter((model) => archive.get(`${model}.dff`)).map((model) => `${model}.dff`)
      : isDir
        ? filterTreeDffs(readdirSync(inPath), procObjModels(gamePath))
        : [basename(inPath)];
  const textures =
    inPath === undefined
      ? loadArchiveTextures(
          archive,
          gamePath,
          inputs.map((name) => name.replace(/\.dff$/i, '')),
        )
      : loadTextures(inPath);
  // Alpha-cutout textures are foliage; opaque ones are trunk/bark — drives the trunk-only `--prelight` split.
  const foliageTextures = new Set([...textures].filter(([, tex]) => tex.hasAlpha).map(([name]) => name));

  return {
    finalize(impostors: Impostor[]): void {
      const template = loadTemplate(archive);
      const version = readRw(template).chunks[0]?.version ?? 0;
      for (const impostor of impostors) {
        writeFileSync(join(outPath, `${impostor.name}.dff`), encodeLodDff(template, impostor));
        if (debugPng) {
          writeFileSync(
            join(outPath, `${impostor.name}.png`),
            encodePng(impostor.image, impostor.width, impostor.height),
          );
        }
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
      console.log(
        `→ ${impostors.length} LOD DFF(s) + lodtrees.txd + lodtrees.col${debugPng ? ' (+ debug PNGs)' : ''} → ${outPath}`,
      );

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
        drawDistance: options.config.drawDistance,
        foliageTextures,
        gamePath,
        impostors: impostors.map((i) => ({
          name: i.name,
          source: i.name.replace(/^lod/i, ''),
        })),
        inPath,
        loose,
        outPath,
        prelight,
        prelightInfo,
      });

      // The per-impostor DFFs + lodtrees.txd/col were written to `<out>` only as the hand-off into `placeMap`'s
      // pack step; the installable copies now live in `gta3.img` / `gta3img/`. Drop the redundant root
      // intermediates, leaving just `gta3.img`(or `gta3img/`) + `data/` (+ the debug `.png` previews).
      for (const impostor of impostors) {
        rmSync(join(outPath, `${impostor.name}.dff`), { force: true });
      }
      rmSync(join(outPath, 'lodtrees.txd'), { force: true });
      rmSync(join(outPath, 'lodtrees.col'), { force: true });
    },

    listInputs(): string[] {
      return inputs;
    },

    loadTree(name: string): HdTree {
      const model = name.replace(/\.dff$/i, '');
      // Bytes from the `--in` file, or the model's own DFF in gta3.img (no-`--in` mode).
      const bytes =
        inPath === undefined
          ? new Uint8Array(archive.get(`${model.toLowerCase()}.dff`) ?? new ArrayBuffer(0))
          : new Uint8Array(readFileSync(isDir ? join(inPath, name) : inPath));
      const tree = loadTree(bytes, model, textures);
      if (prelight && !prelightInfo?.skip.has(model.toLowerCase())) {
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

/** Keep only the tree-like `.dff` names from a `--in` directory: drop procobj scatter species + non-foliage types
 *  (the same cut as the curated no-`--in` roster). Logs how many were skipped. */
function filterTreeDffs(files: readonly string[], procModels: ReadonlySet<string>): string[] {
  const dffs = files.filter((file) => file.toLowerCase().endsWith('.dff'));
  const kept = dffs.filter((file) => {
    const model = file.replace(/\.dff$/i, '').toLowerCase();

    return !procModels.has(model) && !isNonTreeModel(model);
  });
  const skipped = dffs.length - kept.length;
  if (skipped > 0) {
    console.log(`lod-trees: --in ${dffs.length} dff → ${kept.length} tree(s) (skipped ${skipped}: procobj + non-tree)`);
  }

  return kept;
}

/** procobj scatter species (column 2 of each `procobj.dat` data row), lowercased; empty when the file is absent. */
function procObjModels(gamePath: string): Set<string> {
  const file = join(gamePath, 'data', 'procobj.dat');
  const models = new Set<string>();
  if (!existsSync(file)) {
    return models;
  }
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) {
      const model = trimmed.split(/\s+/)[1]?.toLowerCase();
      if (model) {
        models.add(model);
      }
    }
  }

  return models;
}
