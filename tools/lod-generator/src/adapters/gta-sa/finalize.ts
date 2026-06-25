import { createImg } from '@opensa/tool-kit/archive/img';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BakedCell } from '../../core/types';
import type { TextureSource } from './texture-source';

import { encodeCellTxd } from './cell-txd';
import { encodeCellDff } from './dff';

export interface BuildOptions {
  baked: readonly BakedCell[];
  cellSize: number;
  drawDistance: number;
  firstId: number;
  gameDir: string;
  lodTextureSize: number;
  outDir: string;
  textureSource: TextureSource;
}

/** Cell centre in world space (Z 0 — the cell mesh keeps world Z, offset only in X/Y; see merge). */
export function cellCentre(cell: { cx: number; cy: number }, cellSize: number): [number, number, number] {
  return [(cell.cx + 0.5) * cellSize, (cell.cy + 0.5) * cellSize, 0];
}

/** The cell-LOD model/txd name (`lod`-prefixed → OpenSA buckets it; `-` for negative cell coords). */
export function cellModelName(cx: number, cy: number): string {
  return `lod_${cx}_${cy}`;
}

/** An IDE `objs` line: `id, model, txd, drawDistance, flags`. */
export function ideObjsLine(id: number, name: string, drawDistance: number): string {
  return `${id}, ${name}, ${name}, ${drawDistance}, 0`;
}

/** An IPL `inst` line: `id, model, interior, x, y, z, rx, ry, rz, rw, lod` (identity rotation, no LOD link). */
export function iplInstLine(id: number, name: string, [x, y, z]: readonly [number, number, number]): string {
  return `${id}, ${name}, 0, ${x}, ${y}, ${z}, 0, 0, 0, 1, -1`;
}

/**
 * Emit the drop-in cell-LOD build (plan 002, 1d-ii). Mirror `gameDir` → `outDir`, then add a single
 * `models/lods.img` (one DFF + one TXD per baked cell), `data/lods.ide` (cell-LOD object defs) + `data/lods.ipl`
 * (placements at each cell centre), and register all three in `data/gta.dat` — so both OpenSA (lod-prefix
 * bucket) and the original game (independent high-draw-distance objects) load them. **Additive**: old `lod*`
 * models/refs are not yet stripped (follow-up), so they coexist with the new cell-LODs.
 */
export function writeBuild(options: BuildOptions): void {
  cpSync(options.gameDir, options.outDir, { force: true, recursive: true });

  const img = createImg();
  const objs: string[] = [];
  const insts: string[] = [];
  options.baked.forEach((cell, i) => {
    const id = options.firstId + i;
    const name = cellModelName(cell.cx, cell.cy);
    img.set(`${name}.dff`, encodeCellDff(cell.mesh, name));
    img.set(`${name}.txd`, encodeCellTxd(cellTextures(cell), options.textureSource, options.lodTextureSize));
    objs.push(ideObjsLine(id, name, options.drawDistance));
    insts.push(iplInstLine(id, name, cellCentre(cell, options.cellSize)));
  });

  writeFileSync(join(options.outDir, 'models', 'lods.img'), img.build());
  writeFileSync(join(options.outDir, 'data', 'lods.ide'), section('objs', objs));
  writeFileSync(join(options.outDir, 'data', 'lods.ipl'), section('inst', insts));
  registerInGtaDat(join(options.outDir, 'data', 'gta.dat'));
}

/** Unique non-empty texture names a cell references. */
function cellTextures(cell: BakedCell): string[] {
  return [...new Set(cell.mesh.groups.map((group) => group.texture).filter((texture) => texture.length > 0))];
}

function registerInGtaDat(datPath: string): void {
  const lines = ['IMG MODELS\\lods.img', 'IDE DATA\\lods.ide', 'IPL DATA\\lods.ipl'];
  writeFileSync(datPath, `${readFileSync(datPath, 'utf8').trimEnd()}\n${lines.join('\n')}\n`);
}

function section(name: string, rows: readonly string[]): string {
  return `${name}\n${rows.join('\n')}\nend\n`;
}
